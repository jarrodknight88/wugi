// ─────────────────────────────────────────────────────────────────────
// Wugi — iap.ts
// Orchestrates the photo-unlock purchase flow: mint an unlock intent,
// drive the local StoreKit 2 module (../../modules/storekit-iap), and
// hand the resulting signed transaction to the `validateUnlockPurchase`
// Cloud Function for server-side verification + Firestore entitlement
// write. The free-credit path (spendFreeUnlock) lives here too since
// it's offered from the same paywall surface.
//
// Two consumable SKUs (Asana 1216729383901466 / issue #252):
//   - PRODUCT_IDS.photo   — unlock a single photo
//   - PRODUCT_IDS.gallery — unlock every photo in a gallery
// Configured in App Store Connect (ASC app id 829564750) — see the PR
// description for the exact product setup a human must do there; this
// sandbox has no App Store Connect access to create them itself.
// ─────────────────────────────────────────────────────────────────────
import * as StoreKitIAP from '../../modules/storekit-iap';
import type { StoreProduct, StoreTransaction } from '../../modules/storekit-iap';
import { callCallableFunction, CallableFunctionError } from './callableFunction';
import { createUnlockIntent } from '../../firestoreService';

export const PRODUCT_IDS = {
  photo: 'unlock_single_photo',
  gallery: 'unlock_gallery',
} as const;

export type UnlockKind = 'photo' | 'gallery';

export type ValidatePurchaseResult = {
  unlockIds: string[];
  kind: UnlockKind;
  alreadyProcessed: boolean;
};

async function mintIntentId(): Promise<string> {
  const Crypto = await import('expo-crypto');
  return Crypto.randomUUID();
}

export function isStoreKitAvailable(): boolean {
  return StoreKitIAP.isAvailable();
}

export async function fetchUnlockProducts(): Promise<StoreProduct[]> {
  return StoreKitIAP.getProducts([PRODUCT_IDS.photo, PRODUCT_IDS.gallery]);
}

// Validates a signed transaction server-side, then finishes it in
// StoreKit ONLY after the server confirms the entitlement was durably
// written — see modules/storekit-iap's finishTransaction doc comment for
// why finishing early is unsafe.
async function validateAndFinish(transaction: StoreTransaction): Promise<ValidatePurchaseResult> {
  const result = await callCallableFunction<ValidatePurchaseResult>('validateUnlockPurchase', {
    jws: transaction.jwsRepresentation,
  });
  await StoreKitIAP.finishTransaction(transaction.transactionId);
  return result;
}

export async function purchaseSinglePhoto(params: {
  uid: string;
  photoId: string;
  galleryId: string;
  photoIndex: number;
}): Promise<ValidatePurchaseResult> {
  const intentId = await mintIntentId();
  await createUnlockIntent({
    intentId,
    uid: params.uid,
    kind: 'photo',
    productId: PRODUCT_IDS.photo,
    galleryId: params.galleryId,
    photoId: params.photoId,
    photoIndex: params.photoIndex,
  });
  const transaction = await StoreKitIAP.purchase(PRODUCT_IDS.photo, intentId);
  return validateAndFinish(transaction);
}

export async function purchaseGallery(params: {
  uid: string;
  galleryId: string;
}): Promise<ValidatePurchaseResult> {
  const intentId = await mintIntentId();
  await createUnlockIntent({
    intentId,
    uid: params.uid,
    kind: 'gallery',
    productId: PRODUCT_IDS.gallery,
    galleryId: params.galleryId,
  });
  const transaction = await StoreKitIAP.purchase(PRODUCT_IDS.gallery, intentId);
  return validateAndFinish(transaction);
}

// "Use your free unlock" — wires the previously-unused spendFreeUnlock
// Cloud Function (functions/src/unlocks/spendFreeUnlock.ts) to the
// paywall. Not a StoreKit purchase at all; kept in this module because
// it's offered from the same UI surface as the paid SKUs.
export async function useFreeUnlock(photoId: string): Promise<{ unlockId: string; alreadyUnlocked: boolean }> {
  return callCallableFunction('spendFreeUnlock', { photoId });
}

// "Restore Purchases" — replays any StoreKit transaction that completed
// on Apple's side but was never confirmed back to our server (dropped
// network, killed app mid-purchase). Returns how many unlocks were
// recovered; throws only on a hard failure (e.g. no network at all), not
// on "nothing to restore".
export async function restorePurchases(): Promise<number> {
  const pending = await StoreKitIAP.restoreUnfinished();
  let recovered = 0;
  for (const transaction of pending) {
    try {
      await validateAndFinish(transaction);
      recovered += 1;
    } catch (e) {
      // Intent doc missing/mismatched, or a transient server error — log
      // and continue so one bad transaction doesn't block the rest of the
      // restore batch. Surfaced to the user as a lower recovered count,
      // not a thrown error.
      console.log('restorePurchases: failed to validate transaction', transaction.transactionId, e);
    }
  }
  return recovered;
}

// Subscribes to transactions StoreKit delivers outside a direct
// `purchase()` call (Ask to Buy approval, a purchase syncing in from
// another device). Call once near app boot; safe to call multiple times
// only if `unsubscribe` is used to tear down the previous listener first.
export function watchTransactionUpdates(): () => void {
  const subscription = StoreKitIAP.addTransactionUpdateListener((transaction) => {
    validateAndFinish(transaction).catch((e) => {
      console.log('watchTransactionUpdates: failed to validate transaction', transaction.transactionId, e);
    });
  });
  return () => subscription?.remove();
}

export { CallableFunctionError };
