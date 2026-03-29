// ─────────────────────────────────────────────────────────────────────
// Wugi — Stripe utilities
// ─────────────────────────────────────────────────────────────────────
import Stripe from 'stripe';

export const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY!,
  { apiVersion: '2023-10-16' }
);

// ── Booking fee calculation ───────────────────────────────────────────
// All amounts in cents
export function calculateBookingFee(
  subtotalCents: number,
  overrides?: {
    feePercent?: number;
    feeMin?: number;
    feeMax?: number;
  }
): number {
  const percent = overrides?.feePercent ?? 0.12;
  const min     = overrides?.feeMin     ?? 199;    // $1.99
  const max     = overrides?.feeMax     ?? 10000;  // $100.00
  const fee     = Math.round(subtotalCents * percent);
  return Math.min(max, Math.max(min, fee));
}

// ── Reserve calculation ───────────────────────────────────────────────
export function calculateReserve(
  subtotalCents: number,
  reservePercent: number = 0.05
): number {
  return Math.round(subtotalCents * reservePercent);
}

// ── Payout delay from tier ────────────────────────────────────────────
export function getPayoutDelayHours(tier: number): number {
  const delays: Record<number, number> = {
    1: 168,
    2: 72,
    3: 48,
    4: 24,
    5: 0,
  };
  return delays[tier] ?? 168;
}

// ── Ticket number generator ───────────────────────────────────────────
export function generateTicketNumber(): string {
  const year  = new Date().getFullYear().toString().slice(-2);
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const rand  = Math.floor(Math.random() * 90000 + 10000);
  return `WG-${year}${month}-${rand}`;
}

// ── Cents to dollars string ───────────────────────────────────────────
export function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
