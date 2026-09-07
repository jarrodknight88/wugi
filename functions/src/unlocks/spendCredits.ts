// ─────────────────────────────────────────────────────────────────────
// Wugi — spendCredits
// Redeems half-credits from a user's fungible balance to unlock a single
// photo or a whole gallery bundle, writing the SAME `unlocks` entitlement
// doc shape spendFreeUnlock.ts / validateUnlockPurchase.ts use (source:
// 'credit' this time) — MyPhotosScreen / isPhotoUnlocked need no changes.
// Mirrors spendFreeUnlock's transactional balance-decrement pattern:
// every tx.get() happens before any tx.set()/tx.update(), doc ids are
// deterministic (idempotent retries are a no-op), and photographerId is
// resolved server-side from the gallery doc only — never trust a
// client-supplied photographerId, it feeds the payout ledger.
//
// PRICING is server-side only (functions/src/unlocks/creditEconomy.ts +
// per-gallery override fields on the gallery doc) — the client never
// tells us a price, only "which photo/gallery".
//
// DRAWDOWN ORDER / PAYOUT ATTRIBUTION (Part 5): a user's balance is ONE
// fungible total (users/{uid}.creditBalanceHalfCredits), not tracked
// per-purchase-lot. To still attribute payout to the correct funding
// source(s), we ALSO track a per-source remaining balance
// (users/{uid}.creditBalanceBySourceHalfCredits) and draw down
// deterministically in creditEconomy.DRAWDOWN_ORDER:
//   promo → signup_grant → iap_credits_1 → iap_credits_3 → iap_credits_5
// (house-funded sources first, since they pay out at half the rate of a
// paid pack; the three paid packs are priced identically so their
// relative order is an arbitrary but stable tie-break). If a single
// redemption's cost is covered by more than one source (e.g. a user's
// last ½ credit of signup_grant plus ½ credit of iap_credits_1), the
// ledger entry's `drawdown` array records exactly how many half-credits
// (and resulting payout cents) came from each source — see
// creditEconomy.payoutCentsForSource for the per-source rounding rule.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
  DRAWDOWN_ORDER, getCreditEconomyConfig, clampPhotoCreditCostHalfCredits, payoutCentsForSource,
  type FundingSource,
} from './creditEconomy';

const db = admin.firestore();

function parsePhotoId(photoId: string): { galleryId: string; index: number } | null {
  // Split on the FINAL hyphen — gallery ids can themselves contain hyphens.
  // Must stay in sync with spendFreeUnlock.ts / mobile-app/src/utils/photoId.ts.
  const m = String(photoId || '').match(/^(.*)-(\d+)$/);
  if (!m) return null;
  return { galleryId: m[1], index: Number(m[2]) };
}

type GalleryData = {
  images?: string[];
  photographerId?: string | null;
  photoCreditCostHalfCredits?: number;
  galleryUnlockCreditsHalfCredits?: number;
  free?: boolean;
  promoFlag?: boolean;
};

function isFreeGallery(gallery: GalleryData | undefined): boolean {
  return gallery?.free === true || gallery?.promoFlag === true;
}

// Deducts `cost` half-credits from `bySource` following DRAWDOWN_ORDER,
// mutating a COPY and returning both the updated map and the per-source
// breakdown actually drawn from. Throws if the per-source map doesn't
// have enough tracked balance to cover `cost` — this should never happen
// if every balance-mutating path (onUserCreated, validateUnlockPurchase,
// spendCredits — the only three) keeps creditBalanceHalfCredits and
// creditBalanceBySourceHalfCredits in lockstep; treated as a defensive
// invariant check, not an expected user-facing error.
function drawDown(
  bySource: Partial<Record<FundingSource, number>>,
  cost: number
): { newBySource: Partial<Record<FundingSource, number>>; drawn: Array<{ source: FundingSource; halfCredits: number }> } {
  const newBySource = { ...bySource };
  const drawn: Array<{ source: FundingSource; halfCredits: number }> = [];
  let remaining = cost;
  for (const source of DRAWDOWN_ORDER) {
    if (remaining <= 0) break;
    const available = newBySource[source] ?? 0;
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    newBySource[source] = available - take;
    drawn.push({ source, halfCredits: take });
    remaining -= take;
  }
  if (remaining > 0) {
    throw new functions.https.HttpsError(
      'internal',
      'Credit balance inconsistency: per-source balance cannot cover the tracked total. Contact support.'
    );
  }
  return { newBySource, drawn };
}

export const spendCredits = functions.https.onCall(async (
  data: { kind?: 'photo' | 'gallery'; photoId?: string; galleryId?: string },
  context
) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  const uid = context.auth.uid;

  const kind = data?.kind;
  if (kind !== 'photo' && kind !== 'gallery') {
    throw new functions.https.HttpsError('invalid-argument', "kind must be 'photo' or 'gallery'");
  }

  // Config read is outside the transaction — it changes rarely and a
  // stale read only risks pricing a single redemption off a moment-old
  // config value, which is an acceptable race (same tradeoff every
  // "read config, then transact" pattern makes).
  const config = await getCreditEconomyConfig();
  const userRef = db.collection('users').doc(uid);

  if (kind === 'photo') {
    const photoId = String(data?.photoId || '');
    const parsed = parsePhotoId(photoId);
    if (!parsed) {
      throw new functions.https.HttpsError('invalid-argument', 'photoId must be the synthetic `${galleryId}-${index}` format');
    }
    const { galleryId, index } = parsed;
    const galleryRef = db.collection('galleries').doc(galleryId);
    const unlockRef = db.collection('unlocks').doc(`${uid}_${photoId}`);

    return db.runTransaction(async (tx) => {
      const [unlockSnap, gallerySnap, userSnap] = await Promise.all([
        tx.get(unlockRef), tx.get(galleryRef), tx.get(userRef),
      ]);

      if (unlockSnap.exists) {
        return { unlockIds: [unlockRef.id], alreadyUnlocked: true, spentHalfCredits: 0, balanceAfterHalfCredits: userSnap.data()?.creditBalanceHalfCredits ?? 0 };
      }
      if (!gallerySnap.exists) {
        throw new functions.https.HttpsError('not-found', `Gallery ${galleryId} not found`);
      }
      const gallery = gallerySnap.data() as GalleryData;
      const images = gallery.images || [];
      if (!Number.isInteger(index) || index < 0 || index >= images.length) {
        throw new functions.https.HttpsError('invalid-argument', 'Photo index out of range for gallery');
      }

      const cost = isFreeGallery(gallery)
        ? 0
        : clampPhotoCreditCostHalfCredits(gallery.photoCreditCostHalfCredits, config.defaultPhotoCreditCostHalfCredits);

      const now = admin.firestore.FieldValue.serverTimestamp();
      const photographerId: string | null = gallery.photographerId ?? null;
      const currentBalance: number = userSnap.exists ? (userSnap.data()?.creditBalanceHalfCredits ?? 0) : 0;
      const currentBySource: Partial<Record<FundingSource, number>> =
        userSnap.exists ? (userSnap.data()?.creditBalanceBySourceHalfCredits ?? {}) : {};

      if (cost > currentBalance) {
        throw new functions.https.HttpsError('failed-precondition', 'Not enough credits');
      }

      const { newBySource, drawn } = drawDown(currentBySource, cost);
      const balanceAfterHalfCredits = currentBalance - cost;
      const breakdown = drawn.map(d => ({
        source: d.source,
        halfCredits: d.halfCredits,
        payoutCents: payoutCentsForSource(d.halfCredits, config.payoutRates[d.source]),
      }));
      const totalPayoutCents = breakdown.reduce((sum, b) => sum + b.payoutCents, 0);

      const ledgerRef = userRef.collection('creditLedger').doc(unlockRef.id);
      tx.set(ledgerRef, {
        source: 'redemption',
        deltaHalfCredits: -cost,
        balanceAfterHalfCredits,
        ts: now,
        ref: unlockRef.id,
        photographerId,
        galleryId,
        photoId,
        drawdown: breakdown,
        totalPayoutCents,
      });
      tx.set(userRef, {
        creditBalanceHalfCredits: balanceAfterHalfCredits,
        creditBalanceBySourceHalfCredits: newBySource,
        updatedAt: now,
      }, { merge: true });
      tx.set(unlockRef, {
        userId: uid,
        photoId,
        galleryId,
        photoIndex: index,
        photographerId,
        source: 'credit',
        redemptionRef: ledgerRef.id,
        createdAt: now,
      });

      return { unlockIds: [unlockRef.id], alreadyUnlocked: false, spentHalfCredits: cost, balanceAfterHalfCredits };
    });
  }

  // kind === 'gallery'
  const galleryId = String(data?.galleryId || '');
  if (!galleryId) throw new functions.https.HttpsError('invalid-argument', 'galleryId is required');
  const galleryRef = db.collection('galleries').doc(galleryId);

  return db.runTransaction(async (tx) => {
    const [gallerySnap, userSnap] = await Promise.all([tx.get(galleryRef), tx.get(userRef)]);
    if (!gallerySnap.exists) {
      throw new functions.https.HttpsError('not-found', `Gallery ${galleryId} not found`);
    }
    const gallery = gallerySnap.data() as GalleryData;
    const images = gallery.images || [];
    const unlockRefs = images.map((_, index) => db.collection('unlocks').doc(`${uid}_${galleryId}-${index}`));
    const unlockSnaps = await Promise.all(unlockRefs.map((ref) => tx.get(ref)));

    // Whole gallery already fully unlocked for this user — no-op, matching
    // validateUnlockPurchase's per-index idempotency but at the collection
    // level (repeat taps on "unlock full gallery" never double-charge).
    if (unlockSnaps.every(s => s.exists)) {
      return {
        unlockIds: unlockRefs.map(r => r.id),
        alreadyUnlocked: true,
        spentHalfCredits: 0,
        balanceAfterHalfCredits: userSnap.data()?.creditBalanceHalfCredits ?? 0,
      };
    }

    let cost: number;
    if (isFreeGallery(gallery)) {
      cost = 0;
    } else {
      const bundle = gallery.galleryUnlockCreditsHalfCredits;
      if (typeof bundle !== 'number' || !Number.isInteger(bundle) || bundle < 0) {
        throw new functions.https.HttpsError('failed-precondition', 'This gallery does not offer a bundle unlock');
      }
      cost = bundle;
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const photographerId: string | null = gallery.photographerId ?? null;
    const currentBalance: number = userSnap.exists ? (userSnap.data()?.creditBalanceHalfCredits ?? 0) : 0;
    const currentBySource: Partial<Record<FundingSource, number>> =
      userSnap.exists ? (userSnap.data()?.creditBalanceBySourceHalfCredits ?? {}) : {};

    if (cost > currentBalance) {
      throw new functions.https.HttpsError('failed-precondition', 'Not enough credits');
    }

    const { newBySource, drawn } = drawDown(currentBySource, cost);
    const balanceAfterHalfCredits = currentBalance - cost;
    const breakdown = drawn.map(d => ({
      source: d.source,
      halfCredits: d.halfCredits,
      payoutCents: payoutCentsForSource(d.halfCredits, config.payoutRates[d.source]),
    }));
    const totalPayoutCents = breakdown.reduce((sum, b) => sum + b.payoutCents, 0);

    const ledgerRef = userRef.collection('creditLedger').doc(`${galleryId}-bundle`);
    tx.set(ledgerRef, {
      source: 'redemption',
      deltaHalfCredits: -cost,
      balanceAfterHalfCredits,
      ts: now,
      ref: `${galleryId}-bundle`,
      photographerId,
      galleryId,
      photoId: null,
      drawdown: breakdown,
      totalPayoutCents,
    });
    tx.set(userRef, {
      creditBalanceHalfCredits: balanceAfterHalfCredits,
      creditBalanceBySourceHalfCredits: newBySource,
      updatedAt: now,
    }, { merge: true });

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
          source: 'credit',
          redemptionRef: ledgerRef.id,
          createdAt: now,
        });
      }
    });

    return { unlockIds, alreadyUnlocked: false, spentHalfCredits: cost, balanceAfterHalfCredits };
  });
});
