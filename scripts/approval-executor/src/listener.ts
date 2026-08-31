// ─────────────────────────────────────────────────────────────────────
// Firestore listener: onSnapshot on system/pendingApprovals, falling back
// to a 60s poll if the listener drops, with exponential reconnect backoff.
// ─────────────────────────────────────────────────────────────────────

import type * as admin from 'firebase-admin';
import { claimApprovalEntry } from './claim';
import { PENDING_APPROVALS_DOC, POLL_FALLBACK_MS, RECONNECT_BACKOFF_BASE_MS, RECONNECT_BACKOFF_MAX_MS } from './config';
import { executeApproval, type ExecuteContext } from './execute';
import { getFirestore } from './firestore';
import type { PendingApprovalsDoc } from './types';

const HANDLED_VERBS = new Set(['MERGE', 'DEPLOY', 'HOLD']);

async function handleSnapshot(doc: PendingApprovalsDoc, ctx: ExecuteContext): Promise<void> {
  for (const [entryId, entry] of Object.entries(doc)) {
    if (entry.status !== 'pending' || !HANDLED_VERBS.has(entry.verb)) continue;

    const claimed = await claimApprovalEntry(entryId);
    if (!claimed) continue; // raced with another session — it won the claim

    console.log(`[${entryId}] claimed ${claimed.verb} #${claimed.prNumber ?? ''}`);
    try {
      const result = await executeApproval(entryId, claimed, 'telegram', ctx);
      console.log(`[${entryId}] ${result.status}: ${result.message}`);
    } catch (err) {
      console.error(`[${entryId}] execution threw:`, err);
    }
  }
}

async function pollOnce(ctx: ExecuteContext): Promise<void> {
  const snap = await getFirestore().doc(PENDING_APPROVALS_DOC).get();
  await handleSnapshot((snap.data() ?? {}) as PendingApprovalsDoc, ctx);
}

/** Runs forever: an onSnapshot listener with reconnect backoff, plus a 60s
 * poll loop that runs regardless (cheap, and covers the window between a
 * listener drop and its reconnect). */
export function startListener(ctx: ExecuteContext): void {
  let backoffMs = RECONNECT_BACKOFF_BASE_MS;

  const attach = () => {
    const ref = getFirestore().doc(PENDING_APPROVALS_DOC);
    const unsubscribe = ref.onSnapshot(
      (snap: admin.firestore.DocumentSnapshot) => {
        backoffMs = RECONNECT_BACKOFF_BASE_MS;
        void handleSnapshot((snap.data() ?? {}) as PendingApprovalsDoc, ctx);
      },
      (err: Error) => {
        console.error('onSnapshot listener dropped, reconnecting with backoff:', err);
        unsubscribe();
        setTimeout(attach, backoffMs);
        backoffMs = Math.min(backoffMs * 2, RECONNECT_BACKOFF_MAX_MS);
      }
    );
  };
  attach();

  setInterval(() => {
    pollOnce(ctx).catch((err) => console.error('poll fallback failed:', err));
  }, POLL_FALLBACK_MS);
}

export async function runOnce(ctx: ExecuteContext): Promise<void> {
  await pollOnce(ctx);
}
