// ─────────────────────────────────────────────────────────────────────
// Wugi — ticketTypes.ts
// Kept for backward compatibility. All styling now goes through
// getPassStyle() in src/utils/safeData.ts — dynamic, crash-proof,
// works for any ticket type name without code changes.
// ─────────────────────────────────────────────────────────────────────
export { getPassStyle } from '../utils/safeData';

// Fee calculation helpers (unchanged)
const PLATFORM_FEE_PERCENT = 0.12;
const PLATFORM_FEE_MIN     = 1.99;
const PLATFORM_FEE_MAX     = 75.00;

export const calculateServiceFee = (ticketPrice: number): number => {
  const fee = ticketPrice * PLATFORM_FEE_PERCENT;
  return Math.min(Math.max(fee, PLATFORM_FEE_MIN), PLATFORM_FEE_MAX);
};

export const calculateTotalPrice = (ticketPrice: number): number =>
  ticketPrice + calculateServiceFee(ticketPrice);

const STRIPE_PERCENT = 0.029;
const STRIPE_FIXED   = 0.30;

export const estimateStripeFee = (totalCharged: number): number =>
  totalCharged * STRIPE_PERCENT + STRIPE_FIXED;

export const estimateWugiNet = (ticketPrice: number): number => {
  const serviceFee = calculateServiceFee(ticketPrice);
  const total      = ticketPrice + serviceFee;
  const stripeFee  = estimateStripeFee(total);
  return serviceFee - stripeFee;
};
