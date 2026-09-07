// ─────────────────────────────────────────────────────────────────────
// Wugi — setGalleryCreditPricing
// The SOLE write path for per-gallery credit pricing overrides (issue
// #282, Part 3). `galleries` already has no client write access at all
// (see firebase/firestore.rules catch-all + Dashboard/Lens writing
// through the Admin SDK), so this callable is the only way ANY
// caller — staff or Dashboard — sets these fields; it exists to enforce
// the {1, 2} half-credit bound server-side rather than trusting whatever
// the Dashboard UI happens to send.
//
// Staff-gated the same way getPhotographerEarnings.ts gates cross-user
// reads (STAFF_ROLES) — pricing is an internal/admin operation for v1,
// no photographer-facing pricing UI (explicitly out of scope).
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();
const STAFF_ROLES = ['super_admin', 'moderator', 'support'];

type SetGalleryCreditPricingData = {
  galleryId?: string;
  photoCreditCostHalfCredits?: number;
  galleryUnlockCreditsHalfCredits?: number | null;
  promoFlag?: boolean;
  free?: boolean;
};

export const setGalleryCreditPricing = functions.https.onCall(async (data: SetGalleryCreditPricingData, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  const callerDoc = await db.collection('users').doc(context.auth.uid).get();
  const callerRole: string = callerDoc.data()?.role || '';
  if (!STAFF_ROLES.includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Staff only');
  }

  const galleryId = String(data?.galleryId || '');
  if (!galleryId) throw new functions.https.HttpsError('invalid-argument', 'galleryId is required');

  const galleryRef = db.collection('galleries').doc(galleryId);
  const gallerySnap = await galleryRef.get();
  if (!gallerySnap.exists) {
    throw new functions.https.HttpsError('not-found', `Gallery ${galleryId} not found`);
  }

  const update: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  // Per-photo cost is restricted to EXACTLY {1, 2} half-credits (½ or 1
  // credit) — reject anything else outright rather than silently
  // clamping. This is the WRITE path, so failing loud here is the right
  // call: an admin who fat-fingers "20" should see an error, not have it
  // silently become "2". (Contrast with creditEconomy.
  // clampPhotoCreditCostHalfCredits, used on the READ/spend path, which
  // clamps instead — failing closed there would block purchases over a
  // stray bad value instead of just correcting the price.)
  if (data?.photoCreditCostHalfCredits !== undefined) {
    const v = data.photoCreditCostHalfCredits;
    if (v !== 1 && v !== 2) {
      throw new functions.https.HttpsError('invalid-argument', 'photoCreditCostHalfCredits must be 1 or 2 (½ or 1 credit)');
    }
    update.photoCreditCostHalfCredits = v;
  }

  // Bundle price has no upper bound per spec, but must still be a
  // non-negative integer half-credit count (or null to clear it / fall
  // back to "no bundle offered").
  if (data?.galleryUnlockCreditsHalfCredits !== undefined) {
    const v = data.galleryUnlockCreditsHalfCredits;
    if (v !== null && (!Number.isInteger(v) || v < 0)) {
      throw new functions.https.HttpsError('invalid-argument', 'galleryUnlockCreditsHalfCredits must be a non-negative integer or null');
    }
    update.galleryUnlockCreditsHalfCredits = v;
  }

  if (data?.promoFlag !== undefined) update.promoFlag = !!data.promoFlag;
  if (data?.free !== undefined) update.free = !!data.free;

  await galleryRef.set(update, { merge: true });
  return { ok: true, galleryId, updated: Object.keys(update).filter(k => k !== 'updatedAt') };
});
