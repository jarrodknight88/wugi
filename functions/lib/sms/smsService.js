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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePhone = normalizePhone;
exports.sendDoorSaleReceiptSMS = sendDoorSaleReceiptSMS;
exports.sendBalancePaidSMS = sendBalancePaidSMS;
exports.sendPurchaseConfirmationSMS = sendPurchaseConfirmationSMS;
exports.sendCheckInSMS = sendCheckInSMS;
exports.sendTicketScannedSMS = sendTicketScannedSMS;
// ─────────────────────────────────────────────────────────────────────
// Wugi — smsService.ts
// Sends transactional SMS via Twilio
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
// ─────────────────────────────────────────────────────────────────────
const logger = __importStar(require("firebase-functions/logger"));
const twilio_1 = __importDefault(require("twilio"));
function getTwilio() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER;
    if (!sid || !token || !from)
        throw new Error('Twilio secrets not configured');
    return { client: (0, twilio_1.default)(sid, token), from };
}
// Normalize to E.164 — accepts (404) 555-0123, 404-555-0123, +14045550123 etc.
function normalizePhone(raw) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10)
        return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1'))
        return `+${digits}`;
    if (digits.length > 11)
        return `+${digits}`;
    return null;
}
async function sendSMS(to, body) {
    const normalized = normalizePhone(to);
    if (!normalized) {
        logger.warn('smsService: invalid phone number', { to });
        return;
    }
    try {
        const { client, from } = getTwilio();
        await client.messages.create({ from, to: normalized, body });
        logger.info('SMS sent', { to: normalized });
    }
    catch (e) {
        // Non-blocking — SMS failure should never break a transaction
        logger.error('smsService: failed to send SMS', { to: normalized, error: e?.message });
    }
}
async function sendDoorSaleReceiptSMS(data) {
    const amount = `$${(data.amountCents / 100).toFixed(2)}`;
    await sendSMS(data.phone, `Wugi ✅ Payment confirmed!\n${data.ticketType} × 1 — ${amount}\n${data.eventTitle} @ ${data.venueName}\nEnjoy your night! 🎉`);
}
async function sendBalancePaidSMS(data) {
    const amount = `$${(data.amountCents / 100).toFixed(2)}`;
    await sendSMS(data.phone, `Wugi 💳 Balance paid!\nYour balance of ${amount} has been paid for ${data.eventTitle}. You're all set!`);
}
async function sendPurchaseConfirmationSMS(data) {
    const total = `$${(data.totalCents / 100).toFixed(2)}`;
    const qty = data.quantity > 1 ? ` × ${data.quantity}` : '';
    await sendSMS(data.phone, `Wugi 🎟️ You're going!\n${data.ticketType}${qty} — ${total}\n${data.eventTitle} @ ${data.venueName}\nSee you there! 🎉`);
}
async function sendCheckInSMS(data) {
    await sendSMS(data.phone, `Wugi 🎟️ You're checked in!\nWelcome to ${data.eventTitle} at ${data.venueName}. Have an amazing time!`);
}
async function sendTicketScannedSMS(data) {
    await sendSMS(data.phone, `Wugi ✅ Ticket scanned!\n${data.eventTitle} @ ${data.venueName}. You're in — enjoy the night! 🙌`);
}
//# sourceMappingURL=smsService.js.map