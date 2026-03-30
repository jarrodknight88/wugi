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
exports.createPaymentIntentHttp = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — createPaymentIntentHttp
// HTTP version of createPaymentIntent for direct fetch from mobile app.
// The onCall version requires the Firebase Functions SDK.
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
const stripeUtils_1 = require("../stripe/stripeUtils");
const db = admin.firestore();
exports.createPaymentIntentHttp = functions.https.onRequest(async (req, res) => {
    // Allow CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const body = req.body?.data ?? req.body;
    const { eventId, ticketTypeId, quantity, userId, guestName, guestEmail, guestPhone } = body;
    if (!eventId || !ticketTypeId || !quantity) {
        res.status(400).json({ error: { message: 'Missing required fields' } });
        return;
    }
    if (!userId && (!guestEmail || !guestName)) {
        res.status(400).json({ error: { message: 'Guest checkout requires name and email' } });
        return;
    }
    try {
        const ticketTypeDoc = await db
            .collection('events').doc(eventId)
            .collection('ticketTypes').doc(ticketTypeId).get();
        if (!ticketTypeDoc.exists) {
            res.status(404).json({ error: { message: 'Ticket type not found' } });
            return;
        }
        const ticketType = ticketTypeDoc.data();
        if (ticketType.status !== 'on_sale') {
            res.status(400).json({ error: { message: 'Ticket not on sale' } });
            return;
        }
        if (ticketType.remaining < quantity) {
            res.status(400).json({ error: { message: 'Not enough tickets' } });
            return;
        }
        const [eventDoc, venueDoc] = await Promise.all([
            db.collection('events').doc(eventId).get(),
            ticketType.venueId ? db.collection('venues').doc(ticketType.venueId).get() : null,
        ]);
        const event = eventDoc.data();
        const venue = venueDoc?.data();
        const subtotal = ticketType.price * quantity;
        const bookingFee = (0, stripeUtils_1.calculateBookingFee)(subtotal);
        const total = subtotal + bookingFee;
        // Get or create Stripe customer for authenticated users
        let stripeCustomerId;
        let ephemeralKey;
        if (userId) {
            const userDoc = await db.collection('users').doc(userId).get();
            stripeCustomerId = userDoc.data()?.stripeCustomerId;
            if (!stripeCustomerId) {
                const customer = await stripeUtils_1.stripe.customers.create({ metadata: { firebaseUID: userId } });
                stripeCustomerId = customer.id;
                await db.collection('users').doc(userId).update({ stripeCustomerId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            }
            // Create ephemeral key so Payment Sheet can show saved cards
            const ek = await stripeUtils_1.stripe.ephemeralKeys.create({ customer: stripeCustomerId }, { apiVersion: '2023-10-16' });
            ephemeralKey = ek.secret;
        }
        const paymentIntent = await stripeUtils_1.stripe.paymentIntents.create({
            amount: total,
            currency: 'usd',
            setup_future_usage: userId ? 'off_session' : undefined,
            customer: stripeCustomerId,
            metadata: {
                eventId, ticketTypeId, quantity: String(quantity),
                ticketTypeName: ticketType.name,
                venueId: ticketType.venueId ?? '',
                subtotal: String(subtotal),
                bookingFee: String(bookingFee),
                taxIncluded: String(ticketType.taxIncluded),
                userId: userId ?? 'guest',
                guestName: guestName ?? '',
                guestEmail: guestEmail ?? '',
                guestPhone: guestPhone ?? '',
                buyerName: userId ? '' : (guestName ?? ''),
                buyerEmail: userId ? '' : (guestEmail ?? ''),
                buyerPhone: guestPhone ?? '',
                eventName: event?.name ?? event?.title ?? '',
                venueName: venue?.name ?? '',
                eventDate: event?.date ?? '',
                eventTime: event?.time ?? '',
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
                clientSecret: paymentIntent.client_secret,
                publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
                customerId: stripeCustomerId ?? null,
                customerEphemeralKey: ephemeralKey ?? null,
                subtotal, bookingFee, total,
                isGuest: !userId,
            },
        });
    }
    catch (e) {
        logger.error('createPaymentIntentHttp error', e);
        res.status(500).json({ error: { message: e.message ?? 'Internal error' } });
    }
});
//# sourceMappingURL=createPaymentIntentHttp.js.map