// ─────────────────────────────────────────────────────────────────────
// Wugi — spendCredits
// Redeems credits from a user's balance to unlock a photo or a full
// gallery — the credit-economy counterpart to
// functions/src/unlocks/spendFreeUnlock.ts, extending that same
// transactional double-spend-safe pattern (all reads before any writes,
// idempotent re-invocation on an already-unlocked target) rather than
// replacing it. `spendFreeUnlock` itself is untouched — it still spends
// the one evergreen free-credit flag, a separate mechanism.
//
// Writes to the SAME top-level `unlocks` collection spendFreeUnlock/
// validateUnlockPurchase use (source: 'credit_redemption'), so
// MyPhotosScreen / isPhotoUnlocked need no changes to recognize a
// credit-redeemed photo as unlocked.
//
// PAYOUT ATTRIBUTION (Part 5): balance is one fungible pool per user, not
// per-grant lots. We bucket the balance per SOURCE
// (creditBalanceBySourceHalfUnits) and draw down in the fixed order from
// creditEconomy.ts (DRAWDOWN_ORDER) — house-funded credits first, paid
// credits last — splitting a single redemption's payout proportionally
// across whichever source(s) it actually drew from, priced off *current*
// config at spend time. This is documented as a design call worth a
// second look before it touches real payout numbers (see PR description).
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
  DRAWDOWN_ORDER, getCreditEconomyConfig, clampPhotoCreditCostHalfUnits, payoutCentsForRedemption,
  CreditLedgerSource, CreditEconomyConfig,
} from './creditEconomy';

const db = admin.firestore();

function parsePhotoId(photoId: string): { galleryId: string; index: number } | null {
  // Split on the FINAL hyphen — must stay in sync with spendFreeUnlock.ts
  // and mobile-app/src/utils/photoId.ts.
  const m = String(photoId || '').match(/^(.*)-(\d+)$/);
  if (!m) return null;
  return { galleryId: m[1], index: Number(m[2]) };
}

type BalanceBySource = Record<string, number>;

type Breakdown = { source: CreditLedgerSource; halfUnits: number; payoutCents: number };

// Draws `cost` half-credit units out of `balanceBySource` in DRAWDOWN_ORDER,
// returning the per-source breakdown and the resulting balance map. Throws
// if the total balance can't cover `cost` — callers must check total
// balance >= cost themselves before calling for a clean error message, but
// this is the actual authority on what gets decremented from where.
function drawDown(balanceBySource: BalanceBySource, cost: number, config: CreditEconomyConfig) {
  let remaining = cost;
  const breakdown: Breakdown[] = [];
  const nextBalance: BalanceBySource = { ...balanceBySource };

  for (const source of DRAWDOWN_ORDER) {
    if (remaining <= 0) break;
    const available = nextBalance[source] ?? 0;
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    nextBalance[source] = available - take;
    remaining -= take;
    breakdown.push({ source, halfUnits: take, payoutCents: payoutCentsForRedemption(source, take, config) });
  }

  if (remaining > 0) {
    throw new functions.https.HttpsError('failed-precondition', 'insufficient_credits');
  }

  return { breakdown, nextBalance };
}

function totalHalfUnits(balanceBySource: BalanceBySource): number {
  return Object.values(balanceBySource).reduce((sum, v) => sum + (v || 0), 0);
}

export const spendCredits = functions.https.onCall(async (
  data: { kind?: 'photo' | 'gallery'; photoId?: string; galleryId?: string },
  context,
) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  const uid = context.auth.uid;
  const kind = data?.kind;
  if (kind !== 'photo' && kind !== 'gallery') {
    throw new functions.https.HttpsError('invalid-argument', 'kind must be "photo" or "gallery"');
  }

  const config = await getCreditEconomyConfig();
  const userRef = db.collection('users').doc(uid);

  if (kind === 'photo') {
    const photoId = String(data?.photoId || '');
    const parsed = parsePhotoId(photoId);
    if (!parsed) {
      throw new functions.https.HttpsError('invalid-argument', 'photoId must be the synthetic `${galleryId}-${index}` format');
    }
    const { galleryId, index } = parsed;
    const unlockRef = db.collection('unlocks').doc(`${uid}_${photoId}`);
    const galleryRef = db.collection('galleries').doc(galleryId);
    const ledgerRef = userRef.collection('creditLedger').doc();

    return db.runTransaction(async (tx) => {
      const [unlockSnap, userSnap, gallerySnap] = await Promise.all([
        tx.get(unlockRef), tx.get(userRef), tx.get(galleryRef),
      ]);

      if (unlockSnap.exists) {
        const existing = unlockSnap.data()!;
        return { unlockId: unlockRef.id, alreadyUnlocked: true, source: existing.source as string };
      }
      if (!gallerySnap.exists) {
        throw new functions.https.HttpsError('not-found', `Gallery ${galleryId} not found`);
      }
      const images: string[] = gallerySnap.data()?.images || [];
      if (!Number.isInteger(index) || index < 0 || index >= images.length) {
        throw new functions.https.HttpsError('invalid-argument', 'Photo index out of range for gallery');
      }
      if (!userSnap.exists) {
        throw new functions.https.HttpsError('failed-precondition', 'User profile not found');
      }

      const photographerId: string | null = gallerySnap.data()?.photographerId ?? null;
      const galleryCostRaw = gallerySnap.data()?.photoCreditCostHalfUnits;
      const cost = typeof galleryCostRaw === 'number'
        ? clampPhotoCreditCostHalfUnits(galleryCostRaw, config)
        : config.defaultPhotoCreditCostHalfUnits;

      const balanceBySource: BalanceBySource = userSnap.data()?.creditBalanceBySourceHalfUnits || {};
      if (totalHalfUnits(balanceBySource) < cost) {
        throw new functions.https.HttpsError('failed-precondition', 'insufficient_credits');
      }
      const { breakdown, nextBalance } = drawDown(balanceBySource, cost, config);
      const totalPayoutCents = breakdown.reduce((sum, b) => sum + b.payoutCents, 0);
      const now = admin.firestore.FieldValue.serverTimestamp();
      const newTotal = totalHalfUnits(nextBalance);

      tx.set(unlockRef, {
        userId: uid,
        photoId,
        galleryId,
        photoIndex: index,
        photographerId,
        source: 'credit_redemption',
        creditsSpentHalfUnits: cost,
        ledgerEntryId: ledgerRef.id,
        createdAt: now,
      });

      tx.set(ledgerRef, {
        source: 'redemption',
        delta: -cost,
        ts: now,
        ref: { kind: 'photo', galleryId, photoId },
        breakdown,
        photographerId,
        totalPayoutCents,
        balanceAfterHalfUnits: newTotal,
      });

      tx.update(userRef, {
        creditBalanceHalfUnits: newTotal,
        creditBalanceBySourceHalfUnits: nextBalance,
        updatedAt: now,
      });

      return { unlockId: unlockRef.id, alreadyUnlocked: false, source: 'credit_redemption' as const, creditsSpentHalfUnits: cost, newBalanceHalfUnits: newTotal };
    });
  }

  // kind === 'gallery' — bundle-unlock every photo in the gallery.
  const galleryId = String(data?.galleryId || '');
  if (!galleryId) throw new functions.https.HttpsError('invalid-argument', 'galleryId is required');
  const galleryRef = db.collection('galleries').doc(galleryId);
  const bundleRef = db.collection('galleryBundleUnlocks').doc(`${uid}_${galleryId}`);
  const ledgerRef = userRef.collection('creditLedger').doc();

  return db.runTransaction(async (tx) => {
    const [bundleSnap, userSnap, gallerySnap] = await Promise.all([
      tx.get(bundleRef), tx.get(userRef), tx.get(galleryRef),
    ]);

    if (bundleSnap.exists) {
      return { alreadyUnlocked: true, unlockIds: (bundleSnap.data()?.unlockIds as string[]) || [] };
    }
    if (!gallerySnap.exists) {
      throw new functions.https.HttpsError('not-found', `Gallery ${galleryId} not found`);
    }
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'User profile not found');
    }

    const images: string[] = gallerySnap.data()?.images || [];
    const photographerId: string | null = gallerySnap.data()?.photographerId ?? null;
    const galleryData = gallerySnap.data() || {};
    const perPhotoCostRaw = galleryData.photoCreditCostHalfUnits;
    const perPhotoCost = typeof perPhotoCostRaw === 'number'
      ? clampPhotoCreditCostHalfUnits(perPhotoCostRaw, config)
      : config.defaultPhotoCreditCostHalfUnits;
    const bundleCostRaw = galleryData.galleryUnlockCreditsHalfUnits;
    const cost = typeof bundleCostRaw === 'number' && bundleCostRaw > 0
      ? Math.round(bundleCostRaw)
      : perPhotoCost * images.length;

    const unlockRefs = images.map((_, index) => db.collection('unlocks').doc(`${uid}_${galleryId}-${index}`));
    const unlockSnaps = await Promise.all(unlockRefs.map((ref) => tx.get(ref)));

    const balanceBySource: BalanceBySource = userSnap.data()?.creditBalanceBySourceHalfUnits || {};
    if (totalHalfUnits(balanceBySource) < cost) {
      throw new functions.https.HttpsError('failed-precondition', 'insufficient_credits');
    }
    const { breakdown, nextBalance } = drawDown(balanceBySource, cost, config);
    const totalPayoutCents = breakdown.reduce((sum, b) => sum + b.payoutCents, 0);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const newTotal = totalHalfUnits(nextBalance);

    const unlockIds: string[] = [];
    unlockRefs.forEach((unlockRef, index) => {
      unlockIds.push(unlockRef.id);
      if (!unlockSnaps[index].exists) {
        tx.set(unlockRef, {
          userId: uid,
          photoId: `${galleryId}-${index}`,
          galleryId,
          photoIndex: index,
          photographerId,
          source: 'credit_redemption',
          ledgerEntryId: ledgerRef.id,
          createdAt: now,
        });
      }
    });

    tx.set(bundleRef, { userId: uid, galleryId, unlockIds, ledgerEntryId: ledgerRef.id, createdAt: now });

    tx.set(ledgerRef, {
      source: 'redemption',
      delta: -cost,
      ts: now,
      ref: { kind: 'gallery', galleryId },
      breakdown,
      photographerId,
      totalPayoutCents,
      balanceAfterHalfUnits: newTotal,
    });

    tx.update(userRef, {
      creditBalanceHalfUnits: newTotal,
      creditBalanceBySourceHalfUnits: nextBalance,
      updatedAt: now,
    });

    return { alreadyUnlocked: false, unlockIds, creditsSpentHalfUnits: cost, newBalanceHalfUnits: newTotal };
  });
});
