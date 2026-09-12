// ─────────────────────────────────────────────────────────────────────
// Wugi — validateUnlockPurchase
// Server-side StoreKit 2 receipt validation for the credit-economy IAP
// (Asana 1218248530084817 / issue #282 — replaces the original 2-SKU
// photo-unlock IAP this file shipped for under issue #252). Apple now
// only ever sells CREDITS: verifies the signed transaction JWS the client
// got back from StoreKit, then credits the buyer's `creditLedger` balance
// instead of unlocking a photo directly. Spending credits on a specific
// photo/gallery happens later, entirely server-side, via
// functions/src/credits/spendCredits.ts.
//
// WHY THE CLIENT CAN'T BE TRUSTED HERE: a client can fabricate any
// "I bought this" call. The transaction JWS is signed by Apple; this
// function is the only thing that verifies that signature and reads the
// productId/transactionId back OUT of the verified payload — never off
// anything the client passed in the RPC body except the JWS itself.
//
// PURCHASE CONTEXT: `appAccountToken`, a UUID the client mints and writes
// to a Firestore `unlockIntents/{token}` doc (uid, kind:'credits',
// productId) BEFORE starting the StoreKit purchase (see
// mobile-app/src/lib/iap.ts) — kept unchanged from the original PR #253
// architecture per issue #282's explicit instruction, even though a
// credit-pack purchase isn't "for" any particular photo anymore. We read
// the appAccountToken back out of the VERIFIED payload, then look up that
// intent doc server-side — a client cannot forge which account a real
// Apple-signed purchase credits.
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
//
// DELTA 1 (Jarrod/PM 9/12) — DUAL BUNDLE ID CUTOVER PLAN: Jarrod is
// deliberately staying on com.wugimedia.wugitest for TestFlight/sandbox
// QA until the last step before App Store submission, at which point the
// app cuts over to com.wugi.wugi (the real bundle id, ASC app id
// 829564750). Rather than a single hardcoded bundle id that would need a
// synchronized code deploy + app resubmission on cutover day, BUNDLE_IDS
// is an ordered list and we try every (bundle id × environment)
// combination in order — wugitest prod, wugitest sandbox, wugi prod, wugi
// sandbox — caching one verifier per pair. This list is deliberately kept
// even after cutover for one release cycle (in-flight TestFlight builds
// still on wugitest need to keep verifying) — trim to just wugi.wugi once
// no live build depends on wugitest. Still fails closed if NONE of the
// four verify.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as https from 'https';
import { SignedDataVerifier, Environment } from '@apple/app-store-server-library';
import { CREDIT_PACKS, creditsToHalfUnits } from '../credits/creditEconomy';

const db = admin.firestore();

// Ordered oldest-first — see DELTA 1 doc comment above for the cutover plan.
const BUNDLE_IDS = ['com.wugimedia.wugitest', 'com.wugi.wugi'] as const;
const APP_APPLE_ID = 829564750;

const KNOWN_PRODUCT_IDS = new Set<string>(Object.keys(CREDIT_PACKS));

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

// One verifier per (bundle id, environment) pair, keyed by
// `${bundleId}:${environment}` — DELTA 1.
const verifierCache = new Map<string, SignedDataVerifier>();

async function getVerifier(bundleId: string, environment: Environment): Promise<SignedDataVerifier> {
  const key = `${bundleId}:${environment}`;
  const cached = verifierCache.get(key);
  if (cached) return cached;
  const certs = await getAppleRootCerts();
  const verifier = environment === Environment.PRODUCTION
    ? new SignedDataVerifier(certs, true, Environment.PRODUCTION, bundleId, APP_APPLE_ID)
    : new SignedDataVerifier(certs, true, Environment.SANDBOX, bundleId);
  verifierCache.set(key, verifier);
  return verifier;
}

// DELTA 1: try every bundle id in BUNDLE_IDS order, Production before
// Sandbox within each (TestFlight/sandbox QA always produces
// Sandbox-environment transactions even though it's otherwise "the real
// app" — Production is the eventual steady state so it's tried first,
// falling back to Sandbox rather than rejecting). Fails closed — throws
// the last error — only once every combination has been exhausted.
async function verifyTransaction(jws: string) {
  let lastError: unknown;
  for (const bundleId of BUNDLE_IDS) {
    for (const environment of [Environment.PRODUCTION, Environment.SANDBOX]) {
      try {
        const verifier = await getVerifier(bundleId, environment);
        return await verifier.verifyAndDecodeTransaction(jws);
      } catch (e) {
        lastError = e;
      }
    }
  }
  throw lastError;
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
    const [purchaseSnap, intentSnap, userSnap] = await Promise.all([
      tx.get(purchaseRef), tx.get(intentRef), tx.get(userRef),
    ]);

    if (purchaseSnap.exists) {
      const existing = purchaseSnap.data()!;
      return {
        creditsGranted: existing.creditsGranted as number,
        newBalanceHalfUnits: existing.newBalanceHalfUnits as number,
        alreadyProcessed: true,
      };
    }

    if (!intentSnap.exists) {
      // No local record of what this purchase was for — the honest
      // answer is "we can't safely grant anything", not a guess.
      throw new functions.https.HttpsError(
        'failed-precondition',
        'No matching purchase request found for this purchase — contact support to resolve.'
      );
    }
    const intent = intentSnap.data() as UnlockIntent;
    if (intent.uid !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'This purchase belongs to a different account');
    }
    if (intent.productId !== productId) {
      throw new functions.https.HttpsError('failed-precondition', 'Product mismatch between purchase and unlock request');
    }
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'User profile not found');
    }

    const pack = CREDIT_PACKS[productId];
    const grantedHalfUnits = creditsToHalfUnits(pack.credits);
    const balanceBySource: Record<string, number> = userSnap.data()?.creditBalanceBySourceHalfUnits || {};
    const currentSourceBalance = balanceBySource[pack.source] || 0;
    const nextBalanceBySource = { ...balanceBySource, [pack.source]: currentSourceBalance + grantedHalfUnits };
    const currentTotal: number = userSnap.data()?.creditBalanceHalfUnits || 0;
    const newTotal = currentTotal + grantedHalfUnits;

    const now = admin.firestore.FieldValue.serverTimestamp();
    const ledgerRef = userRef.collection('creditLedger').doc(`iap_${transactionId}`);

    tx.set(ledgerRef, {
      source: pack.source,
      delta: grantedHalfUnits,
      ts: now,
      ref: { transactionId, productId },
      balanceAfterHalfUnits: newTotal,
    });

    tx.update(userRef, {
      creditBalanceHalfUnits: newTotal,
      creditBalanceBySourceHalfUnits: nextBalanceBySource,
      updatedAt: now,
    });

    tx.set(purchaseRef, {
      uid,
      productId,
      intentId: appAccountToken,
      kind: 'credits',
      environment: payload.environment || null,
      creditsGranted: pack.credits,
      newBalanceHalfUnits: newTotal,
      ledgerEntryId: ledgerRef.id,
      createdAt: now,
    });
    tx.update(intentRef, { status: 'fulfilled', fulfilledAt: now, transactionId });

    return { creditsGranted: pack.credits, newBalanceHalfUnits: newTotal, alreadyProcessed: false };
  });
});
