// ─────────────────────────────────────────────────────────────────────
// Wugi — credit display helpers (Asana 1218248530084817 / issue #282)
//
// Every credit amount in Firestore is an integer HALF-credit unit (HCU):
// 1 credit = 2 HCU, 0.5 credit = 1 HCU. This file is the ONLY place that
// should divide by 2 to render a human-facing amount — keep all other
// client code working in HCU so it never re-introduces float credits.
// ─────────────────────────────────────────────────────────────────────
export const HALF_CREDITS_PER_CREDIT = 2;

// Display-side mirror of functions/src/economy/creditEconomy.ts
// ALLOWED_PHOTO_COST_HALF_CREDITS / DEFAULT_CREDIT_ECONOMY_CONFIG
// .defaultPhotoCreditCostHalfCredits — used ONLY to render a sane price
// before the user taps buy. The server clamps independently and is the
// only source of truth for what actually gets charged.
const ALLOWED_PHOTO_COST_HALF_CREDITS = new Set([1, 2]);
export const DEFAULT_PHOTO_COST_HALF_CREDITS = 2;

export function displayPhotoCreditCostHalfCredits(raw: unknown): number {
  const n = Number(raw);
  return ALLOWED_PHOTO_COST_HALF_CREDITS.has(n) ? n : DEFAULT_PHOTO_COST_HALF_CREDITS;
}

export function creditsFromHalfCredits(halfCredits: number): number {
  return halfCredits / HALF_CREDITS_PER_CREDIT;
}

// "½ credit" / "1 credit" / "2.5 credits" — half-credit values render with
// the ½ glyph, whole values render as plain integers.
export function formatHalfCredits(halfCredits: number): string {
  const whole = Math.floor(halfCredits / HALF_CREDITS_PER_CREDIT);
  const hasHalf = halfCredits % HALF_CREDITS_PER_CREDIT !== 0;
  const amount = hasHalf ? (whole > 0 ? `${whole}½` : '½') : `${whole}`;
  const isSingular = halfCredits === HALF_CREDITS_PER_CREDIT;
  return `${amount} credit${isSingular ? '' : 's'}`;
}
