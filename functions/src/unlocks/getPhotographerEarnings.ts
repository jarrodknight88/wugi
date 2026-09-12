// ─────────────────────────────────────────────────────────────────────
// Wugi — getPhotographerEarnings
// Read-only photographer report. Two independent sections:
//   1. `unlocks` visibility counts — every unlock ever recorded for this
//      photographer, bucketed by source, purely informational.
//   2. `payout` — the actual credit-economy Part 5 payout attribution,
//      aggregated from the `creditLedger` collection-group (every user's
//      `users/{uid}/creditLedger` subcollection) filtered to redemption
//      entries carrying this photographerId. This is the single query a
//      payout report needs — no automated payout execution here (P3,
//      post-launch, explicitly out of scope for issue #282).
//
// IMPORTANT: the aggregation sums over the FULL query result before any
// capping — a 200-entry `.limit()` applied before summing would silently
// understate a photographer's total once they pass 200 redemptions. Only
// the returned entry LIST is capped, matching the `unlocks` section's
// existing pattern below.
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

  const [unlockSnap, ledgerSnap] = await Promise.all([
    db.collection('unlocks').where('photographerId', '==', targetPhotographerId).get(),
    db.collectionGroup('creditLedger')
      .where('photographerId', '==', targetPhotographerId)
      .where('source', '==', 'redemption')
      .get(),
  ]);

  let purchasedCount = 0;
  let freeCreditCount = 0;
  let creditRedemptionCount = 0;
  const entries: Array<{ unlockId: string; photoId: string; galleryId: string; userId: string; source: string; createdAt: unknown }> = [];

  unlockSnap.forEach((doc) => {
    const d = doc.data();
    if (d.source === 'purchased') purchasedCount += 1;
    else if (d.source === 'credit_redemption') creditRedemptionCount += 1;
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

  // Aggregate over the FULL result set — no .limit() before summing.
  let creditsRedeemedHalfUnits = 0;
  let totalPayoutCentsOwed = 0;
  const payoutEntries: Array<{ ledgerId: string; halfUnits: number; payoutCents: number; ref: unknown; ts: unknown }> = [];

  ledgerSnap.forEach((doc) => {
    const d = doc.data();
    const breakdown: Array<{ source: string; halfUnits: number; payoutCents: number }> = d.breakdown || [];
    const halfUnits = breakdown.reduce((sum, b) => sum + (b.halfUnits || 0), 0);
    const payoutCents = typeof d.totalPayoutCents === 'number' ? d.totalPayoutCents : breakdown.reduce((sum, b) => sum + (b.payoutCents || 0), 0);
    creditsRedeemedHalfUnits += halfUnits;
    totalPayoutCentsOwed += payoutCents;
    payoutEntries.push({ ledgerId: doc.id, halfUnits, payoutCents, ref: d.ref, ts: d.ts });
  });

  payoutEntries.sort((a, b) => {
    const at = (a.ts as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    const bt = (b.ts as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    return bt - at;
  });

  return {
    photographerId: targetPhotographerId,
    purchasedCount,
    freeCreditCount,
    creditRedemptionCount,
    totalUnlocks: purchasedCount + freeCreditCount + creditRedemptionCount,
    // Read-only report — cap the raw entry list, aggregates above cover the full set.
    entries: entries.slice(0, MAX_ENTRIES),
    payout: {
      creditsRedeemedHalfUnits,
      creditsRedeemed: creditsRedeemedHalfUnits / 2,
      totalPayoutCentsOwed,
      entries: payoutEntries.slice(0, MAX_ENTRIES),
    },
  };
});
