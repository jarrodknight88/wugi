"use strict";
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
exports.stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
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
        1: 168,
        2: 72,
        3: 48,
        4: 24,
        5: 0,
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