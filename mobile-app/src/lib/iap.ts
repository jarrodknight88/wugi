// ─────────────────────────────────────────────────────────────────────
// Wugi — iap.ts
// Orchestrates the credit-pack purchase flow (Asana 1218248530084817 /
// issue #282, "replaces 2-SKU photo IAP"): mint a purchase intent, drive
// the local StoreKit 2 module (../../modules/storekit-iap), and hand the
// resulting signed transaction to the `validateUnlockPurchase` Cloud
// Function for server-side verification + credit-ledger grant. The
// free-credit path (spendFreeUnlock) and the two credit-redemption paths
// (spendCredits / spendCreditsOnGallery) live here too since they're
// offered from the same paywall surface, even though only the credit
// packs below are real StoreKit purchases.
//
// Three consumable SKUs (Jarrod 9/7, final for launch):
//   - credits_1 — $9.99  → 1 credit
//   - credits_3 — $24.99 → 3 credits
//   - credits_5 — $39.99 → 5 credits
// Apple sells ONLY these — every price a credit can buy (photo unlock,
// gallery bundle) is set server-side in config/creditEconomy / per-gallery
// overrides, never in App Store Connect. Configured in ASC (app id
// 829564750) — see the PR description for the exact product setup a human
// must do there; this sandbox has no App Store Connect access to create
// them itself.
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

export type CreditPack = keyof typeof PRODUCT_IDS;

export type ValidateCreditsPurchaseResult = {
  source: string;
  halfCreditsGranted: number;
  alreadyProcessed: boolean;
};

async function mintIntentId(): Promise<string> {
  const Crypto = await import('expo-crypto');
  return Crypto.randomUUID();
}

export function isStoreKitAvailable(): boolean {
  return StoreKitIAP.isAvailable();
}

export async function fetchCreditProducts(): Promise<StoreProduct[]> {
  return StoreKitIAP.getProducts(Object.values(PRODUCT_IDS));
}

// Validates a signed transaction server-side, then finishes it in
// StoreKit ONLY after the server confirms the credit grant was durably
// written — see modules/storekit-iap's finishTransaction doc comment for
// why finishing early is unsafe.
async function validateAndFinish(transaction: StoreTransaction): Promise<ValidateCreditsPurchaseResult> {
  const result = await callCallableFunction<ValidateCreditsPurchaseResult>('validateUnlockPurchase', {
    jws: transaction.jwsRepresentation,
  });
  await StoreKitIAP.finishTransaction(transaction.transactionId);
  return result;
}

export async function purchaseCreditPack(params: { uid: string; pack: CreditPack }): Promise<ValidateCreditsPurchaseResult> {
  const productId = PRODUCT_IDS[params.pack];
  const intentId = await mintIntentId();
  await createUnlockIntent({ intentId, uid: params.uid, kind: 'credits', productId });
  const transaction = await StoreKitIAP.purchase(productId, intentId);
  return validateAndFinish(transaction);
}

// "Use your free unlock" — wires the previously-unused spendFreeUnlock
// Cloud Function (functions/src/unlocks/spendFreeUnlock.ts) to the
// paywall. Not a StoreKit purchase, and NOT the credit economy — a
// separate one-time evergreen mechanic, kept in this module because it's
// offered from the same UI surface.
export async function useFreeUnlock(photoId: string): Promise<{ unlockId: string; alreadyUnlocked: boolean }> {
  return callCallableFunction('spendFreeUnlock', { photoId });
}

export type SpendCreditsResult = { unlockId: string; alreadyUnlocked: boolean; source: string; newBalanceHalfCredits?: number };

// Spend credits from the ledger to unlock a single photo — the credit
// economy's primary redemption path (functions/src/unlocks/spendCredits.ts).
export async function spendCreditsOnPhoto(photoId: string): Promise<SpendCreditsResult> {
  return callCallableFunction('spendCredits', { photoId });
}

export type SpendCreditsOnGalleryResult = { galleryId: string; alreadyUnlocked: boolean; unlockIds: string[]; newBalanceHalfCredits?: number };

// Spend credits from the ledger to unlock every photo in a gallery for its
// flat bundle price (functions/src/unlocks/spendCreditsOnGallery.ts).
export async function spendCreditsOnGallery(galleryId: string): Promise<SpendCreditsOnGalleryResult> {
  return callCallableFunction('spendCreditsOnGallery', { galleryId });
}

// "Restore Purchases" — replays any StoreKit transaction that completed
// on Apple's side but was never confirmed back to our server (dropped
// network, killed app mid-purchase). Returns how many credit grants were
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
