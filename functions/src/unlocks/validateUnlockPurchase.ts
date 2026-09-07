// ─────────────────────────────────────────────────────────────────────
// Wugi — validateUnlockPurchase
// Server-side StoreKit 2 receipt validation for the credit-pack IAP
// economy (issue #282, superseding the fixed-price photo/gallery SKUs
// from Asana 1216729383901466 / issue #252). Verifies the signed
// transaction JWS the client got back from StoreKit, then CREDITS THE
// USER'S LEDGER (users/{uid}.creditBalanceHalfCredits +
// users/{uid}/creditLedger) instead of unlocking a specific photo —
// Apple now only ever sells credit packs; what those credits buy is
// entirely server-priced (see creditEconomy.ts / spendCredits.ts).
//
// EVERYTHING BELOW THIS COMMENT BLOCK — the JWS verification, the
// `unlockIntents` appAccountToken bridge, the `purchases/{transactionId}`
// idempotency ledger, the Production-then-Sandbox verify fallback — is
// UNCHANGED from the original photo/gallery version. Only the fulfillment
// write at the bottom (previously "create an `unlocks` doc") changed to
// "credit the ledger". Do not re-litigate this architecture without
// reading the original PR #253 first.
//
// WHY THE CLIENT CAN'T BE TRUSTED HERE: a client can fabricate any
// "I bought this" call. The transaction JWS is signed by Apple; this
// function is the only thing that verifies that signature and reads the
// productId/transactionId back OUT of the verified payload — never off
// anything the client passed in the RPC body except the JWS itself. In
// particular, the number of half-credits granted is looked up
// server-side from the VERIFIED productId (PRODUCT_HALF_CREDITS) — never
// trusted from the intent doc or the RPC body.
//
// WHICH SKU CONTEXT: Apple's consumable purchases carry no notion of
// "which SKU semantics" beyond productId, but we still need to bridge a
// purchase back to "this uid was mid-purchase for this reason" (mostly
// so a stray/replayed transaction from a different account can't credit
// the wrong uid) — that's `appAccountToken`, a UUID the client mints and
// writes to a Firestore `unlockIntents/{token}` doc (uid, kind: 'credits',
// productId) BEFORE starting the StoreKit purchase (see
// mobile-app/src/lib/iap.ts). We read the appAccountToken back out of the
// VERIFIED payload, then look up that intent doc server-side.
//
// APPLE ROOT CERTIFICATES: SignedDataVerifier needs Apple's root CA
// certificates as trust anchors. This sandbox had no network access to
// bundle the .cer files into the repo at authoring time, so they're
// fetched once (from apple.com, over HTTPS) and cached in memory for the
// life of this function instance — Cloud Functions has full outbound
// network access at runtime even though this authoring sandbox didn't.
// If a reviewer would rather pin static .cer files checked into the repo
// (the more common pattern for this library), swap getAppleRootCerts()
// below for a `fs.readFileSync` — no other code needs to change.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as https from 'https';
import { SignedDataVerifier, Environment } from '@apple/app-store-server-library';
import { PRODUCT_HALF_CREDITS, CREDIT_PRODUCT_IDS, type LedgerSource } from './creditEconomy';

const db = admin.firestore();

// Reverse-DNS-style but NOT tied to the bundle id on purpose — the app's
// bundle id has drifted between builds (com.wugimedia.wugitest vs
// com.wugi.wugi — see PR description), while App Store Connect product
// ids, once created, are permanent. Must exactly match what's configured
// in ASC (app id 829564750) and mobile-app/src/lib/iap.ts PRODUCT_IDS.
// credits_1/credits_3/credits_5 REPLACE the old unlock_single_photo /
// unlock_gallery SKUs — any in-flight transaction for the old SKUs from
// before this deploy will fail closed here with "Unrecognized product
// id" (same fail-closed philosophy as the rest of this file) and needs
// manual support resolution; that's an accepted one-time cutover cost.
const KNOWN_PRODUCT_IDS = new Set<string>(CREDIT_PRODUCT_IDS);

// TODO(human, before deploy): confirm this is the bundle id actually
// registered against ASC app id 829564750 — app.json currently still
// says `com.wugimedia.wugitest` (see PR description "known discrepancy").
// Getting this wrong makes the verifier reject every real transaction
// (fails closed, not open — safe but broken).
const BUNDLE_ID = 'com.wugi.wugi';
const APP_APPLE_ID = 829564750;

const APPLE_ROOT_CERT_URLS = [
  'https://www.apple.com/certificateauthority/AppleRootCA-G3.cer',
];

let cachedRootCerts: Buffer[] | null = null;

function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch ${url}: HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function getAppleRootCerts(): Promise<Buffer[]> {
  if (cachedRootCerts) return cachedRootCerts;
  cachedRootCerts = await Promise.all(APPLE_ROOT_CERT_URLS.map(fetchBuffer));
  return cachedRootCerts;
}

let verifierProduction: SignedDataVerifier | null = null;
let verifierSandbox: SignedDataVerifier | null = null;

async function getVerifier(environment: Environment): Promise<SignedDataVerifier> {
  const certs = await getAppleRootCerts();
  if (environment === Environment.PRODUCTION) {
    if (!verifierProduction) {
      verifierProduction = new SignedDataVerifier(certs, true, Environment.PRODUCTION, BUNDLE_ID, APP_APPLE_ID);
    }
    return verifierProduction;
  }
  if (!verifierSandbox) {
    verifierSandbox = new SignedDataVerifier(certs, true, Environment.SANDBOX, BUNDLE_ID);
  }
  return verifierSandbox;
}

// TestFlight and sandbox testing (Jarrod's Labor Day demo, pre-submission
// QA) always produce Sandbox-environment transactions even though it's
// otherwise "the real app" — try Production first since that's the
// eventual steady state, fall back to Sandbox rather than rejecting.
async function verifyTransaction(jws: string) {
  try {
    const verifier = await getVerifier(Environment.PRODUCTION);
    return await verifier.verifyAndDecodeTransaction(jws);
  } catch {
    const verifier = await getVerifier(Environment.SANDBOX);
    return await verifier.verifyAndDecodeTransaction(jws);
  }
}

type UnlockIntent = {
  uid: string;
  kind: 'credits';
  productId: string;
  status: 'pending' | 'fulfilled';
};

export const validateUnlockPurchase = functions.https.onCall(async (data: { jws?: string }, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  const uid = context.auth.uid;

  const jws = String(data?.jws || '');
  if (!jws) throw new functions.https.HttpsError('invalid-argument', 'jws is required');

  let payload: Awaited<ReturnType<typeof verifyTransaction>>;
  try {
    payload = await verifyTransaction(jws);
  } catch (e) {
    functions.logger.error('validateUnlockPurchase: JWS verification failed', e);
    throw new functions.https.HttpsError('failed-precondition', 'Could not verify this purchase with Apple');
  }

  const transactionId = String(payload.transactionId || '');
  const productId = String(payload.productId || '');
  const appAccountToken = payload.appAccountToken || '';

  if (!KNOWN_PRODUCT_IDS.has(productId)) {
    throw new functions.https.HttpsError('invalid-argument', `Unrecognized product id: ${productId}`);
  }
  if (!transactionId || !appAccountToken) {
    throw new functions.https.HttpsError('invalid-argument', 'Transaction is missing required fields');
  }

  // Idempotency ledger — `purchases/{transactionId}` — guards against
  // double-processing the same Apple transaction (restore replay, the
  // native `Transaction.updates` listener firing for a transaction
  // already handled by the direct `purchase()` return path, a retried
  // client call, etc).
  const purchaseRef = db.collection('purchases').doc(transactionId);
  const intentRef = db.collection('unlockIntents').doc(String(appAccountToken));
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (tx) => {
    // All reads before any writes — required by Firestore transactions.
    const [purchaseSnap, intentSnap, userSnap] = await Promise.all([
      tx.get(purchaseRef), tx.get(intentRef), tx.get(userRef),
    ]);

    if (purchaseSnap.exists) {
      const existing = purchaseSnap.data()!;
      return {
        deltaHalfCredits: existing.deltaHalfCredits as number,
        balanceAfterHalfCredits: existing.balanceAfterHalfCredits as number,
        alreadyProcessed: true,
      };
    }

    if (!intentSnap.exists) {
      // No local record of what this purchase was for — the honest
      // answer is "we can't safely grant anything", not a guess. See
      // module doc comment: this is the known limit of consumable
      // restore without a durable per-purchase intent record.
      throw new functions.https.HttpsError(
        'failed-precondition',
        'No matching unlock request found for this purchase — contact support to resolve.'
      );
    }
    const intent = intentSnap.data() as UnlockIntent;
    if (intent.uid !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'This purchase belongs to a different account');
    }
    if (intent.productId !== productId) {
      throw new functions.https.HttpsError('failed-precondition', 'Product mismatch between purchase and unlock request');
    }
    if (intent.kind !== 'credits') {
      throw new functions.https.HttpsError('failed-precondition', `Unsupported unlock intent kind: ${intent.kind}`);
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    // Half-credits granted is looked up from the Apple-VERIFIED productId
    // (PRODUCT_HALF_CREDITS), never trusted off the intent doc or RPC body.
    const halfCredits = PRODUCT_HALF_CREDITS[productId];
    const source = (`iap_${productId}` as LedgerSource);

    const currentBalance: number = userSnap.exists ? (userSnap.data()?.creditBalanceHalfCredits ?? 0) : 0;
    const currentBySource: Partial<Record<LedgerSource, number>> =
      userSnap.exists ? (userSnap.data()?.creditBalanceBySourceHalfCredits ?? {}) : {};
    const balanceAfterHalfCredits = currentBalance + halfCredits;
    const newBySource = { ...currentBySource, [source]: (currentBySource[source] ?? 0) + halfCredits };

    const ledgerRef = userRef.collection('creditLedger').doc(transactionId);
    tx.set(ledgerRef, {
      source,
      deltaHalfCredits: halfCredits,
      balanceAfterHalfCredits,
      ts: now,
      ref: transactionId,
    });

    tx.set(userRef, {
      creditBalanceHalfCredits: balanceAfterHalfCredits,
      creditBalanceBySourceHalfCredits: newBySource,
      updatedAt: now,
    }, { merge: true });

    tx.set(purchaseRef, {
      uid,
      productId,
      intentId: appAccountToken,
      kind: intent.kind,
      environment: payload.environment || null,
      deltaHalfCredits: halfCredits,
      balanceAfterHalfCredits,
      createdAt: now,
    });
    tx.update(intentRef, { status: 'fulfilled', fulfilledAt: now, transactionId });

    return { deltaHalfCredits: halfCredits, balanceAfterHalfCredits, alreadyProcessed: false };
  });
});
