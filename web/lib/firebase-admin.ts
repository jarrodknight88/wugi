import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"

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
  })
}

export const adminDb = getFirestore()
