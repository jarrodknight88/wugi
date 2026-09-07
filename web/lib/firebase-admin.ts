import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { getStorage } from "firebase-admin/storage"

// wugi-prod's default bucket is 'wugi-prod.firebasestorage.app', NOT the
// legacy '.appspot.com' domain below used to init the app — mixing the two
// silently 404s signed URLs (see dashboard/lib/firebase-admin.ts's note on
// the 7/31 hotfix). New code should call `adminStorage.bucket(STORAGE_BUCKET)`
// explicitly rather than relying on the app's default bucket.
export const STORAGE_BUCKET = "wugi-prod.firebasestorage.app"

if (!getApps().length) {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
  if (!encoded) throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 is not set")
  const sa = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))
  initializeApp({
    credential: cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    }),
    storageBucket: "wugi-prod.appspot.com",
  })
}

export const adminDb      = getFirestore()
export const adminStorage = getStorage()
