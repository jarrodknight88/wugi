// ─────────────────────────────────────────────────────────────────────
// onTicketColorChange — triggers Apple Wallet pass update when
// ticket.color or ticket.passUpdatedAt changes from the dashboard
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { buildPassBuffer, getPrimaryPassId } from './generatePass';

const db      = admin.firestore();
const storage = admin.storage();

export const onTicketColorChange = functions.firestore
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

      if (ordersSnap.empty) {
        // Also try looking up by the ticket's orderId field
        const orderId = after.orderId;
        if (!orderId) return;
        await regenerateAndPush(orderId, after);
        return;
      }

      for (const orderDoc of ordersSnap.docs) {
        await regenerateAndPush(orderDoc.id, { ...orderDoc.data(), color: after.color });
      }
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
