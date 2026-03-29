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
exports.createPaymentIntent = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — createPaymentIntent Cloud Function
// Called by the app before presenting Stripe Payment Sheet.
// Creates a PaymentIntent and returns the client secret.
// Supports both authenticated users and guest checkout.
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
const stripeUtils_1 = require("../stripe/stripeUtils");
const db = admin.firestore();
exports.createPaymentIntent = functions.https.onCall(async (data, context) => {
    const { eventId, ticketTypeId, quantity } = data;
    const userId = context.auth?.uid ?? null;
    const isGuest = !userId;
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
    const ticketType = ticketTypeDoc.data();
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
    const subtotal = ticketType.price * quantity;
    const bookingFee = (0, stripeUtils_1.calculateBookingFee)(subtotal, {
        feePercent: ticketType.bookingFeePercent ?? undefined,
        feeMin: ticketType.bookingFeeMin ?? undefined,
        feeMax: ticketType.bookingFeeMax ?? undefined,
    });
    const total = subtotal + bookingFee; // tax added by Stripe Tax
    // ── Get or create Stripe customer ────────────────────────────────
    let stripeCustomerId;
    if (userId) {
        const userDoc = await db.collection('users').doc(userId).get();
        stripeCustomerId = userDoc.data()?.stripeCustomerId;
        if (!stripeCustomerId) {
            const customer = await stripeUtils_1.stripe.customers.create({
                email: context.auth?.token.email ?? '',
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
    const paymentIntentParams = {
        amount: total,
        currency: 'usd',
        // Stripe Tax automatic calculation
        automatic_tax: { enabled: !ticketType.taxIncluded },
        // Save payment method for authenticated users
        setup_future_usage: userId ? 'off_session' : undefined,
        customer: stripeCustomerId,
        metadata: {
            eventId,
            ticketTypeId,
            ticketTypeName: ticketType.name,
            venueId: ticketType.venueId ?? '',
            quantity: String(quantity),
            subtotal: String(subtotal),
            bookingFee: String(bookingFee),
            taxIncluded: String(ticketType.taxIncluded),
            userId: userId ?? 'guest',
            guestName: data.guestName ?? '',
            guestEmail: data.guestEmail ?? '',
            guestPhone: data.guestPhone ?? '',
            buyerName: userId ? (context.auth?.token.name ?? '') : (data.guestName ?? ''),
            buyerEmail: userId ? (context.auth?.token.email ?? '') : (data.guestEmail ?? ''),
            buyerPhone: data.guestPhone ?? '',
            eventName: event?.name ?? event?.title ?? '',
            venueName: venue?.name ?? '',
            eventDate: event?.date ?? '',
            eventTime: event?.time ?? '',
            items: JSON.stringify([{
                    ticketTypeId,
                    ticketTypeName: ticketType.name,
                    quantity,
                    unitPrice: ticketType.price,
                    subtotal,
                    taxIncluded: ticketType.taxIncluded,
                }]),
        },
    };
    const paymentIntent = await stripeUtils_1.stripe.paymentIntents.create(paymentIntentParams);
    logger.info('PaymentIntent created', {
        paymentIntentId: paymentIntent.id,
        amount: total,
        userId: userId ?? 'guest',
        eventId,
    });
    return {
        clientSecret: paymentIntent.client_secret,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
        customerId: stripeCustomerId ?? null,
        subtotal,
        bookingFee,
        total,
        isGuest,
    };
});
//# sourceMappingURL=createPaymentIntent.js.map