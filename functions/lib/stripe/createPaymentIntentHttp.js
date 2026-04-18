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
    const { eventId, ticketTypeId, quantity, userId, guestName, guestEmail, guestPhone, paymentMethodId, savePaymentMethod } = body;
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
        // ── Free ticket bypass — skip Stripe, create pass directly ──────────
        if (total === 0 || ticketType.isFree) {
            logger.info('Free ticket — skipping Stripe, creating pass directly', { eventId, ticketTypeId });
            const { generateTicketNumber } = await Promise.resolve().then(() => __importStar(require('../stripe/stripeUtils')));
            const passRef = db.collection('passes').doc();
            const orderId = `free_${passRef.id}`;
            await passRef.set({
                id: passRef.id,
                orderId,
                userId: userId || null,
                eventId,
                venueId: ticketType.venueId ?? '',
                ticketTypeId,
                ticketTypeName: ticketType.name,
                holderName: userId ? '' : (guestName ?? ''),
                holderEmail: userId ? '' : (guestEmail ?? ''),
                // Denormalize event + venue so PassViewerScreen can render without extra lookups
                eventTitle: event?.title || '',
                venueName: venue?.name || '',
                eventDate: event?.date || '',
                eventTime: event?.time || '',
                ticketNumber: generateTicketNumber(),
                isTransferred: false,
                transferPending: false,
                scanStatus: 'valid',
                source: 'free',
                isFree: true,
                scannedAt: null,
                scannedBy: null,
                appleWalletPassUrl: null,
                appleWalletAdded: false,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            // ── Generate Apple Wallet pass for free ticket ─────────────────
            let freePassUrl = null;
            try {
                const { buildPassBuffer, storePass } = await Promise.resolve().then(() => __importStar(require('../passes/generatePass')));
                const crypto = await Promise.resolve().then(() => __importStar(require('crypto')));
                const authToken = crypto.randomBytes(20).toString('hex');
                const eventDoc = await db.collection('events').doc(eventId).get();
                const venueDoc2 = ticketType.venueId
                    ? await db.collection('venues').doc(ticketType.venueId).get()
                    : null;
                const passBuffer = await buildPassBuffer({
                    orderId,
                    eventTitle: eventDoc.data()?.title || '',
                    venueName: venueDoc2?.data()?.name || '',
                    eventDate: eventDoc.data()?.date || '',
                    eventTime: eventDoc.data()?.time || '',
                    ticketType: ticketType.name,
                    quantity: quantity,
                    buyerName: userId ? '' : (guestName ?? ''),
                    buyerEmail: userId ? '' : (guestEmail ?? ''),
                    totalPaid: 0,
                    webServiceURL: 'https://us-central1-wugi-prod.cloudfunctions.net/passWebService',
                    authenticationToken: authToken,
                });
                freePassUrl = await storePass(orderId, passBuffer);
                await db.collection('walletPasses').doc(orderId).set({
                    orderId, authenticationToken: authToken,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                });
                await passRef.update({ appleWalletPassUrl: freePassUrl, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                logger.info('Free pass Apple Wallet generated:', freePassUrl);
            }
            catch (passErr) {
                logger.error('Free pass Apple Wallet generation failed:', passErr);
            }
            // Decrement remaining count — guard against going below 0
            const currentDoc = await db.collection('events').doc(eventId)
                .collection('ticketTypes').doc(ticketTypeId).get();
            const currentRemaining = currentDoc.data()?.remaining ?? 0;
            if (currentRemaining <= 0) {
                res.status(400).json({ error: { message: 'No tickets remaining' } });
                return;
            }
            await db.collection('events').doc(eventId)
                .collection('ticketTypes').doc(ticketTypeId)
                .update({
                sold: admin.firestore.FieldValue.increment(quantity),
                remaining: admin.firestore.FieldValue.increment(-quantity),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            res.json({
                result: {
                    clientSecret: null,
                    publishableKey: null,
                    customerId: null,
                    customerEphemeralKey: null,
                    subtotal: 0,
                    bookingFee: 0,
                    total: 0,
                    isGuest: !userId,
                    isFree: true,
                    orderId,
                    passUrl: freePassUrl,
                },
            });
            return;
        }
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
            const ek = await stripeUtils_1.stripe.ephemeralKeys.create({ customer: stripeCustomerId }, { apiVersion: '2023-10-16' });
            ephemeralKey = ek.secret;
        }
        // ── setupOnly removed — PI always created here now ────────────────
        const paymentIntent = await stripeUtils_1.stripe.paymentIntents.create({
            amount: total,
            currency: 'usd',
            // If paymentMethodId provided (intentConfiguration flow), attach it directly
            payment_method: paymentMethodId || undefined,
            confirm: paymentMethodId ? true : undefined,
            setup_future_usage: (userId && (savePaymentMethod || !paymentMethodId)) ? 'on_session' : undefined,
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