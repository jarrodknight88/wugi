import { Platform } from 'react-native';
import { requireNativeModule, EventEmitter, type Subscription } from 'expo';
import type { StoreProduct, StoreTransaction, TransactionUpdateEvent } from './src/StoreKitIAP.types';

export type { StoreProduct, StoreTransaction, TransactionUpdateEvent };

// iOS-only — StoreKit 2 has no Android equivalent here (photo unlocks are
// Apple-guideline-3.1.1 digital goods; Android IAP is a separate, unbuilt
// scope). `null` on Android/web makes every export below a safe no-op
// rather than a crash on require().
const NativeStoreKitIAP = Platform.OS === 'ios' ? requireNativeModule('StoreKitIAP') : null;
const emitter = NativeStoreKitIAP ? new EventEmitter(NativeStoreKitIAP) : null;

export function isAvailable(): boolean {
  return NativeStoreKitIAP != null;
}

export async function getProducts(productIds: string[]): Promise<StoreProduct[]> {
  if (!NativeStoreKitIAP) return [];
  return NativeStoreKitIAP.getProducts(productIds);
}

// `appAccountToken` must be a UUID string — the caller mints it (see
// mobile-app/src/lib/iap.ts) and writes a matching `unlockIntents` doc
// BEFORE calling this, so the server-side validator can resolve which
// photo/gallery this purchase is for.
export async function purchase(productId: string, appAccountToken: string): Promise<StoreTransaction> {
  if (!NativeStoreKitIAP) throw new Error('StoreKit is unavailable on this platform');
  return NativeStoreKitIAP.purchase(productId, appAccountToken);
}

export async function finishTransaction(transactionId: string): Promise<boolean> {
  if (!NativeStoreKitIAP) return false;
  return NativeStoreKitIAP.finishTransaction(transactionId);
}

export async function restoreUnfinished(): Promise<StoreTransaction[]> {
  if (!NativeStoreKitIAP) return [];
  return NativeStoreKitIAP.restoreUnfinished();
}

export function addTransactionUpdateListener(
  listener: (event: TransactionUpdateEvent) => void
): Subscription | null {
  if (!emitter) return null;
  return emitter.addListener('onTransactionUpdate', listener);
}
