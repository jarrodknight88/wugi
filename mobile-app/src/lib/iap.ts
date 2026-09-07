// ─────────────────────────────────────────────────────────────────────
// Wugi — iap.ts
// Orchestrates the credit-pack purchase flow (issue #282, superseding the
// unlock_single_photo/unlock_gallery SKUs from Asana 1216729383901466 /
// issue #252): mint an unlock intent (kind: 'credits'), drive the local
// StoreKit 2 module (../../modules/storekit-iap), and hand the resulting
// signed transaction to the `validateUnlockPurchase` Cloud Function for
// server-side verification + credit-ledger fulfillment. Spending credits
// on an actual photo/gallery unlock is a SEPARATE step (spendCredits
// below) — Apple only ever sells credits now, pricing what those credits
// buy is entirely server-side. The free-credit path (spendFreeUnlock)
// lives here too since it's offered from the same paywall surface.
//
// Three consumable SKUs (issue #282) — REPLACE the old
// unlock_single_photo / unlock_gallery SKUs entirely:
//   - PRODUCT_IDS.credits1 — 1 credit  · $9.99
//   - PRODUCT_IDS.credits3 — 3 credits · $24.99
//   - PRODUCT_IDS.credits5 — 5 credits · $39.99
// Configured in App Store Connect (ASC app id 829564750) — see the PR
// description for the exact product setup a human must do there; this
// sandbox has no App Store Connect access to create them itself.
// ─────────────────────────────────────────────────────────────────────
import * as StoreKitIAP from '../../modules/storekit-iap';
import type { StoreProduct, StoreTransaction } from '../../modules/storekit-iap';
import { callCallableFunction, CallableFunctionError } from './callableFunction';
import { createUnlockIntent } from '../../firestoreService';

export const PRODUCT_IDS = {
  credits1: 'credits_1',
  credits3: 'credits_3',
  credits5: 'credits_5',
} as const;

export type CreditProductId = typeof PRODUCT_IDS[keyof typeof PRODUCT_IDS];

export type ValidatePurchaseResult = {
  deltaHalfCredits: number;
  balanceAfterHalfCredits: number;
  alreadyProcessed: boolean;
};

export type SpendCreditsResult = {
  unlockIds: string[];
  alreadyUnlocked: boolean;
  spentHalfCredits: number;
  balanceAfterHalfCredits: number;
};

async function mintIntentId(): Promise<string> {
  const Crypto = await import('expo-crypto');
  return Crypto.randomUUID();
}

export function isStoreKitAvailable(): boolean {
  return StoreKitIAP.isAvailable();
}

export async function fetchCreditPackProducts(): Promise<StoreProduct[]> {
  return StoreKitIAP.getProducts(Object.values(PRODUCT_IDS));
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

// Buys a credit pack. Which photo/gallery this eventually pays for (if
// any) is decided later, server-side, by a separate `spendCredits` call —
// this function only ever credits the wallet.
export async function purchaseCreditPack(params: {
  uid: string;
  productId: CreditProductId;
}): Promise<ValidatePurchaseResult> {
  const intentId = await mintIntentId();
  await createUnlockIntent({
    intentId,
    uid: params.uid,
    kind: 'credits',
    productId: params.productId,
  });
  const transaction = await StoreKitIAP.purchase(params.productId, intentId);
  return validateAndFinish(transaction);
}

// "Use your free unlock" — wires the previously-unused spendFreeUnlock
// Cloud Function (functions/src/unlocks/spendFreeUnlock.ts) to the
// paywall. Not a StoreKit purchase at all; kept in this module because
// it's offered from the same UI surface as the paid SKUs. Independent of
// (and in addition to) the credit-economy signup grant — see
// functions/src/unlocks/spendFreeUnlock.ts / onUserCreated.ts.
export async function useFreeUnlock(photoId: string): Promise<{ unlockId: string; alreadyUnlocked: boolean }> {
  return callCallableFunction('spendFreeUnlock', { photoId });
}

// Spends credits from the wallet to unlock a single photo. Cost is
// resolved entirely server-side (functions/src/unlocks/spendCredits.ts) —
// the client never sends a price.
export async function spendCreditsOnPhoto(photoId: string): Promise<SpendCreditsResult> {
  return callCallableFunction('spendCredits', { kind: 'photo', photoId });
}

// Spends credits from the wallet to unlock every photo in a gallery
// (only available when the gallery has a bundle price set —
// GalleryDoc.galleryUnlockCreditsHalfCredits).
export async function spendCreditsOnGallery(galleryId: string): Promise<SpendCreditsResult> {
  return callCallableFunction('spendCredits', { kind: 'gallery', galleryId });
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
