"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onTicketTypeSold = exports.onVenueChargebackUpdate = exports.releaseReserves = exports.sendEmail = exports.onTableColorChange = exports.passWebService = exports.cancelTransfer = exports.claimTransfer = exports.initiateTransfer = exports.createPass = exports.debugFCM = exports.onEventPublished = exports.sendPushNotification = exports.schedulePayouts = exports.createCheckoutSession = exports.createPaymentIntentHttp = exports.createPaymentIntent = exports.stripeWebhook = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — Cloud Functions Index
// ─────────────────────────────────────────────────────────────────────
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
// Export all functions
var webhook_1 = require("./stripe/webhook");
Object.defineProperty(exports, "stripeWebhook", { enumerable: true, get: function () { return webhook_1.stripeWebhook; } });
var createPaymentIntent_1 = require("./stripe/createPaymentIntent");
Object.defineProperty(exports, "createPaymentIntent", { enumerable: true, get: function () { return createPaymentIntent_1.createPaymentIntent; } });
var createPaymentIntentHttp_1 = require("./stripe/createPaymentIntentHttp");
Object.defineProperty(exports, "createPaymentIntentHttp", { enumerable: true, get: function () { return createPaymentIntentHttp_1.createPaymentIntentHttp; } });
var createCheckoutSession_1 = require("./stripe/createCheckoutSession");
Object.defineProperty(exports, "createCheckoutSession", { enumerable: true, get: function () { return createCheckoutSession_1.createCheckoutSession; } });
var schedulePayouts_1 = require("./stripe/schedulePayouts");
Object.defineProperty(exports, "schedulePayouts", { enumerable: true, get: function () { return schedulePayouts_1.schedulePayouts; } });
var sendPushNotification_1 = require("./notifications/sendPushNotification");
Object.defineProperty(exports, "sendPushNotification", { enumerable: true, get: function () { return sendPushNotification_1.sendPushNotification; } });
var onEventPublished_1 = require("./notifications/onEventPublished");
Object.defineProperty(exports, "onEventPublished", { enumerable: true, get: function () { return onEventPublished_1.onEventPublished; } });
var debugFCM_1 = require("./notifications/debugFCM");
Object.defineProperty(exports, "debugFCM", { enumerable: true, get: function () { return debugFCM_1.debugFCM; } });
var generatePass_1 = require("./passes/generatePass");
Object.defineProperty(exports, "createPass", { enumerable: true, get: function () { return generatePass_1.createPass; } });
var ticketTransfer_1 = require("./passes/ticketTransfer");
Object.defineProperty(exports, "initiateTransfer", { enumerable: true, get: function () { return ticketTransfer_1.initiateTransfer; } });
Object.defineProperty(exports, "claimTransfer", { enumerable: true, get: function () { return ticketTransfer_1.claimTransfer; } });
Object.defineProperty(exports, "cancelTransfer", { enumerable: true, get: function () { return ticketTransfer_1.cancelTransfer; } });
var passWebService_1 = require("./passes/passWebService");
Object.defineProperty(exports, "passWebService", { enumerable: true, get: function () { return passWebService_1.passWebService; } });
Object.defineProperty(exports, "onTableColorChange", { enumerable: true, get: function () { return passWebService_1.onTableColorChange; } });
var sendEmail_1 = require("./email/sendEmail");
Object.defineProperty(exports, "sendEmail", { enumerable: true, get: function () { return sendEmail_1.sendEmail; } });
var releaseReserves_1 = require("./stripe/releaseReserves");
Object.defineProperty(exports, "releaseReserves", { enumerable: true, get: function () { return releaseReserves_1.releaseReserves; } });
var chargebackSuspension_1 = require("./venues/chargebackSuspension");
Object.defineProperty(exports, "onVenueChargebackUpdate", { enumerable: true, get: function () { return chargebackSuspension_1.onVenueChargebackUpdate; } });
var updateInventory_1 = require("./tickets/updateInventory");
Object.defineProperty(exports, "onTicketTypeSold", { enumerable: true, get: function () { return updateInventory_1.onTicketTypeSold; } });
//# sourceMappingURL=index.js.map