// ─────────────────────────────────────────────────────────────────────
// Wugi — Shared Stripe refund logic
// Single source of truth for resolving a charge and issuing a Stripe
// refund. Used by refundDoorSale (Wugi Door, PIN-authed, card-present
// terminal sales) and refundTicketOrder (dashboard, staff-authed,
// online Stripe Checkout/PaymentSheet orders) so the two refund
// surfaces can never drift out of sync on the actual Stripe call.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { stripe } from './stripeUtils';

const db = admin.firestore();

// Resolves the Stripe chargeId for a PaymentIntent. Checks the
// Door-specific terminalPayments record first (faster, and works if the
// PI was created in test mode), then falls back to retrieving the
// PaymentIntent from Stripe directly — the only path available for
// online orders, which have no terminalPayments record at all.
export async function resolveChargeId(paymentIntentId: string): Promise<string> {
  const paymentSnap = await db.collection('terminalPayments')
    .where('paymentIntentId', '==', paymentIntentId).limit(1).get();

  let chargeId: string | null = null;
  if (!paymentSnap.empty) {
    chargeId = paymentSnap.docs[0].data().chargeId || null;
  }

  if (!chargeId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
      if (pi.status !== 'succeeded') {
        throw new functions.https.HttpsError('failed-precondition', 'Payment not succeeded — cannot refund');
      }
      const charge = pi.latest_charge as any;
      chargeId = typeof charge === 'string' ? charge : charge?.id;
    } catch (stripeErr: any) {
      throw new functions.https.HttpsError('not-found',
        `Cannot find payment to refund. The transaction may have been created in test mode. Error: ${stripeErr.message}`);
    }
  }

  if (!chargeId) throw new functions.https.HttpsError('not-found', 'No charge ID found for this payment');
  return chargeId;
}

export async function issueStripeRefund(paymentIntentId: string, opts: {
  stripeReason: Stripe.RefundCreateParams.Reason;
  metadata: Record<string, string>;
}): Promise<Stripe.Refund> {
  const chargeId = await resolveChargeId(paymentIntentId);
  return stripe.refunds.create({
    charge: chargeId,
    reason: opts.stripeReason,
    metadata: opts.metadata,
  });
}
