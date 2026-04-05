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
exports.stripeWebhook = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — Stripe Webhook Handler
//
// Handles all Stripe events:
//   payment_intent.succeeded      → create order + passes
//   payment_intent.payment_failed → update order status
//   charge.dispute.created        → create chargeback doc
//   charge.dispute.updated        → update chargeback status
//   charge.dispute.closed         → resolve chargeback, bill venue
//   transfer.created              → update payout status
//   transfer.failed               → alert admin, retry logic
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
const stripeUtils_1 = require("./stripeUtils");
const emailService_1 = require("../email/emailService");
const db = admin.firestore();
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
    // ── Verify webhook signature ────────────────────────────────────────
    const sig = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;
    try {
        event = stripeUtils_1.stripe.webhooks.constructEvent(req.rawBody, sig, secret);
    }
    catch (err) {
        logger.error('Webhook signature verification failed', err.message);
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }
    logger.info(`Stripe event received: ${event.type}`, { id: event.id });
    try {
        switch (event.type) {
            case 'payment_intent.succeeded':
                await handlePaymentSuccess(event.data.object);
                break;
            case 'payment_intent.payment_failed':
                await handlePaymentFailed(event.data.object);
                break;
            case 'charge.dispute.created':
                await handleDisputeCreated(event.data.object);
                break;
            case 'charge.dispute.updated':
                await handleDisputeUpdated(event.data.object);
                break;
            case 'charge.dispute.closed':
                await handleDisputeClosed(event.data.object);
                break;
            case 'transfer.created':
                await handleTransferCreated(event.data.object);
                break;
            case 'transfer.reversed':
                await handleTransferFailed(event.data.object);
                break;
            default:
                logger.info(`Unhandled event type: ${event.type}`);
        }
        res.json({ received: true });
    }
    catch (err) {
        logger.error(`Error handling ${event.type}`, err);
        res.status(500).send(`Handler Error: ${err.message}`);
    }
});
// ── Payment succeeded → create order + passes ─────────────────────────
async function handlePaymentSuccess(paymentIntent) {
    const meta = paymentIntent.metadata;
    // Prevent duplicate processing
    const existingOrder = await db
        .collection('orders')
        .where('stripePaymentIntentId', '==', paymentIntent.id)
        .limit(1)
        .get();
    if (!existingOrder.empty) {
        logger.info(`Order already exists for PI ${paymentIntent.id} — skipping`);
        return;
    }
    // Parse metadata from payment intent
    const userId = meta.userId;
    const eventId = meta.eventId;
    const venueId = meta.venueId;
    const itemsJson = meta.items; // JSON string of cart items
    if (!userId || !eventId || !venueId || !itemsJson) {
        logger.error('Missing required metadata on payment intent', meta);
        return;
    }
    const items = JSON.parse(itemsJson);
    // Fetch venue for payout config
    const venueDoc = await db.collection('venues').doc(venueId).get();
    const venueData = venueDoc.data();
    if (!venueData)
        throw new Error(`Venue ${venueId} not found`);
    // Calculate financials
    const subtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
    const bookingFee = paymentIntent.metadata.bookingFee
        ? parseInt(paymentIntent.metadata.bookingFee)
        : 0;
    const taxAmount = paymentIntent.metadata.taxAmount
        ? parseInt(paymentIntent.metadata.taxAmount)
        : 0;
    const taxBreakdown = paymentIntent.metadata.taxBreakdown
        ? JSON.parse(paymentIntent.metadata.taxBreakdown)
        : [];
    const total = paymentIntent.amount;
    // Reserve amount
    const reservePercent = venueData.reservePercent ?? 0.05;
    const reserveAmount = (0, stripeUtils_1.calculateReserve)(subtotal, reservePercent);
    // Payout release time (48–72h after event)
    const reserveHoldHours = venueData.reserveHoldHours ?? 60;
    const eventDoc = await db.collection('events').doc(eventId).get();
    const eventData = eventDoc.data();
    const eventEndsAt = eventData?.endsAt?.toDate() ?? new Date();
    const payoutReleaseAt = new Date(eventEndsAt.getTime() + reserveHoldHours * 60 * 60 * 1000);
    // Payout scheduled time based on venue tier
    const payoutTier = venueData.payoutTier ?? 1;
    const payoutDelayHours = venueData.payoutDelayHours ?? 168;
    const payoutScheduledFor = payoutTier === 5
        ? getNextDailyBatchTime()
        : new Date(eventEndsAt.getTime() + payoutDelayHours * 60 * 60 * 1000);
    // Payment method details
    const charge = paymentIntent.latest_charge;
    const paymentMethod = getPaymentMethodType(charge);
    const last4 = charge?.payment_method_details?.card?.last4 ?? null;
    // ── Create order doc ────────────────────────────────────────────────
    const orderRef = db.collection('orders').doc();
    const orderId = orderRef.id;
    const orderData = {
        id: orderId,
        userId,
        eventId,
        venueId,
        items,
        subtotal,
        bookingFee,
        taxAmount,
        taxBreakdown,
        total,
        stripePaymentIntentId: paymentIntent.id,
        stripeCustomerId: paymentIntent.customer,
        paymentMethod,
        paymentMethodLast4: last4,
        status: 'confirmed',
        payoutStatus: 'reserved',
        payoutReserveAmount: reserveAmount,
        payoutReleaseAt: admin.firestore.Timestamp.fromDate(payoutReleaseAt),
        payoutId: null,
        buyerName: meta.buyerName ?? '',
        buyerEmail: meta.buyerEmail ?? '',
        buyerPhone: meta.buyerPhone ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // ── Create pass docs (one per ticket) ──────────────────────────────
    const passBatch = db.batch();
    const passIds = [];
    for (const item of items) {
        for (let i = 0; i < item.quantity; i++) {
            const passRef = db.collection('passes').doc();
            passIds.push(passRef.id);
            passBatch.set(passRef, {
                id: passRef.id,
                orderId,
                userId,
                eventId,
                venueId,
                ticketTypeId: item.ticketTypeId,
                ticketTypeName: item.ticketTypeName,
                holderName: meta.buyerName ?? '',
                holderEmail: meta.buyerEmail ?? '',
                ticketNumber: (0, stripeUtils_1.generateTicketNumber)(),
                transferredFrom: null,
                transferredAt: null,
                isTransferred: false,
                scanStatus: 'valid',
                scannedAt: null,
                scannedBy: null,
                scannedByDevice: null,
                appleWalletPassUrl: null,
                appleWalletAdded: false,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
    }
    // ── Create payout doc ───────────────────────────────────────────────
    const payoutRef = db.collection('payouts').doc();
    const netAmount = subtotal - reserveAmount; // booking fee stays with Wugi
    const payoutData = {
        id: payoutRef.id,
        venueId,
        stripeConnectAccountId: venueData.stripeConnectAccountId ?? '',
        orderIds: [orderId],
        eventIds: [eventId],
        grossAmount: subtotal,
        bookingFeesCollected: bookingFee,
        taxCollected: taxAmount,
        reserveHeld: reserveAmount,
        netAmount,
        payoutTier,
        payoutSchedule: venueData.payoutSchedule ?? 'post_event',
        isPreEvent: venueData.payoutPreEvent ?? false,
        stripeTransferId: null,
        stripeTransferStatus: 'pending',
        reserveReleaseAt: admin.firestore.Timestamp.fromDate(payoutReleaseAt),
        reserveReleased: false,
        reserveReleasedAt: null,
        reserveStripeTransferId: null,
        status: 'scheduled',
        failureReason: null,
        scheduledFor: admin.firestore.Timestamp.fromDate(payoutScheduledFor),
        paidAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // ── Write everything atomically ────────────────────────────────────
    const writeBatch = db.batch();
    writeBatch.set(orderRef, orderData);
    writeBatch.set(payoutRef, payoutData);
    // Link payout ID back to order
    writeBatch.update(orderRef, { payoutId: payoutRef.id });
    // Update ticket type sold count
    for (const item of items) {
        const ticketTypeRef = db
            .collection('events')
            .doc(eventId)
            .collection('ticketTypes')
            .doc(item.ticketTypeId);
        writeBatch.update(ticketTypeRef, {
            sold: admin.firestore.FieldValue.increment(item.quantity),
            remaining: admin.firestore.FieldValue.increment(-item.quantity),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    await writeBatch.commit();
    await passBatch.commit();
    logger.info(`Order ${orderId} created with ${passIds.length} passes`);
    // ── Generate Apple Wallet pass ──────────────────────────────────────
    let passUrl = null;
    try {
        const { buildPassBuffer, storePass } = await Promise.resolve().then(() => __importStar(require('../passes/generatePass')));
        const crypto = await Promise.resolve().then(() => __importStar(require('crypto')));
        const authToken = crypto.randomBytes(20).toString('hex');
        const firstItem = items[0];
        const passBuffer = await buildPassBuffer({
            orderId,
            eventTitle: eventData?.title || '',
            venueName: venueData.name || '',
            eventDate: eventData?.date || '',
            eventTime: eventData?.time || '',
            ticketType: firstItem?.ticketTypeName || '',
            quantity: items.reduce((s, i) => s + i.quantity, 0),
            buyerName: meta.buyerName || '',
            buyerEmail: meta.buyerEmail || '',
            totalPaid: total,
            webServiceURL: 'https://us-central1-wugi-prod.cloudfunctions.net/passWebService',
            authenticationToken: authToken,
        });
        passUrl = await storePass(orderId, passBuffer);
        await db.collection('walletPasses').doc(orderId).set({
            orderId, authenticationToken: authToken,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
        await orderRef.update({ passUrl, authenticationToken: authToken });
        logger.info('Pass generated for order:', orderId);
    }
    catch (passErr) {
        logger.error('Pass generation failed:', passErr);
    }
    // ── Send purchase confirmation email ────────────────────────────────
    const buyerEmail = meta.buyerEmail;
    if (buyerEmail) {
        try {
            const firstItem = items[0];
            await (0, emailService_1.sendPurchaseConfirmation)({
                to: buyerEmail,
                buyerName: meta.buyerName || buyerEmail,
                eventTitle: eventData?.title || '',
                venueName: venueData.name || '',
                eventDate: eventData?.date || '',
                eventTime: eventData?.time || '',
                ticketType: firstItem?.ticketTypeName || '',
                quantity: items.reduce((s, i) => s + i.quantity, 0),
                totalPaid: total,
                orderId,
                passUrl,
            });
        }
        catch (emailErr) {
            logger.error('Purchase email failed:', emailErr);
        }
    }
}
// ── Payment failed ────────────────────────────────────────────────────
async function handlePaymentFailed(paymentIntent) {
    const existingOrder = await db
        .collection('orders')
        .where('stripePaymentIntentId', '==', paymentIntent.id)
        .limit(1)
        .get();
    if (!existingOrder.empty) {
        await existingOrder.docs[0].ref.update({
            status: 'cancelled',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info(`Order ${existingOrder.docs[0].id} marked cancelled`);
    }
}
// ── Dispute created → create chargeback doc ───────────────────────────
async function handleDisputeCreated(dispute) {
    const chargeId = typeof dispute.charge === 'string'
        ? dispute.charge
        : dispute.charge.id;
    // Find the order by payment intent
    const charge = await stripeUtils_1.stripe.charges.retrieve(chargeId);
    const piId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;
    if (!piId) {
        logger.error(`No payment intent on charge ${chargeId}`);
        return;
    }
    const orderSnap = await db
        .collection('orders')
        .where('stripePaymentIntentId', '==', piId)
        .limit(1)
        .get();
    if (orderSnap.empty) {
        logger.error(`No order found for payment intent ${piId}`);
        return;
    }
    const orderDoc = orderSnap.docs[0];
    const orderData = orderDoc.data();
    const orderId = orderDoc.id;
    // Find associated passes for scan evidence
    const passesSnap = await db
        .collection('passes')
        .where('orderId', '==', orderId)
        .get();
    const scanEvidenceAttached = passesSnap.docs.some(p => p.data().scanStatus === 'scanned');
    // Evidence deadline: Stripe gives 7–21 days
    const dueby = dispute.evidence_details?.due_by ?? Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const evidenceDeadline = new Date(dueby * 1000);
    // Create chargeback doc
    await db.collection('chargebacks').add({
        venueId: orderData.venueId,
        orderId,
        passId: passesSnap.docs[0]?.id ?? null,
        stripeDisputeId: dispute.id,
        stripeChargeId: chargeId,
        disputedAmount: dispute.amount,
        disputeFee: 1500, // $15.00
        totalVenueOwes: 0, // calculated on resolution
        scanEvidenceAttached,
        evidenceSubmittedAt: null,
        evidenceDeadline: admin.firestore.Timestamp.fromDate(evidenceDeadline),
        status: 'open',
        outcome: 'pending',
        resolvedAt: null,
        venueBalanceDebited: false,
        venueBilledDirectly: false,
        venuePaid: false,
        venuePaidAt: null,
        suspensionTriggered: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Update order status
    await orderDoc.ref.update({
        status: 'disputed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Increment venue chargeback count and rate
    await db.collection('venues').doc(orderData.venueId).update({
        chargebackCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info(`Chargeback created for order ${orderId}`, {
        disputeId: dispute.id,
        amount: dispute.amount,
        scanEvidenceAttached,
    });
}
// ── Dispute updated ───────────────────────────────────────────────────
async function handleDisputeUpdated(dispute) {
    const chargebackSnap = await db
        .collection('chargebacks')
        .where('stripeDisputeId', '==', dispute.id)
        .limit(1)
        .get();
    if (chargebackSnap.empty)
        return;
    await chargebackSnap.docs[0].ref.update({
        status: 'submitted',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}
// ── Dispute closed → resolve, bill venue ─────────────────────────────
async function handleDisputeClosed(dispute) {
    const chargebackSnap = await db
        .collection('chargebacks')
        .where('stripeDisputeId', '==', dispute.id)
        .limit(1)
        .get();
    if (chargebackSnap.empty)
        return;
    const chargebackRef = chargebackSnap.docs[0].ref;
    const chargebackData = chargebackSnap.docs[0].data();
    const won = dispute.status === 'won';
    const outcome = won ? 'won' : 'lost';
    // Amount venue owes:
    // Win → just the $15 fee
    // Lose → full disputed amount + $15 fee
    const totalVenueOwes = won
        ? 1500
        : chargebackData.disputedAmount + 1500;
    // Try to debit from reserve first
    const venueDoc = await db.collection('venues').doc(chargebackData.venueId).get();
    const venueData = venueDoc.data();
    const reserve = venueData?.reserveBalance ?? 0;
    const venueBalanceDebited = reserve >= totalVenueOwes;
    const venueBilledDirectly = !venueBalanceDebited;
    const updates = {
        status: won ? 'won' : 'lost',
        outcome,
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        totalVenueOwes,
        venueBalanceDebited,
        venueBilledDirectly,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await chargebackRef.update(updates);
    // Update venue reserve and chargeback balance
    const venueUpdates = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (venueBalanceDebited) {
        venueUpdates.reserveBalance = admin.firestore.FieldValue.increment(-totalVenueOwes);
    }
    else {
        // Reserve insufficient — add to outstanding chargeback balance
        venueUpdates.chargebackBalance = admin.firestore.FieldValue.increment(totalVenueOwes);
    }
    // Check Tier 5 chargeback rate threshold
    if (venueData?.payoutTier === 5) {
        const totalOrders = venueData?.totalOrders ?? 1;
        const chargebackCount = (venueData?.chargebackCount ?? 0) + 1;
        const chargebackRate = chargebackCount / totalOrders;
        if (chargebackRate > 0.005) { // 0.5% threshold
            venueUpdates.payoutTier = 3; // demote to Pro
            venueUpdates.payoutPreEvent = false;
            venueUpdates.payoutDelayHours = 48;
            venueUpdates.payoutSchedule = 'post_event';
            logger.warn(`Venue ${chargebackData.venueId} demoted from Tier 5 — chargeback rate ${chargebackRate}`);
        }
    }
    await venueDoc.ref.update(venueUpdates);
    logger.info(`Dispute ${dispute.id} closed — ${outcome}`, {
        venueId: chargebackData.venueId,
        totalVenueOwes,
        venueBalanceDebited,
    });
}
// ── Transfer created → update payout ─────────────────────────────────
async function handleTransferCreated(transfer) {
    const payoutSnap = await db
        .collection('payouts')
        .where('stripeTransferId', '==', transfer.id)
        .limit(1)
        .get();
    if (payoutSnap.empty)
        return;
    await payoutSnap.docs[0].ref.update({
        stripeTransferStatus: 'paid',
        status: 'paid',
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}
// ── Transfer failed → alert, update ──────────────────────────────────
async function handleTransferFailed(transfer) {
    const payoutSnap = await db
        .collection('payouts')
        .where('stripeTransferId', '==', transfer.id)
        .limit(1)
        .get();
    if (payoutSnap.empty)
        return;
    await payoutSnap.docs[0].ref.update({
        stripeTransferStatus: 'failed',
        status: 'failed',
        failureReason: 'Stripe transfer failed — check venue Connect account',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Increment admin badge
    await db.collection('config').doc('admin').set({
        failedPayoutCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}
// ── Helpers ───────────────────────────────────────────────────────────
function getPaymentMethodType(charge) {
    if (!charge)
        return 'unknown';
    const wallet = charge.payment_method_details?.card?.wallet;
    if (wallet?.type === 'apple_pay')
        return 'apple_pay';
    if (wallet?.type === 'google_pay')
        return 'google_pay';
    return 'card';
}
function getNextDailyBatchTime() {
    // Next 2am ET
    const now = new Date();
    const next = new Date();
    next.setUTCHours(7, 0, 0, 0); // 2am ET = 7am UTC
    if (next <= now)
        next.setDate(next.getDate() + 1);
    return next;
}
//# sourceMappingURL=webhook.js.map