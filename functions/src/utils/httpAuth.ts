// ─────────────────────────────────────────────────────────────────────
// Wugi — Bearer token verification for onRequest (HTTP) functions
// onCall functions get context.auth for free; onRequest functions must
// verify the Firebase ID token themselves. Never trust a client-supplied
// uid/userId field on an HTTP body — always resolve identity from the
// verified token instead.
// ─────────────────────────────────────────────────────────────────────
import * as admin from 'firebase-admin';

export async function verifyBearerToken(
  req: { headers: Record<string, unknown> }
): Promise<admin.auth.DecodedIdToken | null> {
  const header = (req.headers?.authorization ?? req.headers?.Authorization) as string | undefined;
  if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) return null;

  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;

  try {
    return await admin.auth().verifyIdToken(token);
  } catch {
    return null;
  }
}
