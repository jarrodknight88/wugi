// Server-only Firebase Admin SDK init — used by Route Handlers under
// app/api/** to read/write collections that deny all client access
// (e.g. venueIntel). Never import this from a "use client" file.
import admin from "firebase-admin"

function getCredential(): admin.credential.Credential {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64
  if (b64) {
    const serviceAccount = JSON.parse(Buffer.from(b64, "base64").toString("utf8"))
    return admin.credential.cert(serviceAccount)
  }
  // Falls back to Application Default Credentials — works when the
  // dashboard is hosted on GCP infra (e.g. Cloud Run / Firebase App
  // Hosting) with a service account attached to the runtime.
  return admin.credential.applicationDefault()
}

function getAdminApp(): admin.app.App {
  return admin.apps.length ? admin.app() : admin.initializeApp({ credential: getCredential() })
}

export const adminApp = getAdminApp()
export const adminDb = adminApp.firestore()
export const adminAuth = adminApp.auth()
export { admin }
