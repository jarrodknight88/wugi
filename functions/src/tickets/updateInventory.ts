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

      // Guard: skip inventory update for free tickets (managed by createPaymentIntentHttp)
      // to avoid double-decrement
      if (ticketType.isFree || pass.source === 'free') return;

      // A table is ONE inventory unit (the table), not one-per-seat. The webhook
      // issues tableCapacity passes per table (1 purchaser + guests); only the
      // purchaser pass decrements inventory so a table sale consumes -1, not
      // -tableCapacity. tableCapacity is read from the ticket-type doc (dynamic).
      if ((ticketType.tableCapacity ?? 0) > 1 && pass.role !== 'purchaser') return;

      // Use capacity field, fallback to quantity, fallback to current remaining + sold
      const capacity = ticketType.capacity ?? ticketType.quantity ?? ((ticketType.remaining ?? 0) + (ticketType.sold ?? 0));
      const newSold      = (ticketType.sold ?? 0) + 1;
      const newRemaining = Math.max(0, capacity - newSold);

      const updates: Record<string, any> = {
        sold:      newSold,
        remaining: newRemaining,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Only flip to sold_out if remaining hits 0 and status is currently on_sale
      if (newRemaining <= 0 && ticketType.status === 'on_sale') {
        updates.status = 'sold_out';
        logger.info(
          `Ticket type ${ticketTypeId} for event ${eventId} is now sold out`
        );
      }

      tx.update(ticketTypeRef, updates);
    });
  });
