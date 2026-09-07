// ─────────────────────────────────────────────────────────────────────
// Wugi — getPhotographerEarnings
// Read-only photographer earnings report. Originally (Asana
// 1216729526587350) aggregated the legacy `unlocks` ledger (free-credit vs
// direct-purchase counts). Issue #282 / Asana 1218248530084817 (3-SKU
// credit economy) adds a second aggregation over the `creditLedger`
// collection-group's `redemption` entries — THIS is the payable-revenue
// source going forward (Part 5: "Photographer earnings = pure function of
// credits redeemed on their photos"). The legacy `unlocks`-based counts
// are kept for historical continuity, not because they still generate
// revenue (unlock_single_photo/unlock_gallery no longer sell).
//
// Payout EXECUTION (marking entries paid, Stripe Connect transfers) is
// explicitly out of scope for this task — this function only reads and
// aggregates, it never mutates `unlocks` or `creditLedger`.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

const MAX_CREDIT_ENTRIES = 200;

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

  // Credit-economy payout attribution (issue #282 Part 5) — every
  // redemption ledger entry across every user's creditLedger subcollection
  // that paid this photographer, via a collection-group query. Each entry
  // already carries its own `totalPayoutCents` (computed at redemption
  // time from config/creditEconomy.payoutRates — see
  // functions/src/economy/creditEconomy.ts computeRedemptionBreakdown),
  // so this is a single query + sum, not a re-derivation.
  const redemptionsSnap = await db.collectionGroup('creditLedger')
    .where('source', '==', 'redemption')
    .where('photographerId', '==', targetPhotographerId)
    .get();

  let redemptionCount = 0;
  let halfCreditsRedeemed = 0;
  let payoutCentsTotal = 0;
  const creditEntries: Array<{
    ledgerId: string; galleryId: string; photoId?: string;
    deltaHalfCredits: number; totalPayoutCents: number; ts: unknown;
  }> = [];

  redemptionsSnap.forEach((doc) => {
    const d = doc.data();
    redemptionCount += 1;
    halfCreditsRedeemed += Math.abs(d.deltaHalfCredits || 0);
    payoutCentsTotal += d.totalPayoutCents || 0;
    creditEntries.push({
      ledgerId: doc.id,
      galleryId: d.galleryId,
      photoId: d.photoId,
      deltaHalfCredits: d.deltaHalfCredits,
      totalPayoutCents: d.totalPayoutCents,
      ts: d.ts,
    });
  });

  creditEntries.sort((a, b) => {
    const at = (a.ts as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    const bt = (b.ts as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    return bt - at;
  });

  return {
    photographerId: targetPhotographerId,
    // Legacy `unlocks`-based counts — historical only, see module doc comment.
    purchasedCount,
    freeCreditCount,
    totalUnlocks: purchasedCount + freeCreditCount,
    // Read-only report — cap the raw entry list, aggregates above cover the full set.
    entries: entries.slice(0, MAX_ENTRIES),
    // Credit-economy payout report — the live payable-revenue source.
    creditEconomy: {
      redemptionCount,
      halfCreditsRedeemed,
      payoutCentsTotal,
      entries: creditEntries.slice(0, MAX_CREDIT_ENTRIES),
    },
  };
});
