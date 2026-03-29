// ─────────────────────────────────────────────────────────────────────
// Wugi — Schedule Payouts
//
// Runs every hour. Finds payouts that are due and executes
// Stripe Connect transfers to venue accounts.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { stripe } from './stripeUtils';

const db = admin.firestore();

export const schedulePayouts = functions.pubsub
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
      logger.info('No payouts due');
      return;
    }

    logger.info(`Processing ${duePayouts.size} payouts`);

    for (const payoutDoc of duePayouts.docs) {
      const payout    = payoutDoc.data();
      const payoutRef = payoutDoc.ref;

      // Skip if venue doesn't have a Connect account
      if (!payout.stripeConnectAccountId) {
        logger.warn(`Payout ${payoutDoc.id} — no Connect account, skipping`);
        await payoutRef.update({
          status:        'failed',
          failureReason: 'Venue has not completed Stripe Connect onboarding',
          updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
        });
        continue;
      }

      // Mark as processing
      await payoutRef.update({
        status:    'processing',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      try {
        // Execute Stripe Connect transfer
        // netAmount = venue earnings (subtotal - reserve - booking fee)
        const transfer = await stripe.transfers.create({
          amount:      payout.netAmount,
          currency:    'usd',
          destination: payout.stripeConnectAccountId,
          metadata: {
            payoutId:  payoutDoc.id,
            venueId:   payout.venueId,
            eventIds:  payout.eventIds.join(','),
            orderIds:  payout.orderIds.join(','),
          },
        });

        await payoutRef.update({
          stripeTransferId:     transfer.id,
          stripeTransferStatus: 'paid',
          status:               'paid',
          paidAt:               admin.firestore.FieldValue.serverTimestamp(),
          updatedAt:            admin.firestore.FieldValue.serverTimestamp(),
        });

        // Update orders to reflect payout sent
        const batch = db.batch();
        for (const orderId of payout.orderIds) {
          const orderRef = db.collection('orders').doc(orderId);
          batch.update(orderRef, {
            payoutStatus: 'paid',
            updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();

        logger.info(`Payout ${payoutDoc.id} executed`, {
          transferId: transfer.id,
          amount:     payout.netAmount,
          venueId:    payout.venueId,
        });

      } catch (err: any) {
        logger.error(`Payout ${payoutDoc.id} failed`, err);

        await payoutRef.update({
          status:        'failed',
          failureReason: err.message,
          updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
        });

        // Increment admin failed payout badge
        await db.collection('config').doc('admin').set({
          failedPayoutCount: admin.firestore.FieldValue.increment(1),
          updatedAt:         admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }
  });
