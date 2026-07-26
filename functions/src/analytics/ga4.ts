// ─────────────────────────────────────────────────────────────────────
// Wugi — GA4 Measurement Protocol
//
// Server-side event logging for revenue events (ticket_purchased) that must
// fire from the Stripe webhook, not the mobile client — see stripe/webhook.ts
// handlePaymentSuccess. Uses the Measurement Protocol HTTP API directly (no
// SDK / no new package — Node 20 functions runtime has native fetch).
//
// REQUIRES two env vars, neither of which exists yet:
//   GA_MEASUREMENT_ID — the GA4 web/app data stream's Measurement ID (G-XXXXXXX)
//   GA_API_SECRET     — created under that stream: GA4 Admin → Data Streams →
//                        (stream) → Measurement Protocol API secrets → Create
// Until both are set, logGA4Event() no-ops (info log only) — it will never
// throw or block the caller, so the payment webhook is unaffected either way.
// ─────────────────────────────────────────────────────────────────────
import * as logger from 'firebase-functions/logger';

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

type GA4Event = {
  name: string;
  params: Record<string, string | number>;
};

/** clientId: GA4 requires a client_id per event; we pass the purchaser's userId. */
export async function logGA4Event(clientId: string, event: GA4Event): Promise<void> {
  const measurementId = process.env.GA_MEASUREMENT_ID;
  const apiSecret      = process.env.GA_API_SECRET;

  if (!measurementId || !apiSecret) {
    logger.info('GA4 Measurement Protocol not configured — skipping event', { name: event.name });
    return;
  }

  try {
    const res = await fetch(
      `${GA4_ENDPOINT}?measurement_id=${measurementId}&api_secret=${apiSecret}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ client_id: clientId, events: [event] }),
      }
    );
    if (!res.ok) {
      logger.warn('GA4 Measurement Protocol request failed', { status: res.status, name: event.name });
    }
  } catch (err) {
    logger.warn('GA4 Measurement Protocol request errored', { err, name: event.name });
  }
}
