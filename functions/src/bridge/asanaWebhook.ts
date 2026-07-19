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
  DispatchRecord,
  fetchAsanaTask,
  postAsanaComment,
  resolveAsanaUserGid,
  createGithubIssue,
  getGithubIssue,
  deleteDispatchRecord,
  setDispatchRecord,
} from './shared';

const asanaPat = defineSecret('ASANA_PAT');
const githubToken = defineSecret('GITHUB_TOKEN');

/** Dev agent GID, resolved once per instance and cached in memory. */
let devAgentGidCache: string | null = null;

interface AsanaEvent {
  action: string;
  resource?: { gid: string; resource_type: string };
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
    // Release the claim so a retry can dispatch
    await deleteDispatchRecord(taskGid).catch(() => undefined);
    throw err;
  }
}

// ── Main Cloud Function ──────────────────────────────────────────────

export const asanaWebhook = onRequest(
  {
    secrets: [asanaPat, githubToken],
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

    // Step 3: filter to task events where the assignee changed, then
    // dispatch any task now assigned to the dev agent
    const events: AsanaEvent[] = (req.body?.events ?? []) as AsanaEvent[];
    for (const event of events) {
      if (event.resource?.resource_type !== 'task') continue;
      if (event.action !== 'changed' || event.change?.field !== 'assignee') continue;
      try {
        await handleAssigneeChange(event.resource.gid, asanaPat.value(), githubToken.value());
      } catch (err) {
        logger.error('Dispatch failed', { taskGid: event.resource.gid, err: String(err) });
      }
    }

    res.status(200).send('OK');
  }
);
