// ─────────────────────────────────────────────────────────────────────
// Wugi — Update Ticket Inventory
//
// Fires when a pass is created. Updates the ticketType's
// sold/remaining counts and flips status to 'sold_out' if needed.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export const onTicketTypeSold = functions.firestore
  .document('passes/{passId}')
  .onCreate(async (snap) => {
    const pass = snap.data();

    const { eventId, ticketTypeId } = pass;
    if (!eventId || !ticketTypeId) return;

    const ticketTypeRef = db
      .collection('events')
      .doc(eventId)
      .collection('ticketTypes')
      .doc(ticketTypeId);

    await db.runTransaction(async (tx) => {
      const ticketTypeDoc = await tx.get(ticketTypeRef);
      if (!ticketTypeDoc.exists) return;

      const ticketType = ticketTypeDoc.data()!;
      const newSold      = (ticketType.sold ?? 0) + 1;
      const newRemaining = (ticketType.capacity ?? 0) - newSold;

      const updates: Record<string, any> = {
        sold:      newSold,
        remaining: newRemaining,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Flip to sold_out if no remaining capacity
      if (newRemaining <= 0 && ticketType.status === 'on_sale') {
        updates.status = 'sold_out';
        logger.info(
          `Ticket type ${ticketTypeId} for event ${eventId} is now sold out`
        );
      }

      tx.update(ticketTypeRef, updates);
    });
  });
