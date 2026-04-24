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
export { passWebService, onTableColorChange }              from './passes/passWebService';
export { sendEmail }               from './email/sendEmail';
export { releaseReserves } from './stripe/releaseReserves';
export { onVenueChargebackUpdate } from './venues/chargebackSuspension';
export { onTicketTypeSold } from './tickets/updateInventory';
export { generateDoorPin }      from './door/generateDoorPin';
export { validateSuperAdminPin } from './door/validateSuperAdminPin';
export { createDashboardUser }  from './users/createDashboardUser';
export { onUserCreated }        from './users/onUserCreated';
export { generateSeriesEvents, generateSeriesEventsScheduled } from './series/generateSeriesEvents';
export { createTerminalConnectionToken, createTerminalPaymentIntent, captureTerminalPayment, refundDoorSale, cancelDoorSale, autoSettlePendingDoorSales } from './terminal/terminalFunctions';
export { onTicketColorChange } from './passes/ticketColorSync';
export { asanaWebhook }       from './asana/asanaWebhook';
