// ─────────────────────────────────────────────────────────────────────
// Wugi — callCallableFunction
// Invokes a Firebase Cloud Functions `https.onCall` function over its raw
// HTTP protocol (POST {data}, response {result}/{error}) via plain
// `fetch` + a Firebase Auth ID token, instead of the
// `@react-native-firebase/functions` SDK — which isn't installed here.
// mobile-app has no callable-function caller today (spendFreeUnlock and
// getPhotographerEarnings were both built server-side but never wired to
// a client — see docs/audits/2026-08-29-state-of-the-union-v2.md); adding
// a whole new Firebase sub-package for this one call site isn't worth it
// when the callable HTTP contract is small, stable, and already how
// mobile-app/web calls plain `onRequest` functions (see
// web/app/tickets/claim/[token]/ClaimForm.tsx for the sibling pattern).
//
// Region is us-central1 — every function in functions/src/index.ts is
// exported with no `.region(...)` override, so that's the Firebase
// default. If a future function moves regions, this needs a per-call
// override; there's exactly one region in use today so it isn't
// parameterized.
// ─────────────────────────────────────────────────────────────────────
import { getAuth } from '@react-native-firebase/auth';

const PROJECT_ID = 'wugi-prod';
const REGION = 'us-central1';

export class CallableFunctionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function callCallableFunction<TResult = unknown>(
  name: string,
  data: Record<string, unknown> = {}
): Promise<TResult> {
  const user = getAuth().currentUser;
  if (!user) throw new CallableFunctionError('unauthenticated', 'Sign in required');
  const idToken = await user.getIdToken();

  const res = await fetch(`https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok || !body || body.error) {
    const err = body?.error || {};
    // The callable wire protocol reports `status` as an UPPER_SNAKE_CASE
    // gRPC status name (e.g. "FAILED_PRECONDITION"); normalize to the
    // lowercase-hyphenated form functions.https.HttpsError callers use
    // (e.g. 'failed-precondition') so `error.code === 'failed-precondition'`
    // checks on the client work regardless of exact wire casing.
    const code = String(err.status || 'internal').toLowerCase().replace(/_/g, '-');
    throw new CallableFunctionError(code, err.message || `${name} failed (${res.status})`);
  }

  return body.result as TResult;
}
