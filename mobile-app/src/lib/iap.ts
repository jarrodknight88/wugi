// ─────────────────────────────────────────────────────────────────────
// Wugi — iap.ts
// Orchestrates the CREDIT purchase flow (Asana 1218248530084817 / issue
// #282): mint a purchase intent, drive the local StoreKit 2 module
// (../../modules/storekit-iap), and hand the resulting signed transaction
// to `validateUnlockPurchase` for server-side verification + a
// `creditBalance` credit. Spending credits on a photo is a SEPARATE call
// (spendCredit) — this module only buys credits; PaywallSheet decides
// whether to spend an existing balance or send the user here to top up.
//
// Three consumable SKUs (replaces unlock_single_photo / unlock_gallery,
// Asana 1216729383901466 / issue #252):
//   - PRODUCT_IDS.credits_1 — $4.99 for 1 credit
//   - PRODUCT_IDS.credits_3 — $12.99 for 3 credits
//   - PRODUCT_IDS.credits_5 — $19.99 for 5 credits
// Configured in App Store Connect (ASC app id 829564750) — Jarrod creates
// these in console (out of scope here); this sandbox has no ASC access.
// ─────────────────────────────────────────────────────────────────────
import * as StoreKitIAP from '../../modules/storekit-iap';
import type { StoreProduct, StoreTransaction } from '../../modules/storekit-iap';
import { callCallableFunction, CallableFunctionError } from './callableFunction';
import { createUnlockIntent } from '../../firestoreService';

export const PRODUCT_IDS = {
  credits_1: 'credits_1',
  credits_3: 'credits_3',
  credits_5: 'credits_5',
} as const;

export type CreditSku = keyof typeof PRODUCT_IDS;

export type PurchaseCreditsResult = {
  creditsGranted: number;
  balance: number;
  alreadyProcessed: boolean;
};

export type SpendCreditResult = {
  unlockId: string;
  alreadyUnlocked: boolean;
  creditsSpent: number;
  balance?: number;
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
// StoreKit ONLY after the server confirms the credit was durably written
// — see modules/storekit-iap's finishTransaction doc comment for why
// finishing early is unsafe.
async function validateAndFinish(transaction: StoreTransaction): Promise<PurchaseCreditsResult> {
  const result = await callCallableFunction<PurchaseCreditsResult>('validateUnlockPurchase', {
    jws: transaction.jwsRepresentation,
  });
  await StoreKitIAP.finishTransaction(transaction.transactionId);
  return result;
}

export async function purchaseCredits(params: { uid: string; sku: CreditSku }): Promise<PurchaseCreditsResult> {
  const productId = PRODUCT_IDS[params.sku];
  const intentId = await mintIntentId();
  await createUnlockIntent({
    intentId,
    uid: params.uid,
    kind: 'credits',
    productId,
  });
  const transaction = await StoreKitIAP.purchase(productId, intentId);
  return validateAndFinish(transaction);
}

// "Use your free unlock" — the evergreen one-per-account free HD-unlock
// credit, kept from PR #252 and unaffected by the credit-economy
// restructure (it's a separate boolean flag, not part of `creditBalance`).
export async function useFreeUnlock(photoId: string): Promise<{ unlockId: string; alreadyUnlocked: boolean }> {
  return callCallableFunction('spendFreeUnlock', { photoId });
}

// Spends credits from the buyer's balance to unlock one photo — server
// resolves the price (gallery override or config default), clamps it, and
// writes the unlock + ledger redemption in one transaction. See
// functions/src/creditEconomy/spendCredit.ts.
export async function spendCredit(photoId: string): Promise<SpendCreditResult> {
  return callCallableFunction('spendCredit', { photoId });
}

// "Restore Purchases" — replays any StoreKit transaction that completed
// on Apple's side but was never confirmed back to our server (dropped
// network, killed app mid-purchase). Returns how many transactions were
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
