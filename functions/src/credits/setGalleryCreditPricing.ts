// ─────────────────────────────────────────────────────────────────────
// Wugi — setGalleryCreditPricing
// The ONLY write path to a gallery's per-gallery credit pricing overrides
// (Part 3). Callable by the gallery's own photographer, or by staff
// admin-ing pricing on a photographer's behalf (v1 has no
// photographer-facing pricing UI — explicitly out of scope, see issue
// #282 — so staff is the only caller in practice at launch).
//
// The "rogue-price rail" is enforced HERE, server-side, not just in
// whatever UI eventually calls this — clampPhotoCreditCostHalfUnits
// clamps into the launch allowed set ({0.5, 1} credit) regardless of what
// a photographer/admin requests. spendCredits.ts re-clamps defensively
// again at spend time in case this doc was ever written any other way.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { getCreditEconomyConfig, clampPhotoCreditCostHalfUnits, creditsToHalfUnits } from './creditEconomy';

const db = admin.firestore();
const STAFF_ROLES = ['super_admin', 'moderator', 'support'];

export const setGalleryCreditPricing = functions.https.onCall(async (
  data: { galleryId?: string; photoCreditCost?: number; galleryUnlockCredits?: number | null; promoFlag?: boolean },
  context,
) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  const uid = context.auth.uid;
  const galleryId = String(data?.galleryId || '');
  if (!galleryId) throw new functions.https.HttpsError('invalid-argument', 'galleryId is required');

  const galleryRef = db.collection('galleries').doc(galleryId);
  const [gallerySnap, callerSnap] = await Promise.all([
    galleryRef.get(),
    db.collection('users').doc(uid).get(),
  ]);
  if (!gallerySnap.exists) throw new functions.https.HttpsError('not-found', `Gallery ${galleryId} not found`);

  const photographerId: string | null = gallerySnap.data()?.photographerId ?? null;
  const callerRole: string = callerSnap.data()?.role || '';
  const isOwner = photographerId != null && photographerId === uid;
  if (!isOwner && !STAFF_ROLES.includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Only this gallery\'s photographer or Wugi staff may set its pricing');
  }

  const config = await getCreditEconomyConfig();
  const update: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  if (data?.photoCreditCost != null) {
    if (typeof data.photoCreditCost !== 'number' || !Number.isFinite(data.photoCreditCost)) {
      throw new functions.https.HttpsError('invalid-argument', 'photoCreditCost must be a number');
    }
    update.photoCreditCostHalfUnits = clampPhotoCreditCostHalfUnits(creditsToHalfUnits(data.photoCreditCost), config);
  }

  if (data?.galleryUnlockCredits === null) {
    update.galleryUnlockCreditsHalfUnits = admin.firestore.FieldValue.delete();
  } else if (data?.galleryUnlockCredits != null) {
    if (typeof data.galleryUnlockCredits !== 'number' || !Number.isFinite(data.galleryUnlockCredits) || data.galleryUnlockCredits <= 0) {
      throw new functions.https.HttpsError('invalid-argument', 'galleryUnlockCredits must be a positive number');
    }
    // Any half-credit multiple is allowed for the bundle price (Part 3) —
    // only the per-photo cost is bounded to the launch allowed set.
    update.galleryUnlockCreditsHalfUnits = Math.max(1, creditsToHalfUnits(data.galleryUnlockCredits));
  }

  if (typeof data?.promoFlag === 'boolean') {
    update.promoFlag = data.promoFlag;
  }

  await galleryRef.update(update);
  return { galleryId, ...update, updatedAt: undefined };
});
