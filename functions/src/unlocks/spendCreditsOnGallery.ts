// ─────────────────────────────────────────────────────────────────────
// Wugi — spendCreditsOnGallery
// Gallery-bundle credit redemption (Asana 1218248530084817 / issue #282,
// Part 3 "galleryUnlockCredits (optional bundle price)"). Sibling to
// spendCredits.ts (single-photo redemption) — same ledger/breakdown
// machinery, but unlocks every photo in the gallery for one flat price
// instead of the clamped per-photo cost.
//
// Idempotency: `users/{uid}/galleryBundleUnlocks/{galleryId}` is the
// single source of truth for "already redeemed this bundle" — read and
// written in the SAME transaction as the balance debit, so a retried
// call can never double-charge even if some (or all) of the gallery's
// individual photos were already unlocked another way (free credit,
// single-photo redemption) before the bundle purchase.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { computeRedemptionBreakdown, getCreditEconomyConfig, CreditBalanceBySource } from '../economy/creditEconomy';

const db = admin.firestore();

export const spendCreditsOnGallery = functions.https.onCall(async (data: { galleryId?: string }, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  const uid = context.auth.uid;

  const galleryId = String(data?.galleryId || '');
  if (!galleryId) throw new functions.https.HttpsError('invalid-argument', 'galleryId is required');

  const config = await getCreditEconomyConfig(db);

  const userRef    = db.collection('users').doc(uid);
  const galleryRef = db.collection('galleries').doc(galleryId);
  const bundleRef  = userRef.collection('galleryBundleUnlocks').doc(galleryId);
  const ledgerRef  = userRef.collection('creditLedger').doc();

  return db.runTransaction(async (tx) => {
    const [bundleSnap, userSnap, gallerySnap] = await Promise.all([
      tx.get(bundleRef), tx.get(userRef), tx.get(galleryRef),
    ]);

    if (bundleSnap.exists) {
      return { galleryId, alreadyUnlocked: true, unlockIds: (bundleSnap.data()?.unlockIds as string[]) || [] };
    }
    if (!gallerySnap.exists) {
      throw new functions.https.HttpsError('not-found', `Gallery ${galleryId} not found`);
    }
    const galleryData = gallerySnap.data()!;
    const images: string[] = galleryData.images || [];
    const bundleCostHalfCredits = Number(galleryData.galleryUnlockCreditsHalfCredits);
    if (!Number.isInteger(bundleCostHalfCredits) || bundleCostHalfCredits <= 0) {
      throw new functions.https.HttpsError('failed-precondition', 'This gallery has no bundle price set');
    }
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'User profile not found');
    }

    const balanceBySource: CreditBalanceBySource = userSnap.data()?.creditBalanceBySource || {};
    const currentBalance: number = userSnap.data()?.creditBalanceHalfCredits || 0;
    if (currentBalance < bundleCostHalfCredits) {
      throw new functions.https.HttpsError('failed-precondition', 'Not enough credits — buy more to unlock this gallery.');
    }

    // Firestore transactions require ALL reads before ANY write — read
    // every candidate unlock doc up front (mirrors validateUnlockPurchase's
    // legacy gallery branch) so re-running after a partial prior unlock
    // (e.g. a single-photo redemption) doesn't recreate/overwrite it.
    const unlockRefs = images.map((_, i) => db.collection('unlocks').doc(`${uid}_${galleryId}-${i}`));
    const unlockSnaps = await Promise.all(unlockRefs.map((ref) => tx.get(ref)));

    const { breakdown, newBalanceBySource, totalPayoutCents } = computeRedemptionBreakdown(
      balanceBySource, bundleCostHalfCredits, config.payoutRates
    );

    const now = admin.firestore.FieldValue.serverTimestamp();
    const photographerId: string | null = galleryData.photographerId ?? null;
    const newBalance = currentBalance - bundleCostHalfCredits;
    const unlockIds: string[] = [];

    unlockRefs.forEach((ref, i) => {
      unlockIds.push(ref.id);
      if (!unlockSnaps[i].exists) {
        tx.set(ref, {
          userId: uid,
          photoId: `${galleryId}-${i}`,
          galleryId,
          photoIndex: i,
          photographerId,
          source: 'credit_redemption_bundle',
          redemptionLedgerId: ledgerRef.id,
          createdAt: now,
        });
      }
    });

    tx.set(ledgerRef, {
      source: 'redemption',
      deltaHalfCredits: -bundleCostHalfCredits,
      balanceAfterHalfCredits: newBalance,
      ts: now,
      ref: galleryId,
      photographerId,
      galleryId,
      breakdown,
      totalPayoutCents,
    });

    tx.set(bundleRef, { galleryId, unlockIds, redeemedAt: now, redemptionLedgerId: ledgerRef.id });

    tx.update(userRef, {
      creditBalanceHalfCredits: newBalance,
      creditBalanceBySource: newBalanceBySource,
    });

    return { galleryId, alreadyUnlocked: false, unlockIds, newBalanceHalfCredits: newBalance };
  });
});
