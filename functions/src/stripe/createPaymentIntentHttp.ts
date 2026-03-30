// ─────────────────────────────────────────────────────────────────────
// Wugi — createPaymentIntentHttp
// HTTP version of createPaymentIntent for direct fetch from mobile app.
// The onCall version requires the Firebase Functions SDK.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { stripe, calculateBookingFee } from '../stripe/stripeUtils';

const db = admin.firestore();

export const createPaymentIntentHttp = functions.https.onRequest(async (req, res) => {
  // Allow CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const body = req.body?.data ?? req.body;
  const { eventId, ticketTypeId, quantity, userId, guestName, guestEmail, guestPhone } = body;

  if (!eventId || !ticketTypeId || !quantity) {
    res.status(400).json({ error: { message: 'Missing required fields' } }); return;
  }
  if (!userId && (!guestEmail || !guestName)) {
    res.status(400).json({ error: { message: 'Guest checkout requires name and email' } }); return;
  }

  try {
    const ticketTypeDoc = await db
      .collection('events').doc(eventId)
      .collection('ticketTypes').doc(ticketTypeId).get();

    if (!ticketTypeDoc.exists) { res.status(404).json({ error: { message: 'Ticket type not found' } }); return; }

    const ticketType = ticketTypeDoc.data()!;
    if (ticketType.status !== 'on_sale') { res.status(400).json({ error: { message: 'Ticket not on sale' } }); return; }
    if (ticketType.remaining < quantity) { res.status(400).json({ error: { message: 'Not enough tickets' } }); return; }

    const [eventDoc, venueDoc] = await Promise.all([
      db.collection('events').doc(eventId).get(),
      ticketType.venueId ? db.collection('venues').doc(ticketType.venueId).get() : null,
    ]);
    const event = eventDoc.data();
    const venue = venueDoc?.data();

    const subtotal   = ticketType.price * quantity;
    const bookingFee = calculateBookingFee(subtotal);
    const total      = subtotal + bookingFee;

    // Get or create Stripe customer for authenticated users
    let stripeCustomerId: string | undefined;
    let ephemeralKey: string | undefined;
    if (userId) {
      const userDoc = await db.collection('users').doc(userId).get();
      stripeCustomerId = userDoc.data()?.stripeCustomerId;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({ metadata: { firebaseUID: userId } });
        stripeCustomerId = customer.id;
        await db.collection('users').doc(userId).update({ stripeCustomerId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
      // Create ephemeral key so Payment Sheet can show saved cards
      const ek = await stripe.ephemeralKeys.create(
        { customer: stripeCustomerId },
        { apiVersion: '2023-10-16' }
      );
      ephemeralKey = ek.secret;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   total,
      currency: 'usd',
      setup_future_usage: userId ? 'off_session' as const : undefined,
      customer: stripeCustomerId,
      metadata: {
        eventId, ticketTypeId, quantity: String(quantity),
        ticketTypeName:  ticketType.name,
        venueId:         ticketType.venueId ?? '',
        subtotal:        String(subtotal),
        bookingFee:      String(bookingFee),
        taxIncluded:     String(ticketType.taxIncluded),
        userId:          userId ?? 'guest',
        guestName:       guestName ?? '',
        guestEmail:      guestEmail ?? '',
        guestPhone:      guestPhone ?? '',
        buyerName:       userId ? '' : (guestName ?? ''),
        buyerEmail:      userId ? '' : (guestEmail ?? ''),
        buyerPhone:      guestPhone ?? '',
        eventName:       event?.name ?? event?.title ?? '',
        venueName:       venue?.name ?? '',
        eventDate:       event?.date ?? '',
        eventTime:       event?.time ?? '',
        items: JSON.stringify([{
          ticketTypeId, ticketTypeName: ticketType.name,
          quantity, unitPrice: ticketType.price,
          subtotal, taxIncluded: ticketType.taxIncluded,
        }]),
      },
    });

    logger.info('PaymentIntent created', { id: paymentIntent.id, amount: total });

    res.json({
      result: {
        clientSecret:        paymentIntent.client_secret,
        publishableKey:      process.env.STRIPE_PUBLISHABLE_KEY,
        customerId:          stripeCustomerId ?? null,
        customerEphemeralKey: ephemeralKey ?? null,
        subtotal, bookingFee, total,
        isGuest: !userId,
      },
    });
  } catch (e: any) {
    logger.error('createPaymentIntentHttp error', e);
    res.status(500).json({ error: { message: e.message ?? 'Internal error' } });
  }
});
