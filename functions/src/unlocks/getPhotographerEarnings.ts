// ─────────────────────────────────────────────────────────────────────
// Wugi — getPhotographerEarnings
// Read-only photographer earnings report over the `unlocks` ledger
// (Asana 1216729526587350, scope item 5). Purchased unlocks are the only
// source that generates payable revenue; free-credit unlocks are counted
// separately for visibility but never contribute to `purchasedCount`.
//
// Payout EXECUTION (marking entries paid, Stripe Connect transfers) is
// explicitly out of scope for this task (P3, post-launch) — this function
// only reads and aggregates, it never mutates `unlocks`.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

const STAFF_ROLES = ['super_admin', 'moderator', 'support'];
const MAX_ENTRIES = 200;

export const getPhotographerEarnings = functions.https.onCall(async (data: { photographerId?: string }, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  const uid = context.auth.uid;
  const targetPhotographerId = data?.photographerId || uid;

  if (targetPhotographerId !== uid) {
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerRole: string = callerDoc.data()?.role || '';
    if (!STAFF_ROLES.includes(callerRole)) {
      throw new functions.https.HttpsError('permission-denied', "Cannot view another photographer's earnings");
    }
  }

  const snap = await db.collection('unlocks')
    .where('photographerId', '==', targetPhotographerId)
    .get();

  let purchasedCount = 0;
  let freeCreditCount = 0;
  const entries: Array<{ unlockId: string; photoId: string; galleryId: string; userId: string; source: string; createdAt: unknown }> = [];

  snap.forEach((doc) => {
    const d = doc.data();
    if (d.source === 'purchased') purchasedCount += 1;
    else freeCreditCount += 1;
    entries.push({
      unlockId: doc.id,
      photoId: d.photoId,
      galleryId: d.galleryId,
      userId: d.userId,
      source: d.source,
      createdAt: d.createdAt,
    });
  });

  entries.sort((a, b) => {
    const at = (a.createdAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    const bt = (b.createdAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    return bt - at;
  });

  return {
    photographerId: targetPhotographerId,
    purchasedCount,
    freeCreditCount,
    totalUnlocks: purchasedCount + freeCreditCount,
    // Read-only report — cap the raw entry list, aggregates above cover the full set.
    entries: entries.slice(0, MAX_ENTRIES),
  };
});
