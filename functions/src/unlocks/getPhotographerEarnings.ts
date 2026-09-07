// ─────────────────────────────────────────────────────────────────────
// Wugi — getPhotographerEarnings
// Read-only photographer earnings report over the legacy `unlocks`
// ledger (Asana 1216729526587350, scope item 5) PLUS the credit-economy
// payout report (issue #282, Part 5) over the `creditLedger` collection
// group. Purchased unlocks are the only `unlocks` source that generates
// payable revenue; free-credit unlocks are counted separately for
// visibility but never contribute to `purchasedCount`. The two reports
// are independent and additive — pre-cutover `unlocks` purchases and
// post-cutover credit redemptions both show up, under separate keys, so
// nothing already relying on the original response shape breaks.
//
// Payout EXECUTION (marking entries paid, Stripe Connect transfers) is
// explicitly out of scope for this task (P3, post-launch) — this function
// only reads and aggregates, it never mutates `unlocks` or `creditLedger`.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import type { FundingSource } from './creditEconomy';

const db = admin.firestore();

const STAFF_ROLES = ['super_admin', 'moderator', 'support'];
const MAX_ENTRIES = 200;

type RedemptionDrawdownEntry = { source: FundingSource; halfCredits: number; payoutCents: number };

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
  let creditCount = 0; // source: 'credit' — post-cutover redemptions, tracked separately below via creditLedger too
  const entries: Array<{ unlockId: string; photoId: string; galleryId: string; userId: string; source: string; createdAt: unknown }> = [];

  snap.forEach((doc) => {
    const d = doc.data();
    // NOTE: 'credit' (issue #282) is counted here for `totalUnlocks`
    // visibility but intentionally NOT folded into `purchasedCount` —
    // that field's payable-revenue meaning predates the credit economy
    // (see module doc comment). Its actual dollar payout is reported
    // separately below, computed from creditLedger, not from this doc.
    if (d.source === 'purchased') purchasedCount += 1;
    else if (d.source === 'credit') creditCount += 1;
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

  // ── Credit-economy payout report (Part 5) ────────────────────────────
  // Collection-group query over every user's `creditLedger` subcollection,
  // filtered to this photographer's redemption entries. Only 'redemption'
  // entries ever carry `photographerId`, so the two equality filters
  // together fully scope the query (no other ledger entry kind can match).
  // Requires the composite index added to firestore.indexes.json
  // (collectionGroup creditLedger: photographerId ASC, source ASC, ts DESC).
  //
  // UNLIMITED read, same as the `unlocks` query above — the summary
  // totals (creditsRedeemedHalfCredits, totalPayoutCentsOwed,
  // payoutBySource) must cover every redemption ever made, not just the
  // most recent page, or a photographer's payout figure silently
  // understates once they pass MAX_ENTRIES redemptions. Only the
  // `entries` list returned below is capped, exactly like `entries`
  // above.
  const ledgerSnap = await db.collectionGroup('creditLedger')
    .where('photographerId', '==', targetPhotographerId)
    .where('source', '==', 'redemption')
    .orderBy('ts', 'desc')
    .get();

  let creditsRedeemedHalfCredits = 0;
  let totalPayoutCentsOwed = 0;
  const payoutBySource: Record<string, { halfCredits: number; payoutCents: number }> = {};
  const redemptionEntries: Array<{
    ledgerId: string; galleryId: string; photoId: string | null;
    halfCredits: number; payoutCents: number; ts: unknown;
  }> = [];

  ledgerSnap.forEach((doc) => {
    const d = doc.data();
    const halfCredits = Math.abs(Number(d.deltaHalfCredits) || 0);
    const totalPayoutCents = Number(d.totalPayoutCents) || 0;
    creditsRedeemedHalfCredits += halfCredits;
    totalPayoutCentsOwed += totalPayoutCents;
    const drawdown = (d.drawdown || []) as RedemptionDrawdownEntry[];
    drawdown.forEach((entry) => {
      const bucket = payoutBySource[entry.source] || { halfCredits: 0, payoutCents: 0 };
      bucket.halfCredits += entry.halfCredits;
      bucket.payoutCents += entry.payoutCents;
      payoutBySource[entry.source] = bucket;
    });
    redemptionEntries.push({
      ledgerId: doc.id,
      galleryId: d.galleryId,
      photoId: d.photoId ?? null,
      halfCredits,
      payoutCents: totalPayoutCents,
      ts: d.ts,
    });
  });

  return {
    photographerId: targetPhotographerId,
    purchasedCount,
    freeCreditCount,
    creditCount,
    totalUnlocks: purchasedCount + freeCreditCount + creditCount,
    // Read-only report — cap the raw entry list, aggregates above cover the full set.
    entries: entries.slice(0, MAX_ENTRIES),
    // Credit-economy payout report (Part 5) — total credits redeemed
    // funding this photographer's galleries, total payout cents owed
    // (attribution only — no execution/transfer), and a per-funding-source
    // breakdown, all computed over the FULL redemption history. Only the
    // returned `entries` list is capped at MAX_ENTRIES most-recent, like
    // `entries` above.
    creditPayoutReport: {
      creditsRedeemedHalfCredits,
      totalPayoutCentsOwed,
      payoutBySource,
      entries: redemptionEntries.slice(0, MAX_ENTRIES),
    },
  };
});
