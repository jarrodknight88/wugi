// ─────────────────────────────────────────────────────────────────────
// Wugi — createPaymentIntent Cloud Function
// Called by the app before presenting Stripe Payment Sheet.
// Creates a PaymentIntent and returns the client secret.
// Supports both authenticated users and guest checkout.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { stripe, calculateBookingFee } from '../stripe/stripeUtils';

const db = admin.firestore();

interface CreatePaymentIntentRequest {
  eventId:         string;
  ticketTypeId:    string;
  quantity:        number;
  // Authenticated user fields
  userId?:         string;
  // Guest checkout fields
  guestName?:      string;
  guestEmail?:     string;
  guestPhone?:     string;
}

export const createPaymentIntent = functions.https.onCall(
  async (data: CreatePaymentIntentRequest, context) => {
    const { eventId, ticketTypeId, quantity } = data;
    const userId     = context.auth?.uid ?? null;
    const isGuest    = !userId;

    // ── Validate required fields ────────────────────────────────────
    if (!eventId || !ticketTypeId || !quantity) {
      throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
    }

    // Guest must provide contact info
    if (isGuest && (!data.guestEmail || !data.guestName)) {
      throw new functions.https.HttpsError('invalid-argument', 'Guest checkout requires name and email');
    }

    // ── Fetch ticket type ────────────────────────────────────────────
    const ticketTypeRef = db
      .collection('events').doc(eventId)
      .collection('ticketTypes').doc(ticketTypeId);
    const ticketTypeDoc = await ticketTypeRef.get();

    if (!ticketTypeDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Ticket type not found');
    }

    const ticketType = ticketTypeDoc.data()!;

    if (ticketType.status !== 'on_sale') {
      throw new functions.https.HttpsError('failed-precondition', 'Ticket type is not on sale');
    }
    if (ticketType.remaining < quantity) {
      throw new functions.https.HttpsError('failed-precondition', 'Not enough tickets remaining');
    }

    // ── Fetch event + venue for metadata ────────────────────────────
    const [eventDoc, venueDoc] = await Promise.all([
      db.collection('events').doc(eventId).get(),
      ticketType.venueId ? db.collection('venues').doc(ticketType.venueId).get() : null,
    ]);

    const event = eventDoc.data();
    const venue = venueDoc?.data();

    // ── Calculate amounts (all in cents) ────────────────────────────
    const subtotal   = ticketType.price * quantity;
    const bookingFee = calculateBookingFee(subtotal, {
      feePercent: ticketType.bookingFeePercent ?? undefined,
      feeMin:     ticketType.bookingFeeMin     ?? undefined,
      feeMax:     ticketType.bookingFeeMax     ?? undefined,
    });
    const total      = subtotal + bookingFee; // tax added by Stripe Tax

    // ── Get or create Stripe customer ────────────────────────────────
    let stripeCustomerId: string | undefined;

    if (userId) {
      const userDoc = await db.collection('users').doc(userId).get();
      stripeCustomerId = userDoc.data()?.stripeCustomerId;

      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          email:    context.auth?.token.email ?? '',
          metadata: { firebaseUID: userId },
        });
        stripeCustomerId = customer.id;
        await db.collection('users').doc(userId).update({
          stripeCustomerId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    // ── Create PaymentIntent ─────────────────────────────────────────
    const paymentIntentParams: any = {
      amount:   total,
      currency: 'usd',
      // Stripe Tax automatic calculation
      automatic_tax: { enabled: !ticketType.taxIncluded },
      // Save payment method for authenticated users
      setup_future_usage: userId ? 'off_session' : undefined,
      customer: stripeCustomerId,
      metadata: {
        eventId,
        ticketTypeId,
        ticketTypeName:   ticketType.name,
        venueId:          ticketType.venueId ?? '',
        quantity:         String(quantity),
        subtotal:         String(subtotal),
        bookingFee:       String(bookingFee),
        taxIncluded:      String(ticketType.taxIncluded),
        userId:           userId ?? 'guest',
        guestName:        data.guestName ?? '',
        guestEmail:       data.guestEmail ?? '',
        guestPhone:       data.guestPhone ?? '',
        buyerName:        userId ? (context.auth?.token.name ?? '') : (data.guestName ?? ''),
        buyerEmail:       userId ? (context.auth?.token.email ?? '') : (data.guestEmail ?? ''),
        buyerPhone:       data.guestPhone ?? '',
        eventName:        event?.name ?? event?.title ?? '',
        venueName:        venue?.name ?? '',
        eventDate:        event?.date ?? '',
        eventTime:        event?.time ?? '',
        items: JSON.stringify([{
          ticketTypeId,
          ticketTypeName:  ticketType.name,
          quantity,
          unitPrice:       ticketType.price,
          subtotal,
          taxIncluded:     ticketType.taxIncluded,
        }]),
      },
    };

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    logger.info('PaymentIntent created', {
      paymentIntentId: paymentIntent.id,
      amount: total,
      userId: userId ?? 'guest',
      eventId,
    });

    return {
      clientSecret:     paymentIntent.client_secret,
      publishableKey:   process.env.STRIPE_PUBLISHABLE_KEY,
      customerId:       stripeCustomerId ?? null,
      subtotal,
      bookingFee,
      total,
      isGuest,
    };
  }
);
