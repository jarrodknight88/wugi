// ─────────────────────────────────────────────────────────────────────
// Wugi — twilioInbound Cloud Function (Bridge v1.3: SMS command channel)
//
// Configured as the Wugi Twilio number's "A message comes in" webhook.
// Lets Jarrod drive merges from his phone: MERGE <pr#> / MERGE ALL /
// HOLD <pr#> / STATUS / REWORK <pr#> <notes>. See commandGrammar.ts for
// the exact grammar and MERGE_EXECUTION_NOTES below for the security
// model — both non-negotiable per the v1.3 task spec.
//
// SECRETS REQUIRED (Firebase Secret Manager):
//   TWILIO_ACCOUNT_SID    — Twilio account SID
//   TWILIO_AUTH_TOKEN     — Twilio auth token (also used for X-Twilio-Signature)
//   TWILIO_PHONE_NUMBER   — Twilio sender number (outbound confirmations)
//   GITHUB_TOKEN          — repo-scoped token (PR lookups + squash-merge)
//   ASANA_PAT             — PAT used to log command outcomes as task comments
//
// MERGE_EXECUTION_NOTES (non-negotiable security gates, do not relax):
//   1. Twilio request-signature validation (X-Twilio-Signature via the
//      twilio SDK's validateRequest) — not just a From check.
//   2. From must equal JARROD_PHONE (+14704229247) exactly.
//   3. MERGE only proceeds if the linked Asana task's most recent
//      "PM CODE REVIEW" comment carries VERDICT: APPROVE — re-checked
//      live against Asana at merge time, never trusted from cache alone.
//   4. Every command + outcome is logged as an Asana comment AND
//      confirmed by SMS (unknown/unauthorized commands: SMS refusal
//      only, no Asana write, no GitHub action).
//   5. Rate limited to 10 commands/hour (claimSmsRateLimitSlot).
// ─────────────────────────────────────────────────────────────────────

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import twilio from 'twilio';

import {
  JARROD_PHONE,
  sendSms,
  getGithubPullRequest,
  squashMergeGithubPullRequest,
  resolveTaskGidForPr,
  fetchAsanaTaskStories,
  postAsanaComment,
  postGithubComment,
  getDispatchRecord,
  getPrLinkRecord,
  setPrLinkRecord,
  listPrLinkRecords,
  claimSmsRateLimitSlot,
  getMergeAllPending,
  setMergeAllPending,
  PrLinkRecord,
} from './shared';
import { parseInboundCommand, parsePmVerdict, isPmCodeReviewComment, PmVerdict } from './commandGrammar';

const twilioSid = defineSecret('TWILIO_ACCOUNT_SID');
const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');
const twilioFrom = defineSecret('TWILIO_PHONE_NUMBER');
const githubToken = defineSecret('GITHUB_TOKEN');
const asanaPat = defineSecret('ASANA_PAT');

const MERGE_ALL_CONFIRM_WINDOW_MS = 5 * 60 * 1000;

// ── Helpers ──────────────────────────────────────────────────────────

function reply(to: string, body: string): Promise<void> {
  return sendSms(to, body, twilioSid.value(), twilioAuthToken.value(), twilioFrom.value()).then(() => undefined);
}

/** Latest "PM CODE REVIEW" verdict posted on the Asana task, re-fetched
 * live — this is the merge-authorization source of truth, never cache. */
async function findLatestPmVerdict(taskGid: string): Promise<PmVerdict | null> {
  const stories = await fetchAsanaTaskStories(taskGid, asanaPat.value());
  const reviews = stories.filter((s) => isPmCodeReviewComment(s.text ?? ''));
  if (reviews.length === 0) return null;
  return parsePmVerdict(reviews[reviews.length - 1].text ?? '');
}

/** Resolve (and cache) the PR-link record for a PR number, falling back
 * to a live GitHub lookup when nothing's cached yet. */
async function resolvePrLink(prNumber: number): Promise<PrLinkRecord | null> {
  const cached = await getPrLinkRecord(prNumber);
  if (cached) return cached;

  const pr = await getGithubPullRequest(prNumber, githubToken.value());
  if (!pr) return null;
  const taskGid = await resolveTaskGidForPr(pr, githubToken.value());
  if (!taskGid) return null;
  const link: PrLinkRecord = { taskGid };
  await setPrLinkRecord(prNumber, { ...link });
  return link;
}

interface MergeOutcome {
  prNumber: number;
  merged: boolean;
  message: string;
}

/** Attempt to merge one PR: resolve its task, re-verify the live PM
 * verdict, squash-merge, and log the outcome to Asana. Never throws —
 * failures are reported in the returned outcome. */
async function attemptMergePr(prNumber: number): Promise<MergeOutcome> {
  const link = await resolvePrLink(prNumber);
  if (!link) {
    return { prNumber, merged: false, message: `PR #${prNumber}: no linked Asana task found — can't verify a verdict.` };
  }
  if (link.held) {
    return { prNumber, merged: false, message: `PR #${prNumber}: on hold — reply REWORK ${prNumber} <notes> or wait for a fresh PM review.` };
  }

  const pr = await getGithubPullRequest(prNumber, githubToken.value());
  if (!pr) {
    return { prNumber, merged: false, message: `PR #${prNumber}: not found on GitHub.` };
  }
  if (pr.merged) {
    return { prNumber, merged: true, message: `PR #${prNumber}: already merged.` };
  }
  if (pr.state !== 'open') {
    return { prNumber, merged: false, message: `PR #${prNumber}: closed without merge — can't merge.` };
  }

  const verdict = await findLatestPmVerdict(link.taskGid);
  if (verdict?.verdict !== 'APPROVE') {
    const outcome = { prNumber, merged: false, message: `PR #${prNumber}: no APPROVE verdict on file (latest: ${verdict?.verdict ?? 'none'}) — refusing to merge.` };
    await postAsanaComment(link.taskGid, `SMS MERGE ${prNumber} refused: ${outcome.message}`, asanaPat.value()).catch((err) =>
      logger.error('postAsanaComment failed (merge refusal)', { prNumber, err: String(err) })
    );
    return outcome;
  }

  const result = await squashMergeGithubPullRequest(prNumber, pr.title, githubToken.value());
  const outcome: MergeOutcome = {
    prNumber,
    merged: result.merged,
    message: result.merged ? `PR #${prNumber}: merged.` : `PR #${prNumber}: merge failed — ${result.message}`,
  };
  await postAsanaComment(
    link.taskGid,
    `SMS MERGE ${prNumber}: ${outcome.message}`,
    asanaPat.value()
  ).catch((err) => logger.error('postAsanaComment failed (merge outcome)', { prNumber, err: String(err) }));
  return outcome;
}

async function handleHold(prNumber: number): Promise<string> {
  const link = await resolvePrLink(prNumber);
  if (!link) return `Can't find the Asana task for PR #${prNumber} — nothing to hold.`;

  await setPrLinkRecord(prNumber, { ...link, held: true });
  await postAsanaComment(
    link.taskGid,
    `SMS HOLD ${prNumber}: merge blocked via SMS until a fresh PM CODE REVIEW verdict is posted.`,
    asanaPat.value()
  ).catch((err) => logger.error('postAsanaComment failed (hold)', { prNumber, err: String(err) }));
  return `PR #${prNumber} is now on hold — MERGE will refuse until a fresh PM review lands.`;
}

async function handleRework(prNumber: number, notes: string): Promise<string> {
  const link = await resolvePrLink(prNumber);
  if (!link) return `Can't find the Asana task for PR #${prNumber} — nothing to rework.`;

  let issueNumber = link.issueNumber;
  if (!issueNumber) {
    const dispatch = await getDispatchRecord(link.taskGid);
    issueNumber = dispatch?.issueNumber;
  }
  if (!issueNumber) return `Found the task for PR #${prNumber} but not its GitHub issue — can't post the rework comment.`;

  await postGithubComment(issueNumber, `@claude ${notes}`, githubToken.value());
  // A rework supersedes any prior verdict/hold — the next merge decision
  // must come from a fresh PM CODE REVIEW after this round lands.
  await setPrLinkRecord(prNumber, { ...link, verdict: null, held: false });
  await postAsanaComment(
    link.taskGid,
    `SMS REWORK ${prNumber}: "${notes}"\n\nPosted as an @claude comment on issue #${issueNumber} — this will retrigger Claude.`,
    asanaPat.value()
  ).catch((err) => logger.error('postAsanaComment failed (rework)', { prNumber, err: String(err) }));
  return `Rework requested for PR #${prNumber} — posted to issue #${issueNumber}, Claude will pick it up.`;
}

async function handleStatus(): Promise<string> {
  const links = await listPrLinkRecords();
  if (links.length === 0) return 'Wugi Bridge: no PRs tracked yet.';

  const lines = links
    .sort((a, b) => b[0] - a[0])
    .slice(0, 10)
    .map(([prNumber, link]) => {
      const state = link.held ? 'HOLD' : (link.verdict ?? 'pending review');
      return `#${prNumber}: ${state}`;
    });
  return `Wugi Bridge status:\n${lines.join('\n')}`;
}

async function handleMergeAll(): Promise<string> {
  const links = await listPrLinkRecords();
  const eligible = links.filter(([, link]) => link.verdict === 'APPROVE' && !link.held).map(([n]) => n);
  if (eligible.length === 0) return 'No PRs are currently approved for MERGE ALL.';

  await setMergeAllPending({ prNumbers: eligible, expiresAtMs: Date.now() + MERGE_ALL_CONFIRM_WINDOW_MS });
  return `Reply YES to confirm merging ${eligible.length} PR(s): ${eligible.map((n) => `#${n}`).join(', ')} (expires in 5 min).`;
}

async function handleConfirmYes(): Promise<string> {
  const pending = await getMergeAllPending();
  if (!pending) return 'No pending MERGE ALL confirmation.';
  await setMergeAllPending(null);
  if (Date.now() > pending.expiresAtMs) return 'MERGE ALL confirmation expired — resend MERGE ALL to retry.';

  const outcomes: MergeOutcome[] = [];
  for (const prNumber of pending.prNumbers) {
    outcomes.push(await attemptMergePr(prNumber));
  }
  const merged = outcomes.filter((o) => o.merged).length;
  return `MERGE ALL: ${merged}/${outcomes.length} merged.\n${outcomes.map((o) => o.message).join('\n')}`;
}

// ── Main Cloud Function ──────────────────────────────────────────────

export const twilioInbound = onRequest(
  {
    secrets: [twilioSid, twilioAuthToken, twilioFrom, githubToken, asanaPat],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    const signature = req.headers['x-twilio-signature'] as string | undefined;
    if (!signature) {
      logger.warn('twilioInbound: missing X-Twilio-Signature header');
      res.status(401).send('Unauthorized');
      return;
    }

    const url = `https://${req.get('host')}${req.originalUrl}`;
    const params = (req.body ?? {}) as Record<string, unknown>;
    if (!twilio.validateRequest(twilioAuthToken.value(), signature, url, params)) {
      logger.warn('twilioInbound: invalid X-Twilio-Signature', { url });
      res.status(401).send('Invalid signature');
      return;
    }

    const from = String(params.From ?? '').trim();
    if (from !== JARROD_PHONE) {
      logger.warn('twilioInbound: From mismatch — refusing', { from });
      res.status(403).send('Forbidden');
      return;
    }

    // Auth passed — always ack Twilio with empty TwiML from here on;
    // any reply text goes out via the same sendSms() path everything
    // else in the bridge uses, so it gets the same explicit logging.
    res.set('Content-Type', 'text/xml');
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

    const body = String(params.Body ?? '');
    const messageSid = String(params.MessageSid ?? 'unknown');

    if (!(await claimSmsRateLimitSlot(Date.now()))) {
      logger.warn('twilioInbound: rate limit exceeded', { messageSid });
      await reply(JARROD_PHONE, 'Wugi Bridge: rate limit hit (10 commands/hour) — try again later.');
      return;
    }

    const command = parseInboundCommand(body);
    logger.info('twilioInbound: command received', { messageSid, kind: command.kind, body });

    try {
      switch (command.kind) {
        case 'STATUS':
          await reply(JARROD_PHONE, await handleStatus());
          break;
        case 'MERGE_ALL':
          await reply(JARROD_PHONE, await handleMergeAll());
          break;
        case 'CONFIRM_YES':
          await reply(JARROD_PHONE, await handleConfirmYes());
          break;
        case 'MERGE': {
          const outcome = await attemptMergePr(command.prNumber);
          await reply(JARROD_PHONE, outcome.message);
          break;
        }
        case 'HOLD':
          await reply(JARROD_PHONE, await handleHold(command.prNumber));
          break;
        case 'REWORK':
          await reply(JARROD_PHONE, await handleRework(command.prNumber, command.notes));
          break;
        case 'UNKNOWN':
          await reply(
            JARROD_PHONE,
            "Wugi Bridge: didn't recognize that. Commands: MERGE <n> / MERGE ALL / HOLD <n> / STATUS / REWORK <n> <notes>"
          );
          break;
      }
    } catch (err) {
      logger.error('twilioInbound: command handling failed', { messageSid, kind: command.kind, err: String(err) });
      await reply(JARROD_PHONE, 'Wugi Bridge: something went wrong handling that command — check Cloud Logging.').catch(
        () => undefined
      );
    }
  }
);
