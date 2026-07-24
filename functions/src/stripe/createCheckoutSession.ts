// ─────────────────────────────────────────────────────────────────────
// Wugi — createCheckoutSession
// Creates a Stripe Checkout session for web ticket purchases.
// Called from wugi.us web app via fetch.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { stripe } from './stripeUtils';

const db = admin.firestore();

export const createCheckoutSession = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { eventId, ticketTypeId, quantity, successUrl, cancelUrl } = req.body;

  if (!eventId || !ticketTypeId || !quantity || !successUrl || !cancelUrl) {
    res.status(400).json({ error: 'Missing required fields' }); return;
  }

  try {
    const ticketSnap = await db
      .collection('events').doc(eventId)
      .collection('ticketTypes').doc(ticketTypeId).get();

    if (!ticketSnap.exists) { res.status(404).json({ error: 'Ticket type not found' }); return; }

    const ticket = ticketSnap.data()!;
    const eventSnap = await db.collection('events').doc(eventId).get();
    const event = eventSnap.data();

    const subtotal = ticket.price * quantity;
    const fee = Math.min(Math.max(Math.round(subtotal * 0.12), 199), 10000);
    const total = subtotal + fee;

    // Shape mirrors the in-app path's PaymentIntent metadata (see
    // createPaymentIntentHttp.ts) — handlePaymentSuccess in stripe/webhook.ts
    // requires userId + eventId + items (JSON) to write the order/pass/payout.
    const items = JSON.stringify([{
      ticketTypeId,
      ticketTypeName: ticket.name,
      quantity,
      unitPrice:      ticket.price,
      subtotal,
      taxIncluded:    ticket.taxIncluded ?? false,
    }]);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${event?.title ?? eventId} — ${ticket.name}`,
            description: `${quantity} ticket${quantity > 1 ? 's' : ''} · Wugi`,
          },
          unit_amount: total,
        },
        quantity: 1,
      }],
      // Session-level metadata — kept for Stripe Dashboard visibility. NOT
      // read by the webhook; Stripe does not propagate this to the
      // PaymentIntent, which is what handlePaymentSuccess actually reads.
      metadata: { eventId, ticketTypeId, quantity: String(quantity), unitPrice: String(ticket.price), fee: String(fee) },
      // payment_intent_data.metadata lands on the PaymentIntent itself —
      // this is what the webhook reads. Without this, web checkout never
      // produces an order/pass/payout (AUDIT-C finding #4).
      payment_intent_data: {
        metadata: {
          eventId,
          ticketTypeId,
          venueId:      ticket.venueId ?? '',
          quantity:     String(quantity),
          subtotal:     String(subtotal),
          bookingFee:   String(fee),
          taxIncluded:  String(ticket.taxIncluded ?? false),
          // Web checkout has no auth session and collects no buyer info
          // client-side today — treated as guest, same convention as the
          // in-app guest-checkout path (createPaymentIntentHttp.ts).
          userId:       'guest',
          items,
        },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    res.status(200).json({ url: session.url });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    functions.logger.error('createCheckoutSession error:', e);
    res.status(500).json({ error: msg });
  }
});
