// ─────────────────────────────────────────────────────────────────────
// Wugi — creditEconomy
// Shared config, constants, and small pure helpers for the credit-economy
// IAP restructure (issue #282). Consumed by validateUnlockPurchase.ts
// (fulfillment), spendCredits.ts (redemption), onUserCreated.ts (signup
// grant), setGalleryCreditPricing.ts (admin pricing writes), and
// getPhotographerEarnings.ts (payout aggregation).
//
// UNITS: credits are NEVER stored as floats. Everything server-side and
// in Firestore is an integer count of HALF-CREDIT sub-units
// (1 credit = 2 half-credits). Convert to a display string only at the
// UI layer (mobile-app/src/utils/credits.ts mirrors halfCreditsLabel()
// below so both sides describe the same number the same way).
// ─────────────────────────────────────────────────────────────────────
import * as admin from 'firebase-admin';

// Apple product id → half-credits granted. Server-computed from the
// Apple-VERIFIED productId (never trusted from the client/intent doc) —
// see validateUnlockPurchase.ts.
export const PRODUCT_HALF_CREDITS: Record<string, number> = {
  credits_1: 2,   // 1 credit  · $9.99
  credits_3: 6,   // 3 credits · $24.99
  credits_5: 10,  // 5 credits · $39.99
};
export const CREDIT_PRODUCT_IDS = Object.keys(PRODUCT_HALF_CREDITS);

// Ledger `source` values. IAP sources are literally `iap_${productId}`
// (productId is one of CREDIT_PRODUCT_IDS above) so this stays in sync
// with PRODUCT_HALF_CREDITS without a second map to drift.
export type LedgerSource =
  | 'iap_credits_1' | 'iap_credits_3' | 'iap_credits_5'
  | 'signup_grant' | 'promo' | 'redemption' | 'refund';

// Sources that fund a user's balance (i.e. NOT 'redemption'/'refund',
// which only ever debit it). These are the only keys that appear in
// `creditBalanceBySourceHalfCredits` and in a redemption's drawdown
// breakdown.
export type FundingSource = 'signup_grant' | 'promo' | 'iap_credits_1' | 'iap_credits_3' | 'iap_credits_5';

// ── Drawdown order (Part 5) ─────────────────────────────────────────────
// A user's balance is stored as ONE fungible total
// (`creditBalanceHalfCredits`) — we do not track individual purchase
// "lots". But payout attribution needs to know which funding source(s)
// paid for a given redemption, so we ALSO track a per-source remaining
// balance (`creditBalanceBySourceHalfCredits`) and spend deterministically
// in this fixed order, cheapest-for-Wugi first:
//   promo → signup_grant → iap_credits_1 → iap_credits_3 → iap_credits_5
// i.e. house-funded credits (promo, signup grant — flat $2.50/credit
// payout) are drawn down before any paid pack (flat $5.00/credit payout),
// and among paid packs, order doesn't matter (all three are priced
// identically) — credits_1 → credits_3 → credits_5 is simply a stable,
// arbitrary tie-break. If a redemption's cost spans more than one source
// (e.g. the user's last 1 half-credit of promo plus 1 half-credit of
// iap_credits_1 for a 1-credit unlock), the payout is split
// proportionally: each source pays out for exactly the half-credits drawn
// from it. See spendCredits.ts for the implementation.
export const DRAWDOWN_ORDER: FundingSource[] = [
  'promo', 'signup_grant', 'iap_credits_1', 'iap_credits_3', 'iap_credits_5',
];

export type CreditEconomyConfig = {
  signupGrantCredits: number;                    // full credits, clamped 1–3
  defaultPhotoCreditCostHalfCredits: number;      // half-credits, clamped {1,2}
  payoutRates: Record<FundingSource, number>;     // integer cents PER FULL CREDIT
};

// Fallback defaults — used if config/creditEconomy is missing a field (or
// the whole doc), so a bad/partial config doc fails safe instead of
// throwing for every purchase/redemption in flight.
const DEFAULT_CONFIG: CreditEconomyConfig = {
  signupGrantCredits: 2,
  defaultPhotoCreditCostHalfCredits: 2, // 1 credit
  payoutRates: {
    iap_credits_1: 500,
    iap_credits_3: 500,
    iap_credits_5: 500,
    signup_grant: 250,
    promo: 250,
  },
};

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Per-gallery photo unlock cost is restricted to EXACTLY {1, 2} half-credit
// units (½ credit or 1 credit) — never any other value, per spec. Anything
// else (including non-integers, out-of-set integers, or missing) falls
// back to `defaultPhotoCreditCostHalfCredits`. This is intentionally a
// clamp-to-nearest-valid-or-default, not a reject, because it runs on the
// READ path (pricing a redemption) where failing closed would just block
// every purchase in a gallery that has a stray/corrupt value — the write
// path (setGalleryCreditPricing) is stricter and rejects bad input outright.
export function clampPhotoCreditCostHalfCredits(value: unknown, fallback: number): number {
  const n = Number(value);
  if (n === 1 || n === 2) return n;
  return fallback === 1 || fallback === 2 ? fallback : DEFAULT_CONFIG.defaultPhotoCreditCostHalfCredits;
}

let db: admin.firestore.Firestore | null = null;
function getDb(): admin.firestore.Firestore {
  if (!db) db = admin.firestore();
  return db;
}

export async function getCreditEconomyConfig(): Promise<CreditEconomyConfig> {
  const snap = await getDb().collection('config').doc('creditEconomy').get();
  const data = snap.exists ? snap.data() || {} : {};

  const payoutRatesRaw = (data.payoutRates || {}) as Partial<Record<FundingSource, number>>;
  const payoutRates: Record<FundingSource, number> = { ...DEFAULT_CONFIG.payoutRates };
  (Object.keys(DEFAULT_CONFIG.payoutRates) as FundingSource[]).forEach((source) => {
    const v = Number(payoutRatesRaw[source]);
    if (Number.isInteger(v) && v >= 0) payoutRates[source] = v;
  });

  return {
    signupGrantCredits: clampInt(data.signupGrantCredits, 1, 3, DEFAULT_CONFIG.signupGrantCredits),
    defaultPhotoCreditCostHalfCredits: clampPhotoCreditCostHalfCredits(
      data.defaultPhotoCreditCostHalfCredits,
      DEFAULT_CONFIG.defaultPhotoCreditCostHalfCredits
    ),
    payoutRates,
  };
}

// Half-credits → display string, e.g. 1 → "½ credit", 2 → "1 credit",
// 5 → "2½ credits". Kept in sync BY HAND with the client copy in
// mobile-app/src/utils/credits.ts (no shared package between
// functions/ and mobile-app/ to import this from).
export function halfCreditsLabel(halfCredits: number): string {
  const whole = Math.floor(halfCredits / 2);
  const half = halfCredits % 2 === 1;
  if (whole === 0 && half) return '½ credit';
  const wholeStr = `${whole}${half ? '½' : ''}`;
  return `${wholeStr} credit${halfCredits === 2 ? '' : 's'}`;
}

// Rounding rule for per-source payout cents (Part 5): each source's
// contribution is computed independently as
// round(halfCreditsFromSource * centsPerCredit / 2), using standard
// round-half-up on the resulting cents value, THEN the per-source amounts
// are summed for the redemption's total payout. We deliberately round
// per-source (not on the pre-summed total) so the stored per-source
// breakdown always adds up to the stored total — no "phantom" cent from
// rounding the sum differently than the parts.
export function payoutCentsForSource(halfCreditsFromSource: number, centsPerCredit: number): number {
  return Math.round((halfCreditsFromSource * centsPerCredit) / 2);
}
