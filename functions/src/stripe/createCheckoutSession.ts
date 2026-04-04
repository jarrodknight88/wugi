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
      metadata: { eventId, ticketTypeId, quantity: String(quantity), unitPrice: String(ticket.price), fee: String(fee) },
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
