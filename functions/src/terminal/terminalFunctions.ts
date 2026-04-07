// ─────────────────────────────────────────────────────────────────────
// Wugi — Stripe Terminal: Connection Token + PaymentIntent
// Used exclusively by Wugi Door for Tap to Pay
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { stripe } from '../stripe/stripeUtils';

const db = admin.firestore();

// ── createTerminalConnectionToken ─────────────────────────────────────
// Called by Wugi Door on launch. Auto-creates a Stripe Terminal Location
// for the venue if one doesn't exist, then returns a connection token.
export const createTerminalConnectionToken = functions
  .https.onCall(async (data: { venueId: string }, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    const { venueId } = data;
    if (!venueId) throw new functions.https.HttpsError('invalid-argument', 'venueId required');

    const venueSnap = await db.collection('venues').doc(venueId).get();
    if (!venueSnap.exists) throw new functions.https.HttpsError('not-found', 'Venue not found');
    const venue = venueSnap.data()!;

    let stripeLocationId: string = venue.stripeTerminalLocationId;
    if (!stripeLocationId) {
      const location = await stripe.terminal.locations.create({
        display_name: venue.name || 'Wugi Venue',
        address: {
          line1: venue.address || '123 Main St',
          city: venue.city || 'Atlanta',
          state: venue.state || 'GA',
          country: 'US',
          postal_code: venue.zip || '30301',
        },
      });
      stripeLocationId = location.id;
      await db.collection('venues').doc(venueId).update({
        stripeTerminalLocationId: stripeLocationId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    const connectionToken = await stripe.terminal.connectionTokens.create({
      location: stripeLocationId,
    });

    return { secret: connectionToken.secret, locationId: stripeLocationId };
  });

// ── createTerminalPaymentIntent ───────────────────────────────────────
// Creates a PaymentIntent for Tap to Pay. Supports:
//  - Collecting a ticket's balance due
//  - Charging a walk-up door fee (new ticket)
export const createTerminalPaymentIntent = functions
  .https.onCall(async (data: {
    amountCents: number;
    venueId: string;
    eventId: string;
    ticketId?: string;       // if collecting balance on existing ticket
    description?: string;
    customerName?: string;
    customerEmail?: string;
  }, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');

    const { amountCents, venueId, eventId, ticketId, description, customerName, customerEmail } = data;
    if (!amountCents || amountCents < 50) throw new functions.https.HttpsError('invalid-argument', 'Minimum charge is $0.50');

    // Look up Stripe location for this venue
    const venueSnap = await db.collection('venues').doc(venueId).get();
    const stripeLocationId = venueSnap.data()?.stripeTerminalLocationId;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      description: description || 'Wugi door payment',
      metadata: {
        venueId,
        eventId,
        ...(ticketId ? { ticketId } : {}),
        ...(customerName ? { customerName } : {}),
        ...(customerEmail ? { customerEmail } : {}),
        source: 'wugi_door',
        staffUid: context.auth.uid,
      },
      ...(stripeLocationId ? { terminal_id: stripeLocationId } : {}),
    });

    return {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
    };
  });

// ── captureTerminalPayment ────────────────────────────────────────────
// Called after the Terminal SDK confirms the payment.
// Updates Firestore: clears balanceDue, writes payment record.
export const captureTerminalPayment = functions
  .https.onCall(async (data: {
    paymentIntentId: string;
    ticketId?: string;
    eventId: string;
    amountCents: number;
    newTicketData?: {
      holderName: string; holderEmail: string;
      ticketTypeId: string; ticketTypeName: string;
      color: string; tableAssignment: string;
    };
  }, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');

    const { paymentIntentId, ticketId, eventId, amountCents, newTicketData } = data;

    // Retrieve PI to confirm it was captured
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== 'succeeded') {
      throw new functions.https.HttpsError('failed-precondition', `Payment not succeeded: ${pi.status}`);
    }

    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (ticketId) {
      // Existing ticket — clear balance due
      const ticketRef = db.collection('events').doc(eventId).collection('tickets').doc(ticketId);
      batch.update(ticketRef, { balanceDue: 0, depositPaid: amountCents, updatedAt: now });
    } else if (newTicketData) {
      // Walk-up — create new ticket
      const ticketRef = db.collection('events').doc(eventId).collection('tickets').doc();
      batch.set(ticketRef, {
        ...newTicketData, eventId, checkedIn: false, status: 'valid',
        source: 'door', price: amountCents, depositPaid: amountCents, balanceDue: 0,
        createdAt: now, updatedAt: now,
      });
      // Decrement remaining on ticket type
      const ttRef = db.collection('events').doc(eventId)
        .collection('ticketTypes').doc(newTicketData.ticketTypeId);
      batch.update(ttRef, {
        sold: admin.firestore.FieldValue.increment(1),
        remaining: admin.firestore.FieldValue.increment(-1),
        updatedAt: now,
      });
    }

    // Write payment record
    const paymentRef = db.collection('terminalPayments').doc();
    batch.set(paymentRef, {
      paymentIntentId, eventId, ticketId: ticketId || null,
      amountCents, staffUid: context.auth.uid,
      status: 'succeeded', source: 'tap_to_pay', createdAt: now,
    });

    await batch.commit();
    return { success: true, ticketId: ticketId || (newTicketData ? paymentRef.id : null) };
  });
