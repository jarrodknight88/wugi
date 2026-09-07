// ─────────────────────────────────────────────────────────────────────
// Wugi — getPhotographerEarnings
// Read-only photographer earnings report over the `unlocks` ledger
// (Asana 1216729526587350, scope item 5). Legacy 'purchased' unlocks
// (pre credit-economy, Asana 1216729383901466 / issue #252) are counted
// for visibility but no longer generate ongoing revenue — the IAP catalog
// they came from was replaced. free-credit unlocks are also visibility-only.
//
// Credit economy (Asana 1218248530084817 / issue #282, Part 5): every
// `credit-redemption` unlock already carries `photographerId` +
// `creditsCost` (written by functions/src/creditEconomy/spendCredit.ts),
// so payout = a single query over this same collection, no new ledger or
// index needed — `creditsRedeemed * payoutPerCreditCents` IS the payout,
// by construction (a pure function of redemptions, per the issue).
//
// Payout EXECUTION (marking entries paid, Stripe Connect transfers) is
// explicitly out of scope for this task — this function only reads and
// aggregates, it never mutates `unlocks`.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { getCreditEconomyConfig } from '../creditEconomy/config';

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
  let creditRedemptionCount = 0;
  let creditsRedeemed = 0;
  const entries: Array<{ unlockId: string; photoId: string; galleryId: string; userId: string; source: string; creditsCost?: number; createdAt: unknown }> = [];

  snap.forEach((doc) => {
    const d = doc.data();
    if (d.source === 'purchased') purchasedCount += 1;
    else if (d.source === 'credit-redemption') {
      creditRedemptionCount += 1;
      creditsRedeemed += Number(d.creditsCost || 0);
    } else freeCreditCount += 1;
    entries.push({
      unlockId: doc.id,
      photoId: d.photoId,
      galleryId: d.galleryId,
      userId: d.userId,
      source: d.source,
      creditsCost: d.source === 'credit-redemption' ? Number(d.creditsCost || 0) : undefined,
      createdAt: d.createdAt,
    });
  });

  entries.sort((a, b) => {
    const at = (a.createdAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    const bt = (b.createdAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    return bt - at;
  });

  const { payoutPerCreditCents } = await getCreditEconomyConfig();

  return {
    photographerId: targetPhotographerId,
    purchasedCount,
    freeCreditCount,
    creditRedemptionCount,
    creditsRedeemed,
    payoutPerCreditCents,
    payoutCents: creditsRedeemed * payoutPerCreditCents,
    totalUnlocks: purchasedCount + freeCreditCount + creditRedemptionCount,
    // Read-only report — cap the raw entry list, aggregates above cover the full set.
    entries: entries.slice(0, MAX_ENTRIES),
  };
});
