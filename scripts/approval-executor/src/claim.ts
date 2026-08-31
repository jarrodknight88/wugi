import * as os from 'node:os';
import type * as admin from 'firebase-admin';
import { PENDING_APPROVALS_DOC } from './config';
import { getFirestore } from './firestore';
import type { ApprovalEntry } from './types';

/** Atomically flips one entry from pending -> claimed inside a transaction,
 * so a concurrent PM session (or a second daemon instance) cannot double-execute
 * it. Returns the claimed entry, or null if it was no longer pending by the
 * time the transaction ran (already claimed elsewhere / raced). */
export async function claimApprovalEntry(entryId: string): Promise<ApprovalEntry | null> {
  const db = getFirestore();
  const ref = db.doc(PENDING_APPROVALS_DOC);

  return db.runTransaction(async (tx: admin.firestore.Transaction) => {
    const snap = await tx.get(ref);
    const entry = (snap.data() ?? {})[entryId] as ApprovalEntry | undefined;
    if (!entry || entry.status !== 'pending') return null;

    const claimed: ApprovalEntry = {
      ...entry,
      status: 'claimed',
      claimedBy: os.hostname(),
      claimedAtMs: Date.now(),
    };
    tx.set(ref, { [entryId]: claimed }, { merge: true });
    return claimed;
  });
}

export async function setEntryResult(
  entryId: string,
  status: 'executed' | 'failed' | 'held',
  result: string
): Promise<void> {
  const db = getFirestore();
  await db.doc(PENDING_APPROVALS_DOC).set({ [entryId]: { status, result } }, { merge: true });
}
