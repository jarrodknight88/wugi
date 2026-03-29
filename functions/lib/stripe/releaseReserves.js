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
exports.releaseReserves = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — Release Reserves
//
// Runs every hour. Finds orders whose reserve hold period has passed
// (48–72h post-event) and transfers the held 5% to the venue.
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
const stripeUtils_1 = require("./stripeUtils");
const db = admin.firestore();
exports.releaseReserves = functions.pubsub
    .schedule('every 60 minutes')
    .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    // Find orders whose reserve is ready to release
    const readyOrders = await db
        .collection('orders')
        .where('payoutStatus', '==', 'reserved')
        .where('payoutReleaseAt', '<=', now)
        .where('status', '==', 'confirmed') // don't release on disputed orders
        .get();
    if (readyOrders.empty) {
        logger.info('No reserves to release');
        return;
    }
    logger.info(`Releasing reserves for ${readyOrders.size} orders`);
    // Group by venue to batch transfers
    const venueGroups = new Map();
    for (const orderDoc of readyOrders.docs) {
        const order = orderDoc.data();
        if (!venueGroups.has(order.venueId)) {
            // Fetch venue Connect account
            const venueDoc = await db.collection('venues').doc(order.venueId).get();
            const venueData = venueDoc.data();
            venueGroups.set(order.venueId, {
                orders: [],
                totalReserve: 0,
                stripeConnectAccountId: venueData?.stripeConnectAccountId ?? '',
            });
        }
        const group = venueGroups.get(order.venueId);
        group.orders.push(orderDoc);
        group.totalReserve += order.payoutReserveAmount ?? 0;
    }
    // Execute reserve releases per venue
    for (const [venueId, group] of venueGroups) {
        if (!group.stripeConnectAccountId) {
            logger.warn(`Venue ${venueId} has no Connect account — skipping reserve release`);
            continue;
        }
        if (group.totalReserve <= 0)
            continue;
        try {
            const transfer = await stripeUtils_1.stripe.transfers.create({
                amount: group.totalReserve,
                currency: 'usd',
                destination: group.stripeConnectAccountId,
                metadata: {
                    type: 'reserve_release',
                    venueId,
                    orderIds: group.orders.map(o => o.id).join(','),
                },
            });
            // Update all orders and payouts in this group
            const batch = db.batch();
            for (const orderDoc of group.orders) {
                batch.update(orderDoc.ref, {
                    payoutStatus: 'released',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                // Update the linked payout doc
                const order = orderDoc.data();
                if (order?.payoutId) {
                    batch.update(db.collection('payouts').doc(order.payoutId), {
                        reserveReleased: true,
                        reserveReleasedAt: admin.firestore.FieldValue.serverTimestamp(),
                        reserveStripeTransferId: transfer.id,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
            }
            await batch.commit();
            logger.info(`Reserve released for venue ${venueId}`, {
                amount: group.totalReserve,
                transferId: transfer.id,
                orders: group.orders.length,
            });
        }
        catch (err) {
            logger.error(`Reserve release failed for venue ${venueId}`, err);
        }
    }
});
//# sourceMappingURL=releaseReserves.js.map