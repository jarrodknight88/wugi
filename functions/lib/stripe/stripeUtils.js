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
exports.stripe = void 0;
exports.calculateBookingFee = calculateBookingFee;
exports.calculateReserve = calculateReserve;
exports.getPayoutDelayHours = getPayoutDelayHours;
exports.generateTicketNumber = generateTicketNumber;
exports.centsToDisplay = centsToDisplay;
// ─────────────────────────────────────────────────────────────────────
// Wugi — Stripe utilities
// ─────────────────────────────────────────────────────────────────────
const stripe_1 = __importDefault(require("stripe"));
const functions = __importStar(require("firebase-functions"));
exports.stripe = new stripe_1.default(functions.config().stripe.secret_key, { apiVersion: '2023-10-16' });
// ── Booking fee calculation ───────────────────────────────────────────
// All amounts in cents
function calculateBookingFee(subtotalCents, overrides) {
    const percent = overrides?.feePercent ?? 0.12;
    const min = overrides?.feeMin ?? 199; // $1.99
    const max = overrides?.feeMax ?? 10000; // $100.00
    const fee = Math.round(subtotalCents * percent);
    return Math.min(max, Math.max(min, fee));
}
// ── Reserve calculation ───────────────────────────────────────────────
function calculateReserve(subtotalCents, reservePercent = 0.05) {
    return Math.round(subtotalCents * reservePercent);
}
// ── Payout delay from tier ────────────────────────────────────────────
function getPayoutDelayHours(tier) {
    const delays = {
        1: 168, // 7 days
        2: 72,
        3: 48,
        4: 24,
        5: 0, // daily batch / pre-event
    };
    return delays[tier] ?? 168;
}
// ── Ticket number generator ───────────────────────────────────────────
function generateTicketNumber() {
    const year = new Date().getFullYear().toString().slice(-2);
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const rand = Math.floor(Math.random() * 90000 + 10000);
    return `WG-${year}${month}-${rand}`;
}
// ── Cents to dollars string ───────────────────────────────────────────
function centsToDisplay(cents) {
    return `$${(cents / 100).toFixed(2)}`;
}
//# sourceMappingURL=stripeUtils.js.map