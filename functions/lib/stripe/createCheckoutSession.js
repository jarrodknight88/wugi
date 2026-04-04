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
exports.createCheckoutSession = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — createCheckoutSession
// Creates a Stripe Checkout session for web ticket purchases.
// Called from wugi.us web app via fetch.
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const stripeUtils_1 = require("./stripeUtils");
const db = admin.firestore();
exports.createCheckoutSession = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const { eventId, ticketTypeId, quantity, successUrl, cancelUrl } = req.body;
    if (!eventId || !ticketTypeId || !quantity || !successUrl || !cancelUrl) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
    }
    try {
        const ticketSnap = await db
            .collection('events').doc(eventId)
            .collection('ticketTypes').doc(ticketTypeId).get();
        if (!ticketSnap.exists) {
            res.status(404).json({ error: 'Ticket type not found' });
            return;
        }
        const ticket = ticketSnap.data();
        const eventSnap = await db.collection('events').doc(eventId).get();
        const event = eventSnap.data();
        const subtotal = ticket.price * quantity;
        const fee = Math.min(Math.max(Math.round(subtotal * 0.12), 199), 10000);
        const total = subtotal + fee;
        const session = await stripeUtils_1.stripe.checkout.sessions.create({
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
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        functions.logger.error('createCheckoutSession error:', e);
        res.status(500).json({ error: msg });
    }
});
//# sourceMappingURL=createCheckoutSession.js.map