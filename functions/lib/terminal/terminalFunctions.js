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
exports.captureTerminalPayment = exports.createTerminalPaymentIntent = exports.createTerminalConnectionToken = void 0;
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
    const { amountCents, venueId, eventId, ticketId, description, customerName, customerEmail } = data;
    if (!amountCents || amountCents < 50)
        throw new functions.https.HttpsError('invalid-argument', 'Minimum charge is $0.50');
    const paymentIntent = await stripeUtils_1.stripe.paymentIntents.create({
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
    });
    return {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
    };
});
// ── captureTerminalPayment ────────────────────────────────────────────
// Called after the Terminal SDK confirms the payment.
// Updates Firestore: clears balanceDue, writes payment record.
exports.captureTerminalPayment = functions
    .https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    const { paymentIntentId, ticketId, eventId, amountCents, newTicketData } = data;
    // Retrieve PI to confirm it was captured
    const pi = await stripeUtils_1.stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== 'succeeded') {
        throw new functions.https.HttpsError('failed-precondition', `Payment not succeeded: ${pi.status}`);
    }
    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    if (ticketId) {
        // Existing ticket — clear balance due
        const ticketRef = db.collection('events').doc(eventId).collection('tickets').doc(ticketId);
        batch.update(ticketRef, { balanceDue: 0, depositPaid: amountCents, updatedAt: now });
    }
    else if (newTicketData) {
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
//# sourceMappingURL=terminalFunctions.js.map