// ─────────────────────────────────────────────────────────────────────
// Wugi — githubWebhook Cloud Function (GitHub → Asana relay)
//
// Receives GitHub webhook events for jarrodknight88/wugi. Relays issue
// comments and PR activity back to the originating Asana task (found via
// the `Asana-GID:` marker the bridge embeds in issue bodies) and texts
// Jarrod for the milestones that matter: Claude's first reply, PR opened,
// PR merged.
//
// SECRETS REQUIRED (Firebase Secret Manager):
//   GITHUB_WEBHOOK_SECRET — set when registering the GitHub webhook
//   GITHUB_TOKEN          — repo-scoped token (issue lookups for PRs)
//   ASANA_PAT             — PAT used to post Asana comments
//   TWILIO_ACCOUNT_SID    — Twilio account SID
//   TWILIO_AUTH_TOKEN     — Twilio auth token
//   TWILIO_PHONE_NUMBER   — Twilio sender number
// ─────────────────────────────────────────────────────────────────────

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

import {
  JARROD_PHONE,
  DISPATCHES_DOC,
  DispatchRecord,
  fetchAsanaTask,
  postAsanaComment,
  getGithubIssue,
  getDispatchRecord,
  sendSms,
  extractAsanaGid,
  truncate,
} from './shared';

const githubWebhookSecret = defineSecret('GITHUB_WEBHOOK_SECRET');
const githubToken = defineSecret('GITHUB_TOKEN');
const asanaPat = defineSecret('ASANA_PAT');
const twilioSid = defineSecret('TWILIO_ACCOUNT_SID');
const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');
const twilioFrom = defineSecret('TWILIO_PHONE_NUMBER');

// ── Signature verification ───────────────────────────────────────────

function verifyGithubSignature(rawBody: Buffer, header: string, secret: string): boolean {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
  } catch {
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

async function resolveTaskName(gid: string, record: DispatchRecord | null): Promise<string> {
  if (record?.taskName) return record.taskName;
  try {
    return (await fetchAsanaTask(gid, asanaPat.value())).name;
  } catch {
    return 'Asana task';
  }
}

async function smsJarrod(taskName: string, summary: string, link: string): Promise<void> {
  await sendSms(
    JARROD_PHONE,
    `Wugi Dev — ${taskName}: ${summary} ${link}`,
    twilioSid.value(),
    twilioAuthToken.value(),
    twilioFrom.value()
  );
}

/**
 * Atomically flip firstReplySmsSent for a task. Returns true if this
 * call won the flag (i.e. the SMS should be sent).
 */
async function claimFirstReplySms(taskGid: string): Promise<boolean> {
  const ref = admin.firestore().doc(DISPATCHES_DOC);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const record = ((snap.data() ?? {})[taskGid] ?? null) as DispatchRecord | null;
    if (record?.firstReplySmsSent) return false;
    tx.set(ref, { [taskGid]: { firstReplySmsSent: true } }, { merge: true });
    return true;
  });
}

/**
 * Claim the final-report relay for one issue. Returns true if this call
 * won the claim (i.e. the report should be posted to Asana) — false if
 * this issue's final report was already relayed. Scoped by issue number
 * (not a bare flag) so re-dispatch to a fresh issue can relay again.
 */
async function claimFinalReport(taskGid: string, issueNumber: number): Promise<boolean> {
  const ref = admin.firestore().doc(DISPATCHES_DOC);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const record = ((snap.data() ?? {})[taskGid] ?? null) as DispatchRecord | null;
    if (record?.finalReportRelayedIssue === issueNumber) return false;
    tx.set(ref, { [taskGid]: { finalReportRelayedIssue: issueNumber } }, { merge: true });
    return true;
  });
}

// ── Claude final-report relay ───────────────────────────────────────

/** Login of the Claude Code Action's GitHub App bot account. */
const CLAUDE_BOT_LOGIN = 'claude[bot]';
/** The header the Action's system prompt adds when a task is complete. */
const TERMINAL_MARKER = /claude finished/i;
/** Asana comment length is capped; truncate long final reports with a link back. */
const FINAL_REPORT_MAX_CHARS = 60_000;

/**
 * The Claude Code Action delivers results by editing its own comment
 * rather than posting a new one, so `issue_comment` `created` events
 * never see the final report. Watch `edited` events from the bot and
 * relay only once the edit lands on the terminal ("Claude finished")
 * state, deduped per issue so a burst of trailing edits only relays once.
 */
async function handleIssueCommentEdited(payload: any): Promise<void> {
  const issue = payload.issue;
  const comment = payload.comment;
  if (!issue || !comment) return;

  if (comment.user?.login !== CLAUDE_BOT_LOGIN) return;

  const body = (comment.body ?? '').trim();
  if (!TERMINAL_MARKER.test(body)) return;

  const gid = extractAsanaGid(issue.body ?? '');
  if (!gid) return;

  if (!(await claimFinalReport(gid, issue.number))) {
    logger.info('Final report already relayed for this issue — skipping', { issue: issue.number });
    return;
  }

  const excerpt = truncate(body, FINAL_REPORT_MAX_CHARS);
  await postAsanaComment(
    gid,
    `Claude's final report on issue #${issue.number}:\n\n${excerpt}\n\n${comment.html_url}`,
    asanaPat.value()
  );
}

// ── Event handlers ───────────────────────────────────────────────────

async function handleIssueComment(payload: any): Promise<void> {
  const issue = payload.issue;
  const comment = payload.comment;
  if (!issue || !comment) return;

  // The bridge creates issues as the GITHUB_TOKEN owner — ignore that
  // account's own comments (e.g. the dispatch itself) to avoid loops
  if (comment.user?.login && comment.user.login === issue.user?.login) {
    logger.info('Ignoring bridge-authored comment', { issue: issue.number });
    return;
  }

  const gid = extractAsanaGid(issue.body ?? '');
  if (!gid) return;

  const author = comment.user?.login ?? 'unknown';
  const excerpt = truncate((comment.body ?? '').trim());
  await postAsanaComment(
    gid,
    `GitHub comment from ${author} on issue #${issue.number}:\n\n${excerpt}\n\n${comment.html_url}`,
    asanaPat.value()
  );

  // SMS only for the first (non-bridge) reply on the issue
  if (await claimFirstReplySms(gid)) {
    const record = await getDispatchRecord(gid);
    const taskName = await resolveTaskName(gid, record);
    await smsJarrod(taskName, `first reply from ${author} on #${issue.number}`, comment.html_url);
  }
}

async function handlePullRequest(payload: any): Promise<void> {
  const pr = payload.pull_request;
  const action = payload.action;
  if (!pr) return;

  const merged = pr.merged === true;
  if (action !== 'opened' && action !== 'closed') return;

  // Find the originating task: marker in the PR body, else via the
  // issue the PR references (e.g. "Fixes #12")
  let gid = extractAsanaGid(pr.body ?? '');
  if (!gid) {
    const ref = `${pr.title ?? ''}\n${pr.body ?? ''}`.match(/#(\d+)/);
    if (ref) {
      const issue = await getGithubIssue(Number(ref[1]), githubToken.value());
      if (issue) gid = extractAsanaGid(issue.body ?? '');
    }
  }
  if (!gid) return;

  const author = pr.user?.login ?? 'unknown';
  const summary =
    action === 'opened'
      ? `PR #${pr.number} opened by ${author}`
      : merged
        ? `PR #${pr.number} merged`
        : `PR #${pr.number} closed without merge`;

  const excerpt = truncate((pr.body ?? '').trim());
  await postAsanaComment(
    gid,
    `${summary}: ${pr.title}\n\n${excerpt}\n\n${pr.html_url}`,
    asanaPat.value()
  );

  // SMS for PR opened and PR merged only
  if (action === 'opened' || merged) {
    const record = await getDispatchRecord(gid);
    const taskName = await resolveTaskName(gid, record);
    await smsJarrod(taskName, summary, pr.html_url);
  }
}

// ── Main Cloud Function ──────────────────────────────────────────────

export const githubWebhook = onRequest(
  {
    secrets: [githubWebhookSecret, githubToken, asanaPat, twilioSid, twilioAuthToken, twilioFrom],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    // Step 1: verify X-Hub-Signature-256
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (!signature) {
      logger.warn('Missing X-Hub-Signature-256 header');
      res.status(401).send('Unauthorized');
      return;
    }
    const rawBody: Buffer = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyGithubSignature(rawBody, signature, githubWebhookSecret.value())) {
      logger.warn('Invalid GitHub webhook signature');
      res.status(401).send('Invalid signature');
      return;
    }

    // Step 2: route events
    const event = req.headers['x-github-event'] as string | undefined;
    const payload = req.body ?? {};
    try {
      if (event === 'issue_comment' && payload.action === 'created') {
        await handleIssueComment(payload);
      } else if (event === 'issue_comment' && payload.action === 'edited') {
        await handleIssueCommentEdited(payload);
      } else if (event === 'pull_request') {
        await handlePullRequest(payload);
      }
    } catch (err) {
      logger.error('githubWebhook handler failed', { event, err: String(err) });
    }

    res.status(200).send('OK');
  }
);
