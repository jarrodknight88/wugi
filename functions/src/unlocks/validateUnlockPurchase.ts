// ─────────────────────────────────────────────────────────────────────
// Wugi — validateUnlockPurchase
// Server-side StoreKit 2 receipt validation for photo-unlock IAP (Asana
// 1216729383901466 / issue #252) — the entitlement writer the extension
// point in spendFreeUnlock.ts calls out. Verifies the signed transaction
// JWS the client got back from StoreKit, then writes to the SAME
// `unlocks` collection spendFreeUnlock uses (source: 'purchased'), so
// MyPhotosScreen / isPhotoUnlocked need no changes to support paid
// unlocks.
//
// WHY THE CLIENT CAN'T BE TRUSTED HERE: a client can fabricate any
// "I bought this" call. The transaction JWS is signed by Apple; this
// function is the only thing that verifies that signature and reads the
// productId/transactionId back OUT of the verified payload — never off
// anything the client passed in the RPC body except the JWS itself.
//
// PHOTO/GALLERY CONTEXT: Apple's consumable purchases carry no notion of
// "which photo" — that's bridged via `appAccountToken`, a UUID the client
// mints and writes to a Firestore `unlockIntents/{token}` doc (uid, kind,
// galleryId, photoId?) BEFORE starting the StoreKit purchase (see
// mobile-app/src/lib/iap.ts). We read the appAccountToken back out of the
// VERIFIED payload, then look up that intent doc server-side — a client
// cannot forge which photo a real Apple-signed purchase pays for.
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

// Reverse-DNS-style but NOT tied to the bundle id on purpose — the app's
// bundle id has drifted between builds (com.wugimedia.wugitest vs
// com.wugi.wugi — see PR description), while App Store Connect product
// ids, once created, are permanent. Must exactly match what's configured
// in ASC (app id 829564750) and mobile-app/src/lib/iap.ts PRODUCT_IDS.
const PRODUCT_IDS = {
  photo: 'unlock_single_photo',
  gallery: 'unlock_gallery',
} as const;
const KNOWN_PRODUCT_IDS = new Set<string>(Object.values(PRODUCT_IDS));

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
  kind: 'photo' | 'gallery';
  productId: string;
  galleryId: string;
  photoId?: string | null;
  photoIndex?: number | null;
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

  return db.runTransaction(async (tx) => {
    const [purchaseSnap, intentSnap] = await Promise.all([tx.get(purchaseRef), tx.get(intentRef)]);

    if (purchaseSnap.exists) {
      const existing = purchaseSnap.data()!;
      return { unlockIds: existing.unlockIds as string[], kind: existing.kind as 'photo' | 'gallery', alreadyProcessed: true };
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

    const now = admin.firestore.FieldValue.serverTimestamp();
    const unlockIds: string[] = [];

    // Firestore transactions require ALL reads to complete before ANY
    // write is staged — so every tx.get() below happens first (via
    // Promise.all), and every tx.set()/tx.update() happens only after.
    if (intent.kind === 'photo') {
      if (!intent.photoId) {
        throw new functions.https.HttpsError('failed-precondition', 'Unlock request is missing a photoId');
      }
      const galleryRef = db.collection('galleries').doc(intent.galleryId);
      const unlockRef = db.collection('unlocks').doc(`${uid}_${intent.photoId}`);
      const [gallerySnap, unlockSnap] = await Promise.all([tx.get(galleryRef), tx.get(unlockRef)]);
      const photographerId: string | null = gallerySnap.exists ? (gallerySnap.data()?.photographerId ?? null) : null;

      if (!unlockSnap.exists) {
        tx.set(unlockRef, {
          userId: uid,
          photoId: intent.photoId,
          galleryId: intent.galleryId,
          photoIndex: intent.photoIndex ?? null,
          photographerId,
          source: 'purchased',
          purchaseId: transactionId,
          productId,
          createdAt: now,
        });
      }
      unlockIds.push(unlockRef.id);
    } else {
      const galleryRef = db.collection('galleries').doc(intent.galleryId);
      const gallerySnap = await tx.get(galleryRef);
      if (!gallerySnap.exists) {
        throw new functions.https.HttpsError('not-found', `Gallery ${intent.galleryId} not found`);
      }
      const images: string[] = gallerySnap.data()?.images || [];
      const photographerId: string | null = gallerySnap.data()?.photographerId ?? null;

      const unlockRefs = images.map((_, index) => db.collection('unlocks').doc(`${uid}_${intent.galleryId}-${index}`));
      const unlockSnaps = await Promise.all(unlockRefs.map((ref) => tx.get(ref)));

      unlockRefs.forEach((unlockRef, index) => {
        unlockIds.push(unlockRef.id);
        if (!unlockSnaps[index].exists) {
          tx.set(unlockRef, {
            userId: uid,
            photoId: `${intent.galleryId}-${index}`,
            galleryId: intent.galleryId,
            photoIndex: index,
            photographerId,
            source: 'purchased',
            purchaseId: transactionId,
            productId,
            createdAt: now,
          });
        }
      });
    }

    tx.set(purchaseRef, {
      uid,
      productId,
      intentId: appAccountToken,
      kind: intent.kind,
      environment: payload.environment || null,
      unlockIds,
      createdAt: now,
    });
    tx.update(intentRef, { status: 'fulfilled', fulfilledAt: now, transactionId });

    return { unlockIds, kind: intent.kind, alreadyProcessed: false };
  });
});
