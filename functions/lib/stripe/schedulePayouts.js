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
exports.schedulePayouts = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — Schedule Payouts
//
// Runs every hour. Finds payouts that are due and executes
// Stripe Connect transfers to venue accounts.
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const stripeUtils_1 = require("./stripeUtils");
const db = admin.firestore();
exports.schedulePayouts = functions.pubsub
    .schedule('every 60 minutes')
    .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    // Find payouts that are scheduled and due
    const duePayouts = await db
        .collection('payouts')
        .where('status', '==', 'scheduled')
        .where('scheduledFor', '<=', now)
        .get();
    if (duePayouts.empty) {
        functions.logger.info('No payouts due');
        return;
    }
    functions.logger.info(`Processing ${duePayouts.size} payouts`);
    for (const payoutDoc of duePayouts.docs) {
        const payout = payoutDoc.data();
        const payoutRef = payoutDoc.ref;
        // Skip if venue doesn't have a Connect account
        if (!payout.stripeConnectAccountId) {
            functions.logger.warn(`Payout ${payoutDoc.id} — no Connect account, skipping`);
            await payoutRef.update({
                status: 'failed',
                failureReason: 'Venue has not completed Stripe Connect onboarding',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            continue;
        }
        // Mark as processing
        await payoutRef.update({
            status: 'processing',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        try {
            // Execute Stripe Connect transfer
            // netAmount = venue earnings (subtotal - reserve - booking fee)
            const transfer = await stripeUtils_1.stripe.transfers.create({
                amount: payout.netAmount,
                currency: 'usd',
                destination: payout.stripeConnectAccountId,
                metadata: {
                    payoutId: payoutDoc.id,
                    venueId: payout.venueId,
                    eventIds: payout.eventIds.join(','),
                    orderIds: payout.orderIds.join(','),
                },
            });
            await payoutRef.update({
                stripeTransferId: transfer.id,
                stripeTransferStatus: 'paid',
                status: 'paid',
                paidAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            // Update orders to reflect payout sent
            const batch = db.batch();
            for (const orderId of payout.orderIds) {
                const orderRef = db.collection('orders').doc(orderId);
                batch.update(orderRef, {
                    payoutStatus: 'paid',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
            await batch.commit();
            functions.logger.info(`Payout ${payoutDoc.id} executed`, {
                transferId: transfer.id,
                amount: payout.netAmount,
                venueId: payout.venueId,
            });
        }
        catch (err) {
            functions.logger.error(`Payout ${payoutDoc.id} failed`, err);
            await payoutRef.update({
                status: 'failed',
                failureReason: err.message,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            // Increment admin failed payout badge
            await db.collection('config').doc('admin').set({
                failedPayoutCount: admin.firestore.FieldValue.increment(1),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
    }
});
//# sourceMappingURL=schedulePayouts.js.map