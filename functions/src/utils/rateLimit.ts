// ─────────────────────────────────────────────────────────────────────
// Wugi — Firestore-backed fixed-window rate limiter
// Shared by sensitive endpoints (PIN attempts, payment intents, refunds)
// so a single caller can't fan out unlimited attempts. One Firestore
// transaction per call — not meant for high-QPS paths.
// ─────────────────────────────────────────────────────────────────────
import * as admin from 'firebase-admin';

export async function checkRateLimit(
  key: string,
  opts: { max: number; windowSeconds: number }
): Promise<boolean> {
  const db  = admin.firestore();
  // Firestore doc IDs can't contain '/' — callers key on uid/IP, neither
  // of which should ever contain one, but sanitize defensively anyway.
  const ref = db.collection('rateLimits').doc(key.replace(/\//g, '_'));
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();

    if (!data || now - data.windowStart >= opts.windowSeconds * 1000) {
      tx.set(ref, { windowStart: now, count: 1 });
      return true;
    }

    if (data.count >= opts.max) return false;

    tx.update(ref, { count: admin.firestore.FieldValue.increment(1) });
    return true;
  });
}
