// ─────────────────────────────────────────────────────────────────────
// onTicketColorChange — triggers Apple Wallet pass update when
// ticket.color or ticket.passUpdatedAt changes from the dashboard
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { buildPassBuffer, getPrimaryPassId } from './generatePass';
import { runWithConcurrency, scheduleRebuild, REBUILD_POOL_CONCURRENCY } from './passRebuildQueue';

const db      = admin.firestore();
const storage = admin.storage();

// `ticketId` here is the Firestore doc ID of a single events/{eventId}/tickets/{ticketId}
// doc — a per-guest door ticket (holderName/holderEmail/balanceDue/checkedIn are
// per-person fields, and every walk-in mints a brand-new doc via .doc()/addDoc,
// never reused across guests of the same tier — the tier itself lives in the
// separate ticketTypes subcollection). So a single ticketId can never fan out to
// the "200 sold on this tier" truncation scenario; .limit(5) is a defensive cap,
// not a silent-data-loss bug, and is intentionally left in place. The warning
// below flags it if that assumption is ever violated in practice.
export const onTicketColorChange = functions
  .runWith({ maxInstances: 10 })
  .firestore
  .document('events/{eventId}/tickets/{ticketId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after  = change.after.data();

    // Only proceed if passUpdatedAt or color actually changed
    const colorChanged = before.color !== after.color;
    const passUpdated  = before.passUpdatedAt !== after.passUpdatedAt;
    if (!colorChanged && !passUpdated) return;
    if (!after.color) return;

    const { eventId, ticketId } = context.params;
    functions.logger.info('Ticket color changed:', eventId, ticketId, after.color);

    try {
      // Find the order associated with this ticket
      const ordersSnap = await db.collection('orders')
        .where('ticketId', '==', ticketId)
        .where('eventId', '==', eventId)
        .limit(5)
        .get();

      if (ordersSnap.size >= 5) {
        functions.logger.warn(
          'onTicketColorChange: orders query hit the .limit(5) cap — ticketId is expected ' +
          'to be per-order, so this many matches is unexpected. Verify before trusting propagation:',
          eventId, ticketId,
        );
      }

      if (ordersSnap.empty) {
        // Also try looking up by the ticket's orderId field
        const orderId = after.orderId;
        if (!orderId) return;
        await scheduleRebuild(orderId, after, regenerateAndPush);
        return;
      }

      // Bounded-concurrency pool rather than a sequential for-await (slow)
      // or an unbounded Promise.all (a rebuild storm under rotate-all).
      // scheduleRebuild debounces so several colour edits to the same order
      // within a few seconds coalesce into one rebuild.
      await runWithConcurrency(
        ordersSnap.docs,
        (orderDoc) => scheduleRebuild(orderDoc.id, { ...orderDoc.data(), color: after.color }, regenerateAndPush),
        REBUILD_POOL_CONCURRENCY,
      );
    } catch (e) {
      functions.logger.error('onTicketColorChange error:', e);
    }
  });

async function regenerateAndPush(orderId: string, orderData: any): Promise<void> {
  try {
    const passRef = db.collection('walletPasses').doc(orderId);
    const passDoc = await passRef.get();
    if (!passDoc.exists) return;

    // Build updated pass with new color
    const passId = orderData.passId || await getPrimaryPassId(orderId);
    const passBuffer = await buildPassBuffer({
      orderId,
      passId:      passId || undefined,
      eventTitle:  orderData.eventTitle  || '',
      venueName:   orderData.venueName   || '',
      eventDate:   orderData.eventDate   || '',
      eventTime:   orderData.eventTime   || '',
      ticketType:  orderData.ticketType  || orderData.ticketTypeName || '',
      quantity:    orderData.quantity    || 1,
      buyerName:   orderData.buyerName   || orderData.holderName || '',
      buyerEmail:  orderData.buyerEmail  || orderData.holderEmail || '',
      totalPaid:   orderData.totalPaid   || orderData.price || 0,
      passColor:   orderData.color       || null,
      colorLabel:  orderData.colorLabel  || null,
      tableNumber: orderData.tableAssignment || orderData.tableNumber || null,
      webServiceURL: `https://us-central1-wugi-prod.cloudfunctions.net/passWebService`,
      authenticationToken: passDoc.data()?.authenticationToken || '',
    });

    // Store updated .pkpass file
    const bucket = storage.bucket();
    const file   = bucket.file(`passes/${orderId}.pkpass`);
    await file.save(passBuffer, {
      contentType: 'application/vnd.apple.pkpass',
      metadata: { cacheControl: 'no-cache' },
    });
    await file.makePublic();

    // Mark pass as updated so Apple Wallet knows to re-fetch
    await passRef.update({
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      passColor: orderData.color,
    });

    // Push APNs silent notification to all registered devices
    await pushToWalletDevices(orderId);

    functions.logger.info('Pass regenerated for order:', orderId, 'color:', orderData.color);
  } catch (e) {
    functions.logger.error('regenerateAndPush error for', orderId, e);
  }
}

async function pushToWalletDevices(orderId: string): Promise<void> {
  const devicesSnap = await db.collection('walletDevices').get();
  for (const deviceDoc of devicesSnap.docs) {
    const regRef = deviceDoc.ref.collection('registrations').doc(orderId);
    const reg    = await regRef.get();
    if (!reg.exists) continue;
    const pushToken = deviceDoc.data().pushToken;
    if (!pushToken) continue;
    try {
      await admin.messaging().send({
        token: pushToken,
        apns: {
          headers: {
            'apns-topic':    'pass.com.wugimedia.wugi',
            'apns-push-type': 'background',
          },
          payload: { aps: { 'content-available': 1 } },
        },
      });
    } catch (e) {
      functions.logger.warn('APNs push failed for device:', deviceDoc.id, e);
    }
  }
}
