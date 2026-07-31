import { initializeApp, getApps, cert, type App } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"
import { getAuth, type Auth } from "firebase-admin/auth"

// Lazy init: nothing here may run at module scope. Next.js imports route
// modules during build-time page-data collection, where
// FIREBASE_SERVICE_ACCOUNT_BASE64 does not exist — a module-scope throw
// breaks the production build (seen 7/30: "Failed to collect page data").
function ensureApp(): App {
  const existing = getApps()
  if (existing.length) return existing[0]
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
  if (!encoded) throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 is not set")
  const sa = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))
  return initializeApp({
    credential: cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    }),
  })
}

export function getAdminDb(): Firestore {
  return getFirestore(ensureApp())
}

export function getAdminAuth(): Auth {
  return getAuth(ensureApp())
}
