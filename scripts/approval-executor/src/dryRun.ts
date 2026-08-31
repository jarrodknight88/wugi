import { PENDING_APPROVALS_DOC } from './config';
import { runPrePushGate } from './gate';
import { getFirestore } from './firestore';
import type { ApprovalEntry } from './types';

/** Runs the full pre-push gate for one entryId and logs what would happen,
 * without claiming the entry or merging/deploying anything. */
export async function dryRunEntry(entryId: string, ghToken: string): Promise<void> {
  const snap = await getFirestore().doc(PENDING_APPROVALS_DOC).get();
  const entry = (snap.data() ?? {})[entryId] as ApprovalEntry | undefined;
  if (!entry) {
    console.log(`[dry-run] ${entryId}: no such entry`);
    return;
  }

  console.log(`[dry-run] ${entryId}: ${entry.verb} #${entry.prNumber ?? ''} (status=${entry.status})`);

  if (entry.verb === 'HOLD') {
    console.log('[dry-run] would mark held and post an ack — no gate to run');
    return;
  }

  const mode = entry.verb === 'MERGE' ? 'merge' : 'deploy';
  const gate = await runPrePushGate(entry, mode, ghToken);

  console.log('[dry-run] gate result:', JSON.stringify(gate, null, 2));
  if (!gate.pass) {
    console.log(`[dry-run] would FAIL: ${gate.failureReason}`);
    return;
  }
  const denylistNote = gate.denylist.hit ? ` [DENYLIST: ${gate.denylist.matches.join(', ')}]` : '';
  if (entry.verb === 'MERGE') {
    console.log(`[dry-run] would merge ${gate.headRef} into main${denylistNote}`);
  } else {
    console.log(`[dry-run] would deploy functions: ${(entry.functionNames ?? []).join(', ')}${denylistNote}`);
  }
}
