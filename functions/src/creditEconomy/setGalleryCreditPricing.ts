// ─────────────────────────────────────────────────────────────────────
// Wugi — setGalleryCreditPricing
// Photographer-set pricing (Asana 1218248530084817 / issue #282, Part 3).
// A photographer-facing pricing UI is explicitly out of scope for v1 (see
// issue "Out of scope") — admin sets pricing on a photographer's behalf,
// so this callable is super-admin-only for now. It is still the mandatory
// "rogue-price rail": the ONLY write path to a gallery's credit pricing
// (`galleries` has no client write rule at all — see
// firebase/firestore.rules), and every numeric input is clamped
// server-side here, not just validated client-side, before it ever
// touches Firestore. `spendCredit` clamps again defensively at spend
// time in case a value is ever hand-edited out of bounds.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { clampPhotoCreditCost } from './config';

const db = admin.firestore();

export const setGalleryCreditPricing = functions.https.onCall(async (data: {
  galleryId?: string;
  photoCreditCost?: number;
  galleryUnlockCredits?: number | null;
  promoFlag?: boolean;
}, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  const uid = context.auth.uid;

  const galleryId = String(data?.galleryId || '');
  if (!galleryId) throw new functions.https.HttpsError('invalid-argument', 'galleryId is required');

  const callerSnap = await db.collection('users').doc(uid).get();
  const callerRole: string = callerSnap.data()?.role || '';
  if (callerRole !== 'super_admin') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admin can set gallery credit pricing (v1: admin sets pricing on the photographer\'s behalf)'
    );
  }

  const galleryRef = db.collection('galleries').doc(galleryId);
  const gallerySnap = await galleryRef.get();
  if (!gallerySnap.exists) {
    throw new functions.https.HttpsError('not-found', `Gallery ${galleryId} not found`);
  }

  const photoCreditCost = data?.photoCreditCost !== undefined
    ? clampPhotoCreditCost(Number(data.photoCreditCost))
    : undefined;
  const promoFlag = data?.promoFlag !== undefined ? Boolean(data.promoFlag) : undefined;

  const update: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (photoCreditCost !== undefined) update.photoCreditCost = photoCreditCost;
  if (promoFlag !== undefined) update.promoFlag = promoFlag;

  let galleryUnlockCredits: number | null | undefined;
  if (data?.galleryUnlockCredits === null) {
    galleryUnlockCredits = null;
    update.galleryUnlockCredits = admin.firestore.FieldValue.delete();
  } else if (data?.galleryUnlockCredits !== undefined) {
    galleryUnlockCredits = Math.max(1, Math.round(Number(data.galleryUnlockCredits)));
    update.galleryUnlockCredits = galleryUnlockCredits;
  }

  await galleryRef.update(update);
  return { galleryId, photoCreditCost, galleryUnlockCredits, promoFlag };
});
