export type StoreProduct = {
  productId: string;
  displayName: string;
  description: string;
  /** Pre-formatted, locale-correct price string (e.g. "$0.99"). */
  displayPrice: string;
};

export type StoreTransaction = {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  appAccountToken: string | null;
  /** Signed JWS — forward to the `validateUnlockPurchase` Cloud Function, never trust client-side. */
  jwsRepresentation: string;
};

export type TransactionUpdateEvent = StoreTransaction;
