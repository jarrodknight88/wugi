// ─────────────────────────────────────────────────────────────────────
// passRebuildQueue — bounded-concurrency worker pool + per-order debounce
// for coalescing Apple Wallet pass regeneration triggered by colour
// changes. Shared by ticketColorSync.ts (and any future colour-change
// trigger that fans out to regenerateAndPush-style work).
// ─────────────────────────────────────────────────────────────────────
import * as admin from 'firebase-admin';

const db = admin.firestore();

// A burst of edits to the same order within this window collapses into a
// single rebuild using the latest data — tune here if rotate-all needs a
// wider or narrower coalescing window.
export const REBUILD_DEBOUNCE_MS = 5000;

// Cap on simultaneous in-flight regenerations within one trigger
// invocation — bounded so a match on several orders can't fan out into an
// unbounded Promise.all, without falling back to a slow one-at-a-time loop.
export const REBUILD_POOL_CONCURRENCY = 4;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Runs `worker` over `items` with at most `concurrency` in flight at once.
export async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  let cursor = 0;
  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runNext);
  await Promise.all(workers);
}

// Debounces repeated colour edits to the same order into a single rebuild.
//
// Each call merges the latest orderData into pendingPassRebuilds/{orderId}
// and stamps it with a fresh token, then waits out the debounce window. Only
// the invocation that wakes up and still finds its own token wins the
// claim — a later edit within the window overwrites the token (and the
// data), so that later invocation is the one that ends up performing the
// rebuild. This guarantees exactly one rebuild per settled burst, always
// using the most recent colour — no update is ever silently dropped, it is
// coalesced into whichever rebuild fires last.
export async function scheduleRebuild(
  orderId: string,
  orderData: Record<string, unknown>,
  rebuild: (orderId: string, orderData: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const pendingRef = db.collection('pendingPassRebuilds').doc(orderId);
  const myToken = db.collection('pendingPassRebuilds').doc().id;

  await pendingRef.set({
    orderData,
    token: myToken,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await sleep(REBUILD_DEBOUNCE_MS);

  const shouldRebuild = await db.runTransaction(async (tx) => {
    const snap = await tx.get(pendingRef);
    if (!snap.exists || snap.data()?.token !== myToken) return false;
    tx.delete(pendingRef);
    return true;
  });

  if (!shouldRebuild) return;
  await rebuild(orderId, orderData);
}
