// ─────────────────────────────────────────────────────────────────────
// Wugi — Cloud Functions Index
// ─────────────────────────────────────────────────────────────────────
import * as admin from 'firebase-admin';

admin.initializeApp();

// Export all functions
export { stripeWebhook }           from './stripe/webhook';
export { createPaymentIntent }     from './stripe/createPaymentIntent';
export { createPaymentIntentHttp } from './stripe/createPaymentIntentHttp';
export { createCheckoutSession }   from './stripe/createCheckoutSession';
export { schedulePayouts }         from './stripe/schedulePayouts';
export { sendPushNotification }    from './notifications/sendPushNotification';
export { onEventPublished }        from './notifications/onEventPublished';
export { debugFCM }                from './notifications/debugFCM';
export { createPass }              from './passes/generatePass';
export { initiateTransfer, claimTransfer, cancelTransfer } from './passes/ticketTransfer';
export { releaseReserves } from './stripe/releaseReserves';
export { onVenueChargebackUpdate } from './venues/chargebackSuspension';
export { onTicketTypeSold } from './tickets/updateInventory';
