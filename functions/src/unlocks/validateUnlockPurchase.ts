// ─────────────────────────────────────────────────────────────────────
// Wugi — validateUnlockPurchase
// Server-side StoreKit 2 receipt validation for the CREDIT ECONOMY (Asana
// 1218248530084817 / issue #282) — replaces the old 2-SKU photo-unlock IAP
// (Asana 1216729383901466 / issue #252). Apple sells CREDITS only now;
// everything is priced and unlocked in credits server-side (see
// functions/src/creditEconomy/spendCredit.ts). Architecture is UNCHANGED
// from the merged PR #253 (unlockIntents doc as appAccountToken, this CF,
// the `purchases` idempotency ledger) — only the product catalog and
// fulfillment target changed: fulfillment now credits `creditBalance`
// instead of writing a photo/gallery `unlocks` entitlement directly.
//
// WHY THE CLIENT CAN'T BE TRUSTED HERE: a client can fabricate any
// "I bought this" call. The transaction JWS is signed by Apple; this
// function is the only thing that verifies that signature and reads the
// productId/transactionId back OUT of the verified payload — never off
// anything the client passed in the RPC body except the JWS itself.
//
// INTENT BRIDGE: Apple's consumable purchases carry no notion of "which
// account" beyond `appAccountToken`, a UUID the client mints and writes to
// a Firestore `unlockIntents/{token}` doc (uid, kind: 'credits',
// productId) BEFORE starting the StoreKit purchase (see
// mobile-app/src/lib/iap.ts). We read the appAccountToken back out of the
// VERIFIED payload, then look up that intent doc server-side — a client
// cannot forge which account a real Apple-signed purchase pays into.
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

const db = admin.firestore();

// Three consumables (replaces unlock_single_photo / unlock_gallery) — must
// exactly match ASC product ids (app id 829564750, Jarrod creates these in
// console — out of scope for this task) and mobile-app/src/lib/iap.ts
// PRODUCT_IDS. Value = credits granted on fulfillment.
const CREDIT_GRANTS: Record<string, number> = {
  credits_1: 1,
  credits_3: 3,
  credits_5: 5,
};
const KNOWN_PRODUCT_IDS = new Set<string>(Object.keys(CREDIT_GRANTS));

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

// TestFlight and sandbox testing always produce Sandbox-environment
// transactions even though it's otherwise "the real app" — try Production
// first since that's the eventual steady state, fall back to Sandbox
// rather than rejecting.
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
    // Firestore transactions require ALL reads to complete before ANY
    // write is staged — every tx.get() below happens first (via
    // Promise.all), every tx.set()/tx.update() happens only after.
    const [purchaseSnap, intentSnap, userSnap] = await Promise.all([
      tx.get(purchaseRef),
      tx.get(intentRef),
      tx.get(userRef),
    ]);

    if (purchaseSnap.exists) {
      const existing = purchaseSnap.data()!;
      return {
        creditsGranted: existing.creditsGranted as number,
        balance: existing.balanceAfter as number,
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
        'No matching purchase request found for this transaction — contact support to resolve.'
      );
    }
    const intent = intentSnap.data() as UnlockIntent;
    if (intent.uid !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'This purchase belongs to a different account');
    }
    if (intent.productId !== productId) {
      throw new functions.https.HttpsError('failed-precondition', 'Product mismatch between purchase and purchase request');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const creditsGranted = CREDIT_GRANTS[productId];
    const currentBalance: number = userSnap.exists ? Number(userSnap.data()?.creditBalance ?? 0) : 0;
    const newBalance = currentBalance + creditsGranted;

    // Append-only ledger entry, running balance for auditability (Part 2)
    // — source matches the productId exactly (`iap_credits_1` etc, per the
    // enum in the issue).
    const ledgerRef = userRef.collection('creditLedger').doc();
    tx.set(ledgerRef, {
      source: `iap_${productId}`,
      delta: creditsGranted,
      balanceAfter: newBalance,
      ts: now,
      ref: transactionId,
    });
    tx.set(userRef, { creditBalance: newBalance, updatedAt: now }, { merge: true });

    tx.set(purchaseRef, {
      uid,
      productId,
      intentId: appAccountToken,
      kind: 'credits',
      creditsGranted,
      balanceAfter: newBalance,
      ledgerEntryId: ledgerRef.id,
      environment: payload.environment || null,
      createdAt: now,
    });
    tx.update(intentRef, { status: 'fulfilled', fulfilledAt: now, transactionId });

    return { creditsGranted, balance: newBalance, alreadyProcessed: false };
  });
});
