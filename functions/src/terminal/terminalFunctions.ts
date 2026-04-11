// ─────────────────────────────────────────────────────────────────────
// Wugi — Stripe Terminal: Connection Token + PaymentIntent
// Used exclusively by Wugi Door for Tap to Pay
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { stripe, calculateBookingFee } from '../stripe/stripeUtils';

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

    functions.logger.info('Connection token created', {
      livemode: (connectionToken as any).livemode,
      stripeKey: process.env.STRIPE_SECRET_KEY?.slice(0, 12),
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
    statementDescriptor?: string;
    customerName?: string;
    customerEmail?: string;
  }, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');

    const { amountCents, venueId, eventId, ticketId, description, statementDescriptor, customerName, customerEmail } = data;
    if (!amountCents || amountCents < 50) throw new functions.https.HttpsError('invalid-argument', 'Minimum charge is $0.50');

    // Fetch venue for custom descriptor
    const venueSnap = await db.collection('venues').doc(venueId).get();

    // Use venue's custom payment descriptor if set (for discretion)
    const venueDescriptor = venueSnap.exists
      ? venueSnap.data()?.paymentDescriptor || statementDescriptor || ''
      : statementDescriptor || '';
    const cleanDescriptor = venueDescriptor.slice(0, 22).replace(/[^a-zA-Z0-9 ]/g, '').trim();

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      payment_method_types: ['card_present'],
      capture_method: 'manual',  // Manual — authorize now, capture after ID verification
      description: description || 'Wugi door payment',
      ...(cleanDescriptor ? { statement_descriptor: cleanDescriptor } : {}),
      metadata: {
        venueId,
        eventId,
        ...(ticketId ? { ticketId } : {}),
        ...(customerName ? { customerName } : {}),
        ...(customerEmail ? { customerEmail } : {}),
        source: 'wugi_door',
        staffUid: context.auth.uid,
      },

    });

    // Store pending authorization record for auto-settlement safety net
    await db.collection('terminalPendingAuths').doc(paymentIntent.id).set({
      paymentIntentId: paymentIntent.id,
      venueId,
      eventId,
      ticketId: ticketId || null,
      amountCents,
      staffUid: context.auth.uid,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      // Auto-settle deadline: 6am ET next morning
      autoSettleAt: (() => {
        const now = new Date();
        const settle = new Date();
        settle.setUTCHours(11, 0, 0, 0); // 6am ET = 11am UTC
        if (settle <= now) settle.setDate(settle.getDate() + 1);
        return admin.firestore.Timestamp.fromDate(settle);
      })(),
    });

    return {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
    };
  });

// ── captureTerminalPayment ────────────────────────────────────────────
// Called after the Terminal SDK confirms the payment.
// Applies 12% booking fee, transfers venue payout via Stripe Connect,
// updates Firestore tickets, writes payment record.
export const captureTerminalPayment = functions
  .https.onCall(async (data: {
    paymentIntentId: string;
    ticketId?: string;
    eventId: string;
    venueId: string;
    amountCents: number;
    newTicketData?: {
      holderName: string; holderEmail: string; holderPhone?: string;
      ticketTypeId: string; ticketTypeName: string;
      color: string; tableAssignment: string;
      idVerification?: any;
    };
    idScanData?: {
      idName?: string; idNumberLast4?: string; idState?: string;
      age?: number; nameMatchScore?: number; cardNameMatch?: boolean | null;
      verified?: boolean; bypassedBy?: string; scannedAt?: string;
    };
  }, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');

    const { paymentIntentId, ticketId, eventId, venueId, amountCents, newTicketData, idScanData } = data;

    // Retrieve PI — for manual capture it should be 'requires_capture'
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    const isAlreadyCaptured = pi.status === 'succeeded';
    const canCapture = pi.status === 'requires_capture' || isAlreadyCaptured;
    if (!canCapture) {
      throw new functions.https.HttpsError('failed-precondition', `Payment cannot be captured: ${pi.status}`);
    }

    // Capture the payment (if not already captured by auto-settler)
    if (pi.status === 'requires_capture') {
      await stripe.paymentIntents.capture(paymentIntentId);
    }

    // Look up venue for Stripe Connect account ID
    const venueSnap = await db.collection('venues').doc(venueId).get();
    const stripeConnectAccountId: string = venueSnap.data()?.stripeConnectAccountId || '';

    // Calculate booking fee (12%, min $1.99, max $100)
    const bookingFeeCents = calculateBookingFee(amountCents);
    const venuePayout = amountCents - bookingFeeCents;

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
      const ttRef = db.collection('events').doc(eventId)
        .collection('ticketTypes').doc(newTicketData.ticketTypeId);
      batch.update(ttRef, {
        sold: admin.firestore.FieldValue.increment(1),
        remaining: admin.firestore.FieldValue.increment(-1),
        updatedAt: now,
      });
    }

    // Initiate Stripe Connect transfer (next-day settlement via Stripe default T+1)
    let stripeTransferId: string | null = null;
    if (stripeConnectAccountId && venuePayout > 0) {
      try {
        const transfer = await stripe.transfers.create({
          amount: venuePayout,
          currency: 'usd',
          destination: stripeConnectAccountId,
          source_transaction: pi.latest_charge as string,
          metadata: {
            type: 'door_sale',
            paymentIntentId,
            eventId,
            venueId,
            ticketId: ticketId || '',
            bookingFeeCents: bookingFeeCents.toString(),
          },
        });
        stripeTransferId = transfer.id;
      } catch (transferErr: any) {
        // Log but don't fail the whole transaction — payment already succeeded
        console.error('Transfer failed:', transferErr.message);
      }
    }

    // Write payment record
    const paymentRef = db.collection('terminalPayments').doc();
    batch.set(paymentRef, {
      paymentIntentId,
      eventId,
      venueId,
      ticketId: ticketId || null,
      amountCents,
      bookingFeeCents,
      venuePayout,
      stripeConnectAccountId: stripeConnectAccountId || null,
      stripeTransferId,
      transferStatus: stripeTransferId ? 'transferred' : (stripeConnectAccountId ? 'transfer_failed' : 'no_connect_account'),
      staffUid: context.auth.uid,
      status: 'succeeded',
      source: 'tap_to_pay',
      // ID scan evidence stored with payment for chargeback disputes
      idVerification: idScanData || null,
      createdAt: now,
    });

    await batch.commit();

    // Send receipt via email or SMS (non-blocking)
    const recipientEmail = newTicketData?.holderEmail;
    const recipientPhone = newTicketData?.holderPhone;
    if (recipientEmail || recipientPhone) {
      try {
        const { sendDoorSaleReceipt } = await import('../email/emailService');
        const venueData2 = (await db.collection('venues').doc(venueId).get()).data();
        const eventData2 = (await db.collection('events').doc(eventId).get()).data();
        if (recipientEmail) {
          await sendDoorSaleReceipt({
            to: recipientEmail,
            holderName: newTicketData?.holderName || '',
            eventTitle: eventData2?.title || '',
            venueName: venueData2?.name || '',
            ticketType: newTicketData?.ticketTypeName || '',
            amountCents,
            paymentIntentId,
            tableAssignment: newTicketData?.tableAssignment,
          });
        }
      } catch (emailErr) {
        admin.firestore().collection('config').doc('admin').set(
          { emailErrors: admin.firestore.FieldValue.increment(1) }, { merge: true }
        );
      }
    }

    // Mark pending auth as captured
    await db.collection('terminalPendingAuths').doc(paymentIntentId).update({
      status: 'captured',
      capturedAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {}); // non-blocking

    return { success: true };
  });


// ── refundDoorSale ────────────────────────────────────────────────────
// Instant refund for door sales where ID verification fails/denied.
// Stripe card_present refunds appear within minutes on most banks.
export const refundDoorSale = functions
  .https.onCall(async (data: {
    paymentIntentId: string;
    reason: string; // 'id_mismatch' | 'venue_denied' | 'other'
    staffNote?: string;
  }, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    const { paymentIntentId, reason, staffNote } = data;

    // Retrieve PI to get the charge ID
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== 'succeeded') {
      throw new functions.https.HttpsError('failed-precondition', 'Payment not succeeded — cannot refund');
    }

    const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
    if (!chargeId) throw new functions.https.HttpsError('not-found', 'No charge found on payment intent');

    // Issue instant refund
    const refund = await stripe.refunds.create({
      charge: chargeId,
      reason: 'fraudulent',
      metadata: {
        refundReason: reason,
        staffUid: context.auth.uid,
        staffNote: staffNote || '',
        source: 'wugi_door_id_verification',
      },
    });

    // Record refund in Firestore
    await db.collection('terminalRefunds').add({
      paymentIntentId,
      chargeId,
      stripeRefundId: refund.id,
      amount: refund.amount,
      reason,
      staffNote: staffNote || null,
      staffUid: context.auth.uid,
      status: refund.status,
      source: 'id_verification_failure',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Also update the terminalPayment doc if it exists
    const paymentSnap = await db.collection('terminalPayments')
      .where('paymentIntentId', '==', paymentIntentId).limit(1).get();
    if (!paymentSnap.empty) {
      await paymentSnap.docs[0].ref.update({
        status: 'refunded',
        refundId: refund.id,
        refundReason: reason,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return { success: true, refundId: refund.id, status: refund.status };
  });


// ── cancelDoorSale ────────────────────────────────────────────────────
// Voids a manual authorization — guest never sees a charge at all.
// Use when ID verification fails and venue does not override.
export const cancelDoorSale = functions
  .https.onCall(async (data: {
    paymentIntentId: string;
    reason: string;
    staffNote?: string;
  }, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    const { paymentIntentId, reason, staffNote } = data;

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

    // Can only cancel if not yet captured
    if (pi.status === 'succeeded') {
      throw new functions.https.HttpsError('failed-precondition',
        'Payment already captured — use refundDoorSale instead');
    }
    if (!['requires_capture', 'requires_payment_method', 'requires_confirmation'].includes(pi.status)) {
      throw new functions.https.HttpsError('failed-precondition',
        `Cannot cancel PI with status: ${pi.status}`);
    }

    // Cancel = void. Authorization drops off customer's account within minutes.
    await stripe.paymentIntents.cancel(paymentIntentId);

    // Record the void
    await db.collection('terminalVoids').add({
      paymentIntentId,
      reason,
      staffNote: staffNote || null,
      staffUid: context.auth.uid,
      source: 'id_verification_failure',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update pending auth record
    await db.collection('terminalPendingAuths').doc(paymentIntentId).update({
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      cancelReason: reason,
    }).catch(() => {});

    return { success: true };
  });

// ── autoSettlePendingDoorSales ────────────────────────────────────────
// Scheduled function — runs daily at 6am ET.
// Captures any door sale authorizations that were not explicitly approved
// or cancelled (e.g., app crash, staff forgot, connectivity issue).
// This is the safety net that guarantees venues always get their money.
export const autoSettlePendingDoorSales = functions.pubsub
  .schedule('0 11 * * *') // 11am UTC = 6am ET
  .timeZone('America/New_York')
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();

    // Find all pending auths past their auto-settle time
    const pendingSnap = await db.collection('terminalPendingAuths')
      .where('status', '==', 'pending')
      .where('autoSettleAt', '<=', now)
      .get();

    if (pendingSnap.empty) {
      functions.logger.info('autoSettle: no pending auths to settle');
      return;
    }

    functions.logger.info(`autoSettle: found ${pendingSnap.size} pending auths to settle`);

    for (const doc of pendingSnap.docs) {
      const auth = doc.data();
      try {
        // Check current PI status
        const pi = await stripe.paymentIntents.retrieve(auth.paymentIntentId);

        if (pi.status === 'succeeded') {
          // Already captured manually — just mark it
          await doc.ref.update({ status: 'captured', capturedAt: now });
          continue;
        }

        if (pi.status === 'canceled') {
          await doc.ref.update({ status: 'cancelled' });
          continue;
        }

        if (pi.status !== 'requires_capture') {
          await doc.ref.update({
            status: 'auto_settle_skipped',
            skipReason: `Unexpected status: ${pi.status}`,
          });
          continue;
        }

        // Capture it
        await stripe.paymentIntents.capture(auth.paymentIntentId);

        // Get venue Connect account for transfer
        const venueSnap = await db.collection('venues').doc(auth.venueId).get();
        const stripeConnectAccountId = venueSnap.data()?.stripeConnectAccountId || '';
        const bookingFeeCents = calculateBookingFee(auth.amountCents);
        const venuePayout = auth.amountCents - bookingFeeCents;

        // Transfer to venue
        let stripeTransferId: string | null = null;
        if (stripeConnectAccountId && venuePayout > 0) {
          const capturedPi = await stripe.paymentIntents.retrieve(auth.paymentIntentId);
          const transfer = await stripe.transfers.create({
            amount: venuePayout,
            currency: 'usd',
            destination: stripeConnectAccountId,
            source_transaction: capturedPi.latest_charge as string,
            metadata: {
              type: 'door_sale_auto_settled',
              paymentIntentId: auth.paymentIntentId,
              venueId: auth.venueId,
              eventId: auth.eventId,
            },
          });
          stripeTransferId = transfer.id;
        }

        // Write payment record
        await db.collection('terminalPayments').add({
          paymentIntentId: auth.paymentIntentId,
          eventId: auth.eventId,
          venueId: auth.venueId,
          ticketId: auth.ticketId || null,
          amountCents: auth.amountCents,
          bookingFeeCents,
          venuePayout,
          stripeConnectAccountId: stripeConnectAccountId || null,
          stripeTransferId,
          staffUid: auth.staffUid,
          status: 'succeeded',
          source: 'tap_to_pay_auto_settled',
          autoSettled: true,
          idVerification: null, // no ID data — auto settled
          createdAt: now,
        });

        await doc.ref.update({
          status: 'captured',
          capturedAt: now,
          autoSettled: true,
          stripeTransferId,
        });

        functions.logger.info(`autoSettle: captured ${auth.paymentIntentId} for venue ${auth.venueId}`);
      } catch (err: any) {
        functions.logger.error(`autoSettle: failed for ${auth.paymentIntentId}:`, err.message);
        await doc.ref.update({
          status: 'auto_settle_failed',
          failureReason: err.message,
        });
      }
    }
  });
