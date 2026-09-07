// ─────────────────────────────────────────────────────────────────────
// Wugi — spendCredit
// Credit-economy entitlement writer (Asana 1218248530084817 / issue #282,
// Part 2 + Part 5). Extends the functions/src/unlocks/spendFreeUnlock.ts
// pattern: same transactional read-balance-then-write-unlock shape, same
// `unlocks` collection + `${uid}_${photoId}` doc id, same idempotent
// no-op on a retried/already-unlocked photoId. Differs only in WHAT gets
// decremented (a numeric `creditBalance` instead of a boolean flag) and
// WHERE the price comes from (gallery.photoCreditCost override, else
// config/creditEconomy.defaultPhotoCreditCost — always clamped
// server-side, never trusted verbatim off either doc).
//
// Part 5 attribution: every write here stamps `photographerId` on the
// `unlocks` doc, same as spendFreeUnlock/validateUnlockPurchase already
// do — that's what lets functions/src/unlocks/getPhotographerEarnings.ts
// compute payouts with a single query, no new collection/index needed.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { parsePhotoId } from '../unlocks/spendFreeUnlock';
import { getCreditEconomyConfig, clampPhotoCreditCost } from './config';

const db = admin.firestore();

export const spendCredit = functions.https.onCall(async (data: { photoId?: string }, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  const uid = context.auth.uid;

  const photoId = String(data?.photoId || '');
  const parsed = parsePhotoId(photoId);
  if (!parsed) {
    throw new functions.https.HttpsError('invalid-argument', 'photoId must be the synthetic `${galleryId}-${index}` format');
  }
  const { galleryId, index } = parsed;

  // Config is read outside the transaction (short-TTL cached, not
  // correctness-critical the way the balance/unlock write is) — see
  // getCreditEconomyConfig doc comment.
  const config = await getCreditEconomyConfig();

  const unlockRef  = db.collection('unlocks').doc(`${uid}_${photoId}`);
  const userRef    = db.collection('users').doc(uid);
  const galleryRef = db.collection('galleries').doc(galleryId);

  return db.runTransaction(async (tx) => {
    // All reads must happen before any writes in a Firestore transaction.
    const [unlockSnap, userSnap, gallerySnap] = await Promise.all([
      tx.get(unlockRef),
      tx.get(userRef),
      tx.get(galleryRef),
    ]);

    // Idempotent no-op: this exact photo is already unlocked (free-credit,
    // purchased, or a prior credit-redemption) — never double-charge on a
    // re-tap/retry.
    if (unlockSnap.exists) {
      const existing = unlockSnap.data()!;
      return {
        unlockId: unlockRef.id,
        alreadyUnlocked: true,
        creditsSpent: 0,
        source: existing.source as string,
      };
    }

    if (!gallerySnap.exists) {
      throw new functions.https.HttpsError('not-found', `Gallery ${galleryId} not found`);
    }
    const galleryData = gallerySnap.data() || {};
    const images: string[] = galleryData.images || [];
    if (!Number.isInteger(index) || index < 0 || index >= images.length) {
      throw new functions.https.HttpsError('invalid-argument', 'Photo index out of range for gallery');
    }

    if (!userSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'User profile not found');
    }

    // promoFlag makes every photo in the gallery free — no balance check,
    // no ledger entry (nothing was actually spent).
    const isFree = galleryData.promoFlag === true;
    const cost = isFree
      ? 0
      : clampPhotoCreditCost(Number(galleryData.photoCreditCost ?? config.defaultPhotoCreditCost));

    const currentBalance: number = Number(userSnap.data()?.creditBalance ?? 0);
    if (cost > 0 && currentBalance < cost) {
      throw new functions.https.HttpsError('failed-precondition', 'Not enough credits — buy more to unlock this photo');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    // photographerId is resolved server-side from the gallery doc — never
    // trust a client-supplied photographerId, it feeds the payout report.
    const photographerId: string | null = galleryData.photographerId ?? null;
    const newBalance = currentBalance - cost;

    tx.set(unlockRef, {
      userId: uid,
      photoId,
      galleryId,
      photoIndex: index,
      photographerId,
      source: 'credit-redemption',
      creditsCost: cost,
      createdAt: now,
    });

    if (cost > 0) {
      // Append-only ledger, running balance for auditability (Part 2).
      const ledgerRef = userRef.collection('creditLedger').doc();
      tx.set(ledgerRef, {
        source: 'redemption',
        delta: -cost,
        balanceAfter: newBalance,
        ts: now,
        ref: photoId,
        galleryId,
        photographerId,
      });
      tx.set(userRef, { creditBalance: newBalance, updatedAt: now }, { merge: true });
    }

    return {
      unlockId: unlockRef.id,
      alreadyUnlocked: false,
      creditsSpent: cost,
      balance: cost > 0 ? newBalance : currentBalance,
    };
  });
});
