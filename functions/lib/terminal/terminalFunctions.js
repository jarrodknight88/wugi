"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoSettlePendingDoorSales = exports.cancelDoorSale = exports.refundDoorSale = exports.captureTerminalPayment = exports.createTerminalPaymentIntent = exports.createTerminalConnectionToken = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — Stripe Terminal: Connection Token + PaymentIntent
// Used exclusively by Wugi Door for Tap to Pay
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const stripeUtils_1 = require("../stripe/stripeUtils");
const db = admin.firestore();
// ── createTerminalConnectionToken ─────────────────────────────────────
// Called by Wugi Door on launch. Auto-creates a Stripe Terminal Location
// for the venue if one doesn't exist, then returns a connection token.
exports.createTerminalConnectionToken = functions
    .https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    const { venueId } = data;
    if (!venueId)
        throw new functions.https.HttpsError('invalid-argument', 'venueId required');
    const venueSnap = await db.collection('venues').doc(venueId).get();
    if (!venueSnap.exists)
        throw new functions.https.HttpsError('not-found', 'Venue not found');
    const venue = venueSnap.data();
    let stripeLocationId = venue.stripeTerminalLocationId;
    if (!stripeLocationId) {
        const location = await stripeUtils_1.stripe.terminal.locations.create({
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
    const connectionToken = await stripeUtils_1.stripe.terminal.connectionTokens.create({
        location: stripeLocationId,
    });
    functions.logger.info('Connection token created', {
        livemode: connectionToken.livemode,
        stripeKey: process.env.STRIPE_SECRET_KEY?.slice(0, 12),
    });
    return { secret: connectionToken.secret, locationId: stripeLocationId };
});
// ── createTerminalPaymentIntent ───────────────────────────────────────
// Creates a PaymentIntent for Tap to Pay. Supports:
//  - Collecting a ticket's balance due
//  - Charging a walk-up door fee (new ticket)
exports.createTerminalPaymentIntent = functions
    .https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    const { amountCents, venueId, eventId, ticketId, description, statementDescriptor, customerName, customerEmail } = data;
    if (!amountCents || amountCents < 50)
        throw new functions.https.HttpsError('invalid-argument', 'Minimum charge is $0.50');
    // Fetch venue for custom descriptor
    const venueSnap = await db.collection('venues').doc(venueId).get();
    // Use venue's custom payment descriptor if set (for discretion)
    const venueDescriptor = venueSnap.exists
        ? venueSnap.data()?.paymentDescriptor || statementDescriptor || ''
        : statementDescriptor || '';
    const cleanDescriptor = venueDescriptor.slice(0, 22).replace(/[^a-zA-Z0-9 ]/g, '').trim();
    const paymentIntent = await stripeUtils_1.stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'usd',
        payment_method_types: ['card_present'],
        capture_method: 'manual', // Manual — authorize now, capture after ID verification
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
            if (settle <= now)
                settle.setDate(settle.getDate() + 1);
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
exports.captureTerminalPayment = functions
    .https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    const { paymentIntentId, ticketId, eventId, venueId, amountCents, newTicketData, idScanData } = data;
    // Retrieve PI — for manual capture it should be 'requires_capture'
    const pi = await stripeUtils_1.stripe.paymentIntents.retrieve(paymentIntentId);
    const isAlreadyCaptured = pi.status === 'succeeded';
    const canCapture = pi.status === 'requires_capture' || isAlreadyCaptured;
    if (!canCapture) {
        throw new functions.https.HttpsError('failed-precondition', `Payment cannot be captured: ${pi.status}`);
    }
    // Capture the payment (if not already captured by auto-settler)
    if (pi.status === 'requires_capture') {
        await stripeUtils_1.stripe.paymentIntents.capture(paymentIntentId);
    }
    // Look up venue for Stripe Connect account ID
    const venueSnap = await db.collection('venues').doc(venueId).get();
    const stripeConnectAccountId = venueSnap.data()?.stripeConnectAccountId || '';
    // Calculate booking fee (12%, min $1.99, max $100)
    const bookingFeeCents = (0, stripeUtils_1.calculateBookingFee)(amountCents);
    const venuePayout = amountCents - bookingFeeCents;
    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    if (ticketId) {
        // Existing ticket — clear balance due only (check-in happens on demand from the app)
        const ticketRef = db.collection('events').doc(eventId).collection('tickets').doc(ticketId);
        batch.update(ticketRef, {
            balanceDue: 0,
            depositPaid: amountCents,
            updatedAt: now,
        });
        // Note: check-in is handled by the app after staff confirms guest is present
    }
    else if (newTicketData) {
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
    // Retrieve charge to get card details (last4, cardholder name)
    const capturedPi = await stripeUtils_1.stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge'],
    });
    const charge = capturedPi.latest_charge;
    const cardLast4 = charge?.payment_method_details?.card_present?.last4 || null;
    const cardBrand = charge?.payment_method_details?.card_present?.brand || null;
    const cardholderName = charge?.payment_method_details?.card_present?.cardholder_name || null;
    const chargeId = charge?.id || null;
    // Initiate Stripe Connect transfer (next-day settlement via Stripe default T+1)
    let stripeTransferId = null;
    if (stripeConnectAccountId && venuePayout > 0) {
        try {
            const transfer = await stripeUtils_1.stripe.transfers.create({
                amount: venuePayout,
                currency: 'usd',
                destination: stripeConnectAccountId,
                source_transaction: chargeId || pi.latest_charge,
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
        }
        catch (transferErr) {
            // Log but don't fail the whole transaction — payment already succeeded
            console.error('Transfer failed:', transferErr.message);
        }
    }
    // For balance payments, look up ticket to get holder info
    let holderName = null;
    let ticketTypeName = null;
    if (ticketId) {
        try {
            const ticketSnap = await db.collection('events').doc(eventId)
                .collection('tickets').doc(ticketId).get();
            if (ticketSnap.exists) {
                holderName = ticketSnap.data()?.holderName || null;
                ticketTypeName = ticketSnap.data()?.ticketTypeName || null;
            }
        }
        catch (e) { }
    }
    else if (newTicketData) {
        holderName = newTicketData.holderName || null;
        ticketTypeName = newTicketData.ticketTypeName || null;
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
        holderName,
        ticketTypeName,
        stripeConnectAccountId: stripeConnectAccountId || null,
        stripeTransferId,
        transferStatus: stripeTransferId ? 'transferred' : (stripeConnectAccountId ? 'transfer_failed' : 'no_connect_account'),
        staffUid: context.auth.uid,
        status: 'succeeded',
        source: ticketId ? 'balance_payment' : 'tap_to_pay',
        cardLast4,
        cardBrand,
        cardholderName,
        chargeId,
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
            const { sendDoorSaleReceipt } = await Promise.resolve().then(() => __importStar(require('../email/emailService')));
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
        }
        catch (emailErr) {
            admin.firestore().collection('config').doc('admin').set({ emailErrors: admin.firestore.FieldValue.increment(1) }, { merge: true });
        }
    }
    // Mark pending auth as captured
    await db.collection('terminalPendingAuths').doc(paymentIntentId).update({
        status: 'captured',
        capturedAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => { }); // non-blocking
    // Return table info so app can show remaining guests notice
    let tableAssignment = null;
    let tableGuestCount = 0;
    if (ticketId) {
        try {
            const paidTicket = await db.collection('events').doc(eventId)
                .collection('tickets').doc(ticketId).get();
            tableAssignment = paidTicket.data()?.tableAssignment || null;
            if (tableAssignment) {
                const tableSnap = await db.collection('events').doc(eventId)
                    .collection('tickets')
                    .where('tableAssignment', '==', tableAssignment)
                    .get();
                tableGuestCount = tableSnap.size - 1; // exclude the payer
            }
        }
        catch (e) { }
    }
    return { success: true, checkedIn: !!ticketId, tableAssignment, tableGuestCount };
});
// ── refundDoorSale ────────────────────────────────────────────────────
// Instant refund for door sales where ID verification fails/denied.
// Stripe card_present refunds appear within minutes on most banks.
exports.refundDoorSale = functions
    .https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    const { paymentIntentId, reason, staffNote } = data;
    // First check our Firestore record for the chargeId (faster and works if PI was test mode)
    const refundPaymentSnap = await db.collection('terminalPayments')
        .where('paymentIntentId', '==', paymentIntentId).limit(1).get();
    let chargeId = null;
    if (!refundPaymentSnap.empty) {
        const paymentData = refundPaymentSnap.docs[0].data();
        chargeId = paymentData.chargeId || null;
    }
    // Fall back to retrieving from Stripe if not in Firestore
    if (!chargeId) {
        try {
            const pi = await stripeUtils_1.stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
            if (pi.status !== 'succeeded') {
                throw new functions.https.HttpsError('failed-precondition', 'Payment not succeeded — cannot refund');
            }
            const charge = pi.latest_charge;
            chargeId = typeof charge === 'string' ? charge : charge?.id;
        }
        catch (stripeErr) {
            throw new functions.https.HttpsError('not-found', `Cannot find payment to refund. The transaction may have been created in test mode. Error: ${stripeErr.message}`);
        }
    }
    if (!chargeId)
        throw new functions.https.HttpsError('not-found', 'No charge ID found for this payment');
    // Issue instant refund
    const refund = await stripeUtils_1.stripe.refunds.create({
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
    const updatePaymentSnap = await db.collection('terminalPayments')
        .where('paymentIntentId', '==', paymentIntentId).limit(1).get();
    if (!updatePaymentSnap.empty) {
        await updatePaymentSnap.docs[0].ref.update({
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
exports.cancelDoorSale = functions
    .https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    const { paymentIntentId, reason, staffNote } = data;
    const pi = await stripeUtils_1.stripe.paymentIntents.retrieve(paymentIntentId);
    // Can only cancel if not yet captured
    if (pi.status === 'succeeded') {
        throw new functions.https.HttpsError('failed-precondition', 'Payment already captured — use refundDoorSale instead');
    }
    if (!['requires_capture', 'requires_payment_method', 'requires_confirmation'].includes(pi.status)) {
        throw new functions.https.HttpsError('failed-precondition', `Cannot cancel PI with status: ${pi.status}`);
    }
    // Cancel = void. Authorization drops off customer's account within minutes.
    await stripeUtils_1.stripe.paymentIntents.cancel(paymentIntentId);
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
    }).catch(() => { });
    return { success: true };
});
// ── autoSettlePendingDoorSales ────────────────────────────────────────
// Scheduled function — runs daily at 6am ET.
// Captures any door sale authorizations that were not explicitly approved
// or cancelled (e.g., app crash, staff forgot, connectivity issue).
// This is the safety net that guarantees venues always get their money.
exports.autoSettlePendingDoorSales = functions.pubsub
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
            const pi = await stripeUtils_1.stripe.paymentIntents.retrieve(auth.paymentIntentId);
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
            await stripeUtils_1.stripe.paymentIntents.capture(auth.paymentIntentId);
            // Get venue Connect account for transfer
            const venueSnap = await db.collection('venues').doc(auth.venueId).get();
            const stripeConnectAccountId = venueSnap.data()?.stripeConnectAccountId || '';
            const bookingFeeCents = (0, stripeUtils_1.calculateBookingFee)(auth.amountCents);
            const venuePayout = auth.amountCents - bookingFeeCents;
            // Transfer to venue
            let stripeTransferId = null;
            if (stripeConnectAccountId && venuePayout > 0) {
                const capturedPi = await stripeUtils_1.stripe.paymentIntents.retrieve(auth.paymentIntentId);
                const transfer = await stripeUtils_1.stripe.transfers.create({
                    amount: venuePayout,
                    currency: 'usd',
                    destination: stripeConnectAccountId,
                    source_transaction: capturedPi.latest_charge,
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
        }
        catch (err) {
            functions.logger.error(`autoSettle: failed for ${auth.paymentIntentId}:`, err.message);
            await doc.ref.update({
                status: 'auto_settle_failed',
                failureReason: err.message,
            });
        }
    }
});
//# sourceMappingURL=terminalFunctions.js.map