// ─────────────────────────────────────────────────────────────────────
// Wugi — Release Reserves
//
// Runs every hour. Finds orders whose reserve hold period has passed
// (48–72h post-event) and transfers the held 5% to the venue.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { stripe } from './stripeUtils';

const db = admin.firestore();

export const releaseReserves = functions.pubsub
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
    const venueGroups = new Map<string, {
      orders: FirebaseFirestore.DocumentSnapshot[];
      totalReserve: number;
      stripeConnectAccountId: string;
    }>();

    for (const orderDoc of readyOrders.docs) {
      const order = orderDoc.data();

      if (!venueGroups.has(order.venueId)) {
        // Fetch venue Connect account
        const venueDoc  = await db.collection('venues').doc(order.venueId).get();
        const venueData = venueDoc.data();

        venueGroups.set(order.venueId, {
          orders:                 [],
          totalReserve:           0,
          stripeConnectAccountId: venueData?.stripeConnectAccountId ?? '',
        });
      }

      const group = venueGroups.get(order.venueId)!;
      group.orders.push(orderDoc);
      group.totalReserve += order.payoutReserveAmount ?? 0;
    }

    // Execute reserve releases per venue
    for (const [venueId, group] of venueGroups) {
      if (!group.stripeConnectAccountId) {
        logger.warn(`Venue ${venueId} has no Connect account — skipping reserve release`);
        continue;
      }

      if (group.totalReserve <= 0) continue;

      try {
        const transfer = await stripe.transfers.create({
          amount:      group.totalReserve,
          currency:    'usd',
          destination: group.stripeConnectAccountId,
          metadata: {
            type:     'reserve_release',
            venueId,
            orderIds: group.orders.map(o => o.id).join(','),
          },
        });

        // Update all orders and payouts in this group
        const batch = db.batch();

        for (const orderDoc of group.orders) {
          batch.update(orderDoc.ref, {
            payoutStatus: 'released',
            updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
          });

          // Update the linked payout doc
          const order = orderDoc.data() as FirebaseFirestore.DocumentData | undefined;
          if (order?.payoutId) {
            batch.update(db.collection('payouts').doc(order.payoutId as string), {
              reserveReleased:        true,
              reserveReleasedAt:      admin.firestore.FieldValue.serverTimestamp(),
              reserveStripeTransferId: transfer.id,
              updatedAt:              admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        }

        await batch.commit();

        logger.info(`Reserve released for venue ${venueId}`, {
          amount:     group.totalReserve,
          transferId: transfer.id,
          orders:     group.orders.length,
        });

      } catch (err: any) {
        logger.error(`Reserve release failed for venue ${venueId}`, err);
      }
    }
  });
