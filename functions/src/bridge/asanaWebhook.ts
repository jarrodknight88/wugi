// ─────────────────────────────────────────────────────────────────────
// Wugi — asanaWebhook Cloud Function (Asana → GitHub dispatch)
//
// Receives Asana webhook events. When a task's assignee changes to the
// dev agent (developer.jarrod@gmail.com), creates a @claude GitHub issue
// on jarrodknight88/wugi and acks back on the Asana task.
//
// Webhook registration: point the Asana webhook target at this function.
// Optionally append ?project=<projectGid> to the target URL so the
// handshake secret is stored under that key (multiple webhooks → one doc,
// one field each); otherwise it is stored under 'default'.
//
// SECRETS REQUIRED (Firebase Secret Manager):
//   ASANA_PAT      — PAT with access to workspace 1208137481227174
//   GITHUB_TOKEN   — repo-scoped token for jarrodknight88/wugi
// ─────────────────────────────────────────────────────────────────────

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

import {
  DEV_AGENT_EMAIL,
  GITHUB_OWNER,
  GITHUB_REPO,
  SECRETS_DOC,
  DISPATCHES_DOC,
  JARROD_PHONE,
  DispatchRecord,
  fetchAsanaTask,
  fetchAsanaStory,
  fetchAsanaCurrentUserGid,
  postAsanaComment,
  postGithubComment,
  resolveAsanaUserGid,
  createGithubIssue,
  getGithubIssue,
  getDispatchRecord,
  deleteDispatchRecord,
  setDispatchRecord,
  setPrLinkRecord,
  sendSms,
} from './shared';
import { isPmCodeReviewComment, parsePmVerdict, composeVerdictSms } from './commandGrammar';

const asanaPat = defineSecret('ASANA_PAT');
const githubToken = defineSecret('GITHUB_TOKEN');
const twilioSid = defineSecret('TWILIO_ACCOUNT_SID');
const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');
const twilioFrom = defineSecret('TWILIO_PHONE_NUMBER');

/** Dev agent GID, resolved once per instance and cached in memory. */
let devAgentGidCache: string | null = null;
/** GID of the Asana user the bridge's own PAT authenticates as. */
let bridgeAsanaUserGidCache: string | null = null;

interface AsanaEvent {
  action: string;
  resource?: { gid: string; resource_type: string };
  parent?: { gid: string; resource_type: string };
  change?: { field: string; action: string };
}

// ── Signature verification ───────────────────────────────────────────

function hmacMatches(rawBody: Buffer, secret: string, receivedHex: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(receivedHex, 'hex'));
  } catch {
    return false;
  }
}

/** Verify X-Hook-Signature against every stored hook secret. */
async function verifySignature(rawBody: Buffer, receivedHex: string): Promise<boolean> {
  const snap = await admin.firestore().doc(SECRETS_DOC).get();
  const stored = snap.data() ?? {};
  return Object.values(stored).some(
    (entry: any) => typeof entry?.secret === 'string' && hmacMatches(rawBody, entry.secret, receivedHex)
  );
}

// ── Dedupe / claim ───────────────────────────────────────────────────

/**
 * Claim the task for dispatch. Returns false if a dispatch is already
 * pending or an earlier dispatch's issue is still open; a closed issue
 * allows re-dispatch.
 */
async function claimDispatch(taskGid: string, ghToken: string): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.doc(DISPATCHES_DOC);
  const existing = ((await ref.get()).data() ?? {})[taskGid] as DispatchRecord | undefined;

  if (existing) {
    if (existing.status === 'pending') return false;
    if (!existing.issueNumber) return false;
    const issue = await getGithubIssue(existing.issueNumber, ghToken);
    if (!issue || issue.state === 'open') return false;
    logger.info('Previous issue closed — re-dispatching', { taskGid, issue: existing.issueNumber });
  }

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = ((snap.data() ?? {})[taskGid] ?? null) as DispatchRecord | null;
    // Bail if another delivery claimed or re-dispatched since our read
    if (current?.status === 'pending') return false;
    if ((current?.issueNumber ?? null) !== (existing?.issueNumber ?? null)) return false;
    tx.set(
      ref,
      { [taskGid]: { status: 'pending', claimedAt: admin.firestore.FieldValue.serverTimestamp() } },
      { merge: true }
    );
    return true;
  });
}

// ── Dispatch ─────────────────────────────────────────────────────────

async function handleAssigneeChange(taskGid: string, pat: string, ghToken: string): Promise<void> {
  if (!devAgentGidCache) {
    devAgentGidCache = await resolveAsanaUserGid(DEV_AGENT_EMAIL, pat);
    logger.info('Resolved dev agent GID', { gid: devAgentGidCache });
  }

  const task = await fetchAsanaTask(taskGid, pat);
  if (task.assignee?.gid !== devAgentGidCache) return;

  if (!(await claimDispatch(taskGid, ghToken))) {
    logger.info('Task already dispatched — skipping', { taskGid });
    return;
  }

  try {
    const issueBody = [
      "@claude Please work this Asana task. Follow the conventions in this repo's CLAUDE.md, open a pull request with your changes, and never merge without human approval.",
      '',
      'After pushing your branch, open the pull request yourself with `gh pr create` (base `main`), and include the deploy commands + reviewer checklist in the PR body.',
      '',
      '## Task notes',
      '',
      task.notes?.trim() || '(no notes)',
      '',
      '---',
      `Asana task: ${task.permalink_url}`,
      `Asana-GID: ${task.gid}`,
    ].join('\n');

    const issue = await createGithubIssue(task.name, issueBody, ghToken);
    logger.info('GitHub issue created', { taskGid, issue: issue.number });

    await setDispatchRecord(taskGid, {
      status: 'dispatched',
      taskName: task.name,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      firstReplySmsSent: false,
      dispatchedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await postAsanaComment(
      taskGid,
      `Dispatched to Claude Code — github.com/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issue.number}`,
      pat
    );
  } catch (err) {
    // Final failure (retries exhausted or non-retryable) — release the
    // claim so a subsequent assignee-change event can re-dispatch, and
    // let Jarrod/PM know without requiring a GitHub visit.
    await deleteDispatchRecord(taskGid).catch(() => undefined);
    await postAsanaComment(
      taskGid,
      `Dispatch failed: could not create the GitHub issue (${String(err)}). The claim has been released — re-toggling the assignee will retry the dispatch.`,
      pat
    ).catch((commentErr) =>
      logger.error('Failed to post Dispatch failed comment', { taskGid, err: String(commentErr) })
    );
    throw err;
  }
}

// ── Reverse lane: Asana task comment → GitHub issue comment ─────────

/** Matches an @claude mention anywhere in an Asana comment's plain text. */
const CLAUDE_MENTION = /@claude\b/i;

async function relayClaudeMention(
  taskGid: string,
  issueNumber: number,
  text: string,
  authorName: string,
  ghToken: string
): Promise<void> {
  await postGithubComment(
    issueNumber,
    `Comment from ${authorName} on the Asana task:\n\n${text}`,
    ghToken
  );
  logger.info('Relayed Asana task comment to GitHub issue', { taskGid, issueNumber });
}

/**
 * v1.3: a "PM CODE REVIEW" comment on a dispatched task carries a
 * PR#/VERDICT/tsc verdict block. Compress it into an SMS to Jarrod and
 * cache the PR ⇄ task link so a later MERGE/HOLD/REWORK SMS command can
 * find this task by PR number alone.
 */
async function relayPmVerdict(
  taskGid: string,
  issueNumber: number,
  text: string,
  pat: string,
  twilioSid: string,
  twilioAuthToken: string,
  twilioFrom: string
): Promise<void> {
  const verdict = parsePmVerdict(text);
  if (verdict.prNumber !== null) {
    await setPrLinkRecord(verdict.prNumber, {
      taskGid,
      issueNumber,
      verdict: verdict.verdict,
      held: false, // a fresh verdict always lifts a prior SMS hold
    });
  } else {
    logger.warn('PM CODE REVIEW comment had no parseable PR#', { taskGid, issueNumber });
  }

  const result = await sendSms(JARROD_PHONE, composeVerdictSms(verdict), twilioSid, twilioAuthToken, twilioFrom);
  if (!result.ok) {
    logger.error('Failed to SMS PM verdict', { taskGid, issueNumber, err: result.errorMessage });
  }
}

/**
 * A comment added directly on an already-dispatched Asana task (e.g. scope
 * clarified after dispatch, per the v1.1 process gap) that mentions
 * @claude gets relayed as a new GitHub issue comment, so the Claude Code
 * Action's own `@claude`-in-comment trigger picks it up on the linked issue.
 * v1.3 adds a second branch: a "PM CODE REVIEW" comment triggers a verdict
 * SMS instead of a GitHub relay (see relayPmVerdict above).
 */
async function handleTaskCommentAdded(
  storyGid: string,
  taskGid: string,
  pat: string,
  ghToken: string,
  twilioSid: string,
  twilioAuthToken: string,
  twilioFrom: string
): Promise<void> {
  const record = await getDispatchRecord(taskGid);
  if (!record || record.status !== 'dispatched' || !record.issueNumber) return;

  const story = await fetchAsanaStory(storyGid, pat);
  if (story.resource_subtype !== 'comment_added') return;

  if (!bridgeAsanaUserGidCache) {
    bridgeAsanaUserGidCache = await fetchAsanaCurrentUserGid(pat);
  }
  // Comments the bridge itself posted (e.g. the GitHub-activity relay) must
  // never be relayed back to GitHub, or a human @claude mention echoed from
  // GitHub would bounce straight back and re-trigger the Action.
  if (story.created_by?.gid === bridgeAsanaUserGidCache) return;

  const text = (story.text ?? '').trim();
  const authorName = story.created_by?.name ?? 'someone';

  if (isPmCodeReviewComment(text)) {
    await relayPmVerdict(taskGid, record.issueNumber, text, pat, twilioSid, twilioAuthToken, twilioFrom);
    return;
  }

  if (!CLAUDE_MENTION.test(text)) return;
  await relayClaudeMention(taskGid, record.issueNumber, text, authorName, ghToken);
}

// ── Main Cloud Function ──────────────────────────────────────────────

export const asanaWebhook = onRequest(
  {
    secrets: [asanaPat, githubToken, twilioSid, twilioAuthToken, twilioFrom],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    // Step 1: handshake — echo X-Hook-Secret and persist it for later
    // signature verification
    const hookSecret = req.headers['x-hook-secret'] as string | undefined;
    if (hookSecret) {
      const key =
        (req.query.webhook as string) || (req.query.project as string) || 'default';
      await admin.firestore().doc(SECRETS_DOC).set(
        { [key]: { secret: hookSecret, storedAt: admin.firestore.FieldValue.serverTimestamp() } },
        { merge: true }
      );
      logger.info('Asana webhook handshake — secret stored', { key });
      res.set('X-Hook-Secret', hookSecret);
      res.status(200).send();
      return;
    }

    // Step 2: verify X-Hook-Signature (HMAC-SHA256 of body, stored secret)
    const signature = req.headers['x-hook-signature'] as string | undefined;
    if (!signature) {
      logger.warn('Missing X-Hook-Signature header');
      res.status(401).send('Unauthorized');
      return;
    }
    const rawBody: Buffer = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!(await verifySignature(rawBody, signature))) {
      logger.warn('Invalid Asana webhook signature');
      res.status(401).send('Invalid signature');
      return;
    }

    // Step 3: dispatch task-assignee-change events, and relay task-comment
    // events for the reverse lane (§ handleTaskCommentAdded)
    const events: AsanaEvent[] = (req.body?.events ?? []) as AsanaEvent[];
    for (const event of events) {
      try {
        if (
          event.resource?.resource_type === 'task' &&
          event.action === 'changed' &&
          event.change?.field === 'assignee'
        ) {
          await handleAssigneeChange(event.resource.gid, asanaPat.value(), githubToken.value());
        } else if (
          event.resource?.resource_type === 'story' &&
          event.action === 'added' &&
          event.parent?.resource_type === 'task'
        ) {
          await handleTaskCommentAdded(
            event.resource.gid,
            event.parent.gid,
            asanaPat.value(),
            githubToken.value(),
            twilioSid.value(),
            twilioAuthToken.value(),
            twilioFrom.value()
          );
        }
      } catch (err) {
        logger.error('Bridge event handling failed', { event, err: String(err) });
      }
    }

    res.status(200).send('OK');
  }
);
