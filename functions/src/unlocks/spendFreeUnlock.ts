// ─────────────────────────────────────────────────────────────────────
// Wugi — spendFreeUnlock
// Entitlement schema, ROOT DEPENDENCY for StoreKit IAP / My Photos / the
// photographer payout ledger (Asana 1216729526587350). Spends the single
// evergreen free HD-unlock credit every account gets, creating a record in
// the top-level `unlocks` collection.
//
// Any authenticated user may unlock any photo — no venue/gallery gating.
// Photo ids are the synthetic `${galleryId}-${index}` format already used
// by the `favorites` collection (see mobile-app/src/navigation/
// RootNavigator.tsx openLikedPhoto), NOT a /photos doc id — there is no
// per-photo Firestore doc in the live `galleries` model.
//
// Double-spend safety: the free-credit flag lives on users/{uid} and is
// read + written inside the SAME transaction as the unlock-doc read/write,
// mirroring the balance-decrement pattern in
// functions/src/terminal/terminalFunctions.ts (captureTerminalPayment).
// Re-invoking with a photoId that's already unlocked (same deterministic
// doc id) is a no-op that returns the existing record instead of erroring —
// this also makes retried client calls idempotent.
//
// Extension point for the StoreKit IAP task (separate, due Aug 8): a
// purchased unlock should write to this same `unlocks` collection with
// source: 'purchased' (+ purchaseId/amountCents), using the identical
// `${uid}_${photoId}` doc id scheme, from its own receipt-validated
// callable/webhook. No schema change needed on this collection to support it.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

function parsePhotoId(photoId: string): { galleryId: string; index: number } | null {
  // Split on the FINAL hyphen — gallery ids can themselves contain hyphens.
  // Must stay in sync with the client-side parse in
  // mobile-app/src/navigation/RootNavigator.tsx (openLikedPhoto) and
  // mobile-app/src/utils/photoId.ts.
  const m = String(photoId || '').match(/^(.*)-(\d+)$/);
  if (!m) return null;
  return { galleryId: m[1], index: Number(m[2]) };
}

export const spendFreeUnlock = functions.https.onCall(async (data: { photoId?: string }, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  const uid = context.auth.uid;

  const photoId = String(data?.photoId || '');
  const parsed = parsePhotoId(photoId);
  if (!parsed) {
    throw new functions.https.HttpsError('invalid-argument', 'photoId must be the synthetic `${galleryId}-${index}` format');
  }
  const { galleryId, index } = parsed;

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

    // Idempotent no-op: this exact photo is already unlocked (free-credit or
    // purchased) — never double-charge the credit for a re-tap/retry.
    if (unlockSnap.exists) {
      const existing = unlockSnap.data()!;
      return {
        unlockId: unlockRef.id,
        alreadyUnlocked: true,
        source: existing.source as 'free-credit' | 'purchased',
      };
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
    if (userSnap.data()?.freeUnlockUsed === true) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Free unlock credit already used'
      );
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    // photographerId is resolved server-side from the gallery doc — never
    // trust a client-supplied photographerId, it feeds the payout ledger.
    const photographerId: string | null = gallerySnap.data()?.photographerId ?? null;

    tx.set(unlockRef, {
      userId: uid,
      photoId,
      galleryId,
      photoIndex: index,
      photographerId,
      source: 'free-credit',
      createdAt: now,
    });

    tx.update(userRef, {
      freeUnlockUsed: true,
      freeUnlockUsedAt: now,
      freeUnlockUnlockId: unlockRef.id,
    });

    return { unlockId: unlockRef.id, alreadyUnlocked: false, source: 'free-credit' as const };
  });
});
