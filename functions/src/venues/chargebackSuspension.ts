// ─────────────────────────────────────────────────────────────────────
// Wugi — Chargeback Suspension
//
// Fires when a chargeback doc is updated.
// If venue chargebackBalance exceeds threshold and is unpaid,
// triggers account suspension.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// Suspend venue if outstanding chargeback balance > $50
const SUSPENSION_THRESHOLD_CENTS = 5000;

export const onVenueChargebackUpdate = functions.firestore
  .document('chargebacks/{chargebackId}')
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after  = change.after.data();

    // Only act when a chargeback is lost and venue billed directly
    if (
      before.status === after.status ||
      after.status !== 'lost' ||
      !after.venueBilledDirectly
    ) {
      return;
    }

    const venueId  = after.venueId;
    const venueRef = db.collection('venues').doc(venueId);
    const venueDoc = await venueRef.get();
    const venue    = venueDoc.data();

    if (!venue) return;

    const outstandingBalance = venue.chargebackBalance ?? 0;

    // Check if suspension threshold exceeded
    if (
      outstandingBalance >= SUSPENSION_THRESHOLD_CENTS &&
      !venue.chargebackSuspended
    ) {
      await venueRef.update({
        chargebackSuspended:   true,
        chargebackSuspendedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt:             admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update chargeback doc to note suspension triggered
      await change.after.ref.update({
        suspensionTriggered: true,
        updatedAt:           admin.firestore.FieldValue.serverTimestamp(),
      });

      // Increment admin badge
      await db.collection('config').doc('admin').set({
        suspendedVenueCount: admin.firestore.FieldValue.increment(1),
        updatedAt:           admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      logger.warn(`Venue ${venueId} suspended`, {
        outstandingBalance,
        chargebackId: change.after.id,
      });
    }
  });
