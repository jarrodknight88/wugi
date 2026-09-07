// ─────────────────────────────────────────────────────────────────────
// Wugi — spendCredits
// Single-photo credit redemption (Asana 1218248530084817 / issue #282,
// Part 2). Extends the spendFreeUnlock.ts transactional pattern (same
// `unlocks/{uid}_{photoId}` deterministic doc id, same all-reads-before-
// writes transaction shape) but debits the credit-economy ledger instead
// of the one-time evergreen free-unlock flag — this is a wholly separate,
// repeatable entitlement source; spendFreeUnlock is untouched.
//
// PRICING: photoCreditCostHalfCredits lives on the gallery doc, clamped
// server-side to {0.5, 1} credit (Part 3's "rogue-price rail" — see
// clampPhotoCreditCostHalfCredits) — never trust whatever raw value is
// stored, and never trust a client-supplied cost.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
  clampPhotoCreditCostHalfCredits,
  computeRedemptionBreakdown,
  getCreditEconomyConfig,
  CreditBalanceBySource,
} from '../economy/creditEconomy';

const db = admin.firestore();

function parsePhotoId(photoId: string): { galleryId: string; index: number } | null {
  // Split on the FINAL hyphen — gallery ids can themselves contain hyphens.
  // Must stay in sync with mobile-app/src/utils/photoId.ts and
  // functions/src/unlocks/spendFreeUnlock.ts.
  const m = String(photoId || '').match(/^(.*)-(\d+)$/);
  if (!m) return null;
  return { galleryId: m[1], index: Number(m[2]) };
}

export const spendCredits = functions.https.onCall(async (data: { photoId?: string }, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  const uid = context.auth.uid;

  const photoId = String(data?.photoId || '');
  const parsed = parsePhotoId(photoId);
  if (!parsed) {
    throw new functions.https.HttpsError('invalid-argument', 'photoId must be the synthetic `${galleryId}-${index}` format');
  }
  const { galleryId, index } = parsed;

  const config = await getCreditEconomyConfig(db);

  const unlockRef  = db.collection('unlocks').doc(`${uid}_${photoId}`);
  const userRef    = db.collection('users').doc(uid);
  const galleryRef = db.collection('galleries').doc(galleryId);
  const ledgerRef  = userRef.collection('creditLedger').doc();

  return db.runTransaction(async (tx) => {
    // All reads must happen before any writes in a Firestore transaction.
    const [unlockSnap, userSnap, gallerySnap] = await Promise.all([
      tx.get(unlockRef),
      tx.get(userRef),
      tx.get(galleryRef),
    ]);

    // Idempotent no-op: already unlocked by ANY source (free-credit,
    // credit redemption, legacy purchase) — never double-charge a
    // re-tap/retry.
    if (unlockSnap.exists) {
      const existing = unlockSnap.data()!;
      return { unlockId: unlockRef.id, alreadyUnlocked: true, source: existing.source as string };
    }

    if (!gallerySnap.exists) {
      throw new functions.https.HttpsError('not-found', `Gallery ${galleryId} not found`);
    }
    const galleryData = gallerySnap.data()!;
    const images: string[] = galleryData.images || [];
    if (!Number.isInteger(index) || index < 0 || index >= images.length) {
      throw new functions.https.HttpsError('invalid-argument', 'Photo index out of range for gallery');
    }
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'User profile not found');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    // photographerId is resolved server-side from the gallery doc — never
    // trust a client-supplied photographerId, it feeds the payout ledger.
    const photographerId: string | null = galleryData.photographerId ?? null;

    // Promo galleries are free — no ledger movement, no payout attribution.
    if (galleryData.promoFlag === true) {
      tx.set(unlockRef, {
        userId: uid, photoId, galleryId, photoIndex: index, photographerId,
        source: 'promo_free', creditsSpentHalfCredits: 0, createdAt: now,
      });
      return { unlockId: unlockRef.id, alreadyUnlocked: false, source: 'promo_free' as const };
    }

    const costHalfCredits = clampPhotoCreditCostHalfCredits(
      galleryData.photoCreditCostHalfCredits,
      config.defaultPhotoCreditCostHalfCredits
    );

    const balanceBySource: CreditBalanceBySource = userSnap.data()?.creditBalanceBySource || {};
    const currentBalance: number = userSnap.data()?.creditBalanceHalfCredits || 0;

    if (currentBalance < costHalfCredits) {
      throw new functions.https.HttpsError('failed-precondition', 'Not enough credits — buy more to unlock this photo.');
    }

    const { breakdown, newBalanceBySource, totalPayoutCents } = computeRedemptionBreakdown(
      balanceBySource, costHalfCredits, config.payoutRates
    );
    const newBalance = currentBalance - costHalfCredits;

    tx.set(unlockRef, {
      userId: uid,
      photoId,
      galleryId,
      photoIndex: index,
      photographerId,
      source: 'credit_redemption',
      creditsSpentHalfCredits: costHalfCredits,
      redemptionLedgerId: ledgerRef.id,
      createdAt: now,
    });

    tx.set(ledgerRef, {
      source: 'redemption',
      deltaHalfCredits: -costHalfCredits,
      balanceAfterHalfCredits: newBalance,
      ts: now,
      ref: unlockRef.id,
      photographerId,
      galleryId,
      photoId,
      breakdown,
      totalPayoutCents,
    });

    tx.update(userRef, {
      creditBalanceHalfCredits: newBalance,
      creditBalanceBySource: newBalanceBySource,
    });

    return {
      unlockId: unlockRef.id,
      alreadyUnlocked: false,
      source: 'credit_redemption' as const,
      newBalanceHalfCredits: newBalance,
    };
  });
});
