// ─────────────────────────────────────────────────────────────────────
// Wugi — iap.ts
// Orchestrates the credit-economy purchase flow (Asana 1218248530084817 /
// issue #282 — replaces the original 2-SKU photo-unlock IAP this module
// shipped for under issue #252): mint a purchase intent, drive the local
// StoreKit 2 module (../../modules/storekit-iap), and hand the resulting
// signed transaction to the `validateUnlockPurchase` Cloud Function for
// server-side verification + credit-ledger fulfillment. Spending credits
// on a specific photo/gallery is a SEPARATE server-side call
// (spendCreditsOnPhoto/spendCreditsOnGallery below) — Apple never learns
// which photo anything was for anymore, only that credits were bought.
//
// Three consumable SKUs (Jarrod 9/7 scope amendment): credits_1 ($9.99,
// 1 credit), credits_3 ($24.99, 3 credits), credits_5 ($39.99, 5 credits).
// Configured in App Store Connect (ASC app id 829564750) — see the PR
// description for the exact product setup a human must do there; this
// sandbox has no App Store Connect access to create them itself.
//
// DELTA 3 (Jarrod/PM 9/12): the evergreen free HD-unlock credit
// (`useFreeUnlock`) is retired from this module — it's no longer offered
// from the paywall. `spendFreeUnlock` (functions/src/unlocks/
// spendFreeUnlock.ts) stays deployed untouched; decommissioning it is a
// separate post-launch cleanup, not a mobile-app change.
// ─────────────────────────────────────────────────────────────────────
import * as StoreKitIAP from '../../modules/storekit-iap';
import type { StoreProduct, StoreTransaction } from '../../modules/storekit-iap';
import { callCallableFunction, CallableFunctionError } from './callableFunction';
import { createUnlockIntent } from '../../firestoreService';

export const CREDIT_PACK_IDS = {
  credits_1: 'credits_1',
  credits_3: 'credits_3',
  credits_5: 'credits_5',
} as const;

export type CreditPackId = typeof CREDIT_PACK_IDS[keyof typeof CREDIT_PACK_IDS];

export type ValidatePurchaseResult = {
  creditsGranted: number;
  newBalanceHalfUnits: number;
  alreadyProcessed: boolean;
};

export type SpendCreditsResult = {
  alreadyUnlocked: boolean;
  unlockId?: string;
  unlockIds?: string[];
  creditsSpentHalfUnits?: number;
  newBalanceHalfUnits?: number;
};

async function mintIntentId(): Promise<string> {
  const Crypto = await import('expo-crypto');
  return Crypto.randomUUID();
}

export function isStoreKitAvailable(): boolean {
  return StoreKitIAP.isAvailable();
}

export async function fetchCreditPackProducts(): Promise<StoreProduct[]> {
  return StoreKitIAP.getProducts(Object.values(CREDIT_PACK_IDS));
}

// Validates a signed transaction server-side, then finishes it in
// StoreKit ONLY after the server confirms the credit grant was durably
// written — see modules/storekit-iap's finishTransaction doc comment for
// why finishing early is unsafe.
async function validateAndFinish(transaction: StoreTransaction): Promise<ValidatePurchaseResult> {
  const result = await callCallableFunction<ValidatePurchaseResult>('validateUnlockPurchase', {
    jws: transaction.jwsRepresentation,
  });
  await StoreKitIAP.finishTransaction(transaction.transactionId);
  return result;
}

export async function purchaseCreditPack(params: { uid: string; packId: CreditPackId }): Promise<ValidatePurchaseResult> {
  const intentId = await mintIntentId();
  await createUnlockIntent({
    intentId,
    uid: params.uid,
    kind: 'credits',
    productId: params.packId,
  });
  const transaction = await StoreKitIAP.purchase(params.packId, intentId);
  return validateAndFinish(transaction);
}

// Redeems credits from the caller's own balance to unlock a single photo.
// Entirely server-side pricing/balance logic (functions/src/credits/
// spendCredits.ts) — no StoreKit involved.
export async function spendCreditsOnPhoto(params: { photoId: string }): Promise<SpendCreditsResult> {
  return callCallableFunction('spendCredits', { kind: 'photo', photoId: params.photoId });
}

export async function spendCreditsOnGallery(params: { galleryId: string }): Promise<SpendCreditsResult> {
  return callCallableFunction('spendCredits', { kind: 'gallery', galleryId: params.galleryId });
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
