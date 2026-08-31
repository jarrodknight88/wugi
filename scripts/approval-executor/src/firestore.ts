import * as admin from 'firebase-admin';
import { loadServiceAccountPath } from './serviceAccount';

let app: admin.app.App | null = null;

export function getFirestore(): admin.firestore.Firestore {
  if (!app) {
    const serviceAccountPath = loadServiceAccountPath();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const serviceAccount = require(serviceAccountPath);
    app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return app.firestore();
}

export { admin };
