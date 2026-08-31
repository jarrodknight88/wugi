import ExpoModulesCore
import StoreKit

// ─────────────────────────────────────────────────────────────────────
// Wugi — StoreKitIAPModule
// Local Expo native module wrapping Apple's StoreKit 2 API directly
// (Product / Transaction / VerificationResult) — no third-party IAP
// package, mirroring the `secure-image-view` local-module convention
// already used in this project (autolinked from `modules/`, zero npm
// registry dependency).
//
// The client never trusts a purchase locally: every function here
// returns the raw signed JWS (`jwsRepresentation`) for the transaction,
// which the JS layer forwards to the `validateUnlockPurchase` Cloud
// Function for server-side verification + Firestore entitlement write.
// This module only surfaces StoreKit plumbing (fetch products, start a
// purchase, listen for/replay transactions, finish a transaction) — it
// never itself decides what a purchase unlocks.
// ─────────────────────────────────────────────────────────────────────
public final class StoreKitIAPModule: Module {
  // Long-running listener for transactions that complete outside the
  // `purchase()` call below (Ask to Buy approval, purchases restored
  // from another device, etc). Started on module init, cancelled on
  // teardown. Apple's own guidance is to install this listener as early
  // as possible so no transaction is ever missed.
  private var updateListenerTask: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("StoreKitIAP")

    // Fired for any transaction StoreKit delivers outside the direct
    // `purchase()` call (see updateListenerTask below). JS is
    // responsible for validating it server-side and, on success,
    // calling `finishTransaction`.
    Events("onTransactionUpdate")

    OnCreate {
      self.startTransactionListener()
    }

    OnDestroy {
      self.updateListenerTask?.cancel()
      self.updateListenerTask = nil
    }

    // Fetches localized product info (price/title/description) for the
    // given product ids from the App Store. Returns only products Apple
    // actually resolved — callers should check the returned array length
    // against the requested ids.
    AsyncFunction("getProducts") { (productIds: [String]) -> [[String: Any]] in
      let products = try await Product.products(for: productIds)
      return products.map { product in
        [
          "productId": product.id,
          "displayName": product.displayName,
          "description": product.description,
          // Pre-formatted, locale-correct price string ("$0.99") — Apple's
          // own guidance is to show this rather than reformatting the raw
          // Decimal yourself.
          "displayPrice": product.displayPrice,
        ]
      }
    }

    // Starts a purchase for `productId`. `appAccountToken` MUST be a
    // UUID string minted by the JS layer before calling this — it is the
    // only thing that lets the server-side validator tie an anonymous
    // App Store transaction back to a specific Firestore `unlockIntents`
    // doc (which photo/gallery this purchase is for). Throws on
    // cancellation, pending (Ask to Buy), or verification failure —
    // callers must catch and branch on `error.code`.
    AsyncFunction("purchase") { (productId: String, appAccountToken: String) -> [String: Any] in
      guard let token = UUID(uuidString: appAccountToken) else {
        throw StoreKitIAPException.invalidAppAccountToken
      }
      let products = try await Product.products(for: [productId])
      guard let product = products.first else {
        throw StoreKitIAPException.productNotFound(productId)
      }

      let result = try await product.purchase(options: [.appAccountToken(token)])

      switch result {
      case .success(let verification):
        let transaction = try Self.checkVerified(verification)
        return Self.serialize(transaction: transaction)
      case .userCancelled:
        throw StoreKitIAPException.userCancelled
      case .pending:
        // Ask to Buy / other deferred purchase — StoreKit will deliver
        // the eventual result via Transaction.updates, surfaced to JS as
        // an `onTransactionUpdate` event once a parent approves (or
        // never, if declined).
        throw StoreKitIAPException.pending
      @unknown default:
        throw StoreKitIAPException.unknownResult
      }
    }

    // Marks a transaction as finished (removes it from StoreKit's queue
    // of unfinished transactions). JS must only call this AFTER the
    // server has confirmed the entitlement was durably written to
    // Firestore — finishing early on a dropped network call would let a
    // paid-for unlock vanish with no way to recover it via restore.
    AsyncFunction("finishTransaction") { (transactionId: String) -> Bool in
      for await result in Transaction.unfinished {
        guard let transaction = try? Self.checkVerified(result) else { continue }
        if String(transaction.id) == transactionId {
          await transaction.finish()
          return true
        }
      }
      return false
    }

    // "Restore Purchases". Deliberately scoped to StoreKit's own
    // *unfinished* transaction queue (not full purchase history) — for
    // consumables, `finish()` is Wugi's durable signal that an unlock
    // was already delivered, so restoring finished transactions would
    // either be a no-op (already unlocked) or, for a lost intent record,
    // ungrantable anyway (no photo/gallery context survives on Apple's
    // side for a consumable). This covers the real restore case Apple
    // expects apps to handle: a purchase that succeeded on the App Store
    // but was never confirmed back to our server (killed app, dropped
    // network, crash mid-purchase).
    AsyncFunction("restoreUnfinished") { () -> [[String: Any]] in
      try await AppStore.sync()
      var results: [[String: Any]] = []
      for await result in Transaction.unfinished {
        guard let transaction = try? Self.checkVerified(result) else { continue }
        results.append(Self.serialize(transaction: transaction))
      }
      return results
    }
  }

  private func startTransactionListener() {
    updateListenerTask = Task.detached { [weak self] in
      for await update in Transaction.updates {
        guard let self else { return }
        guard let transaction = try? Self.checkVerified(update) else { continue }
        self.sendEvent("onTransactionUpdate", Self.serialize(transaction: transaction))
      }
    }
  }

  private static func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
    switch result {
    case .unverified:
      throw StoreKitIAPException.verificationFailed
    case .verified(let safe):
      return safe
    }
  }

  // `Transaction.jwsRepresentation` (not a property of VerificationResult)
  // is the raw signed JWS — this, not any locally-derived field, is what
  // the server verifies. Everything else in this payload is convenience
  // for the JS layer only.
  private static func serialize(transaction: Transaction) -> [String: Any] {
    [
      "transactionId": String(transaction.id),
      "originalTransactionId": String(transaction.originalID),
      "productId": transaction.productID,
      "appAccountToken": (transaction.appAccountToken?.uuidString as Any?) ?? NSNull(),
      "jwsRepresentation": transaction.jwsRepresentation,
    ]
  }
}

enum StoreKitIAPException: Error, LocalizedError {
  case invalidAppAccountToken
  case productNotFound(String)
  case userCancelled
  case pending
  case unknownResult
  case verificationFailed

  var errorDescription: String? {
    switch self {
    case .invalidAppAccountToken: return "appAccountToken must be a UUID string"
    case .productNotFound(let id): return "Product not found in App Store Connect: \(id)"
    case .userCancelled: return "user_cancelled"
    case .pending: return "purchase_pending"
    case .unknownResult: return "unknown_purchase_result"
    case .verificationFailed: return "storekit_verification_failed"
    }
  }
}
