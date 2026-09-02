// ─────────────────────────────────────────────────────────────────────
// Wugi — Dashboard ticket refund (online orders)
//
// Staff-authed wrapper around the same Stripe refund path Wugi Door
// uses (see stripe/refundUtils.ts) — issue #176. Door refunds
// card-present Tap-to-Pay sales via PIN auth (refundDoorSale, keyed on
// terminalPayments); this refunds online Stripe Checkout/PaymentSheet
// orders (the `orders` + `passes` collections the mobile app writes)
// via the dashboard's Firebase-Auth + Firestore role model instead.
// Neither reimplements Stripe refund math — both call issueStripeRefund.
//
// Door walk-up sales recorded under events/{id}/tickets are a separate
// data model not surfaced on the dashboard Tickets page; they remain
// refundable only through Door's own refundDoorSale flow.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { issueStripeRefund } from '../stripe/refundUtils';
import { checkRateLimit } from '../utils/rateLimit';

const db = admin.firestore();

// Refunds move real money — deliberately narrower than general dashboard
// write access. `support` can otherwise view/handle tickets but is
// excluded here; venue_admin/event_admin (scoped roles) are excluded too.
// Only the two full-admin tiers may issue a refund.
const REFUND_ROLES = ['super_admin', 'moderator'];

const REFUNDABLE_STATUSES = ['confirmed', 'disputed'];

export const refundTicketOrder = functions.https.onCall(async (data: {
  orderId: string;
  staffNote?: string;
}, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

  const callerDoc  = await db.collection('users').doc(context.auth.uid).get();
  const callerRole: string = callerDoc.exists ? (callerDoc.data()?.role || '') : '';
  if (!REFUND_ROLES.includes(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Only Super Admin or Moderator can issue refunds');
  }

  const rateLimitOk = await checkRateLimit(`refundTicketOrder:${context.auth.uid}`, { max: 5, windowSeconds: 60 });
  if (!rateLimitOk) {
    throw new functions.https.HttpsError('resource-exhausted', 'Too many refund requests. Please slow down.');
  }

  const { orderId, staffNote } = data;
  if (!orderId || typeof orderId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'orderId required');
  }

  const orderRef  = db.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new functions.https.HttpsError('not-found', `Order ${orderId} not found`);
  const order = orderSnap.data()!;

  if (!REFUNDABLE_STATUSES.includes(order.status)) {
    throw new functions.https.HttpsError('failed-precondition',
      `Order status "${order.status}" is not refundable`);
  }
  if (!order.stripePaymentIntentId) {
    throw new functions.https.HttpsError('failed-precondition', 'Order has no payment to refund');
  }

  const refund = await issueStripeRefund(order.stripePaymentIntentId, {
    stripeReason: 'requested_by_customer',
    metadata: {
      refundReason: 'dashboard_ticket_refund',
      staffUid: context.auth.uid,
      staffNote: staffNote || '',
      source: 'dashboard',
      approvedByRole: callerRole,
      orderId,
    },
  });

  await orderRef.update({
    status:            'refunded',
    refundId:          refund.id,
    refundStaffNote:   staffNote || null,
    refundedBy:        context.auth.uid,
    refundedByRole:    callerRole,
    refundedAt:        admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:         admin.firestore.FieldValue.serverTimestamp(),
  });

  // Invalidate not-yet-scanned passes so Door's checkInPass (which rejects
  // any scanStatus other than 'valid'/'scanned') refuses entry on a
  // refunded ticket. Already-scanned passes are left as-is — the guest
  // already got in; there's nothing to undo at the door.
  const passesSnap = await db.collection('passes').where('orderId', '==', orderId).get();
  if (!passesSnap.empty) {
    const batch = db.batch();
    passesSnap.docs.forEach(doc => {
      if (doc.data().scanStatus !== 'scanned') {
        batch.update(doc.ref, {
          scanStatus: 'refunded',
          updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });
    await batch.commit();
  }

  return { success: true, refundId: refund.id, status: refund.status };
});
