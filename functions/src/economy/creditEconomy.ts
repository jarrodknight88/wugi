// ─────────────────────────────────────────────────────────────────────
// Wugi — Credit Economy shared config/types (Asana 1218248530084817 /
// issue #282). Backs the 3-SKU credit economy that replaces the 2-SKU
// unlock_single_photo/unlock_gallery IAP: Apple sells CREDITS only, every
// price (photo unlock, gallery bundle, signup gift, promos) lives in
// config/creditEconomy + per-gallery overrides so Jarrod can tune without
// an App Store review cycle.
//
// UNITS: every credit amount stored in Firestore is an INTEGER
// "half-credit unit" (HCU) — 1 credit = 2 HCU, 0.5 credit = 1 HCU. The
// 9/7 scope amendment (Jarrod, voice+chat) put fractional (0.5-credit)
// photo pricing in scope; storing halves as integers avoids float/decimal
// drift in a value that is, structurally, money. Every field that holds a
// credit amount carries an explicit `HalfCredits` suffix so a future edit
// can't accidentally treat it as whole credits.
// ─────────────────────────────────────────────────────────────────────
import type * as admin from 'firebase-admin';

export const HALF_CREDITS_PER_CREDIT = 2;

// Sources that can carry a positive balance a user can spend from. Every
// grant (IAP fulfillment, signup gift, promo) increments exactly one of
// these buckets on users/{uid}.creditBalanceBySource; `redemption` and
// `refund` only ever move HCU between/out of these buckets — they are not
// buckets themselves.
export const SPENDABLE_SOURCES = ['iap_credits_1', 'iap_credits_3', 'iap_credits_5', 'signup_grant', 'promo'] as const;
export type SpendableSource = typeof SPENDABLE_SOURCES[number];

export type LedgerSource = SpendableSource | 'redemption' | 'refund';

export type CreditBalanceBySource = Partial<Record<SpendableSource, number>>;

// Fixed, documented drawdown order for redemptions — a redemption doesn't
// carry its own "source", it spends OUT of whichever buckets the user's
// balance is sitting in. House-funded credits (promo, signup gift) are
// spent before any Apple-purchased pack, and among purchased packs the
// order matches SKU list order (1-pack, then 3-pack, then 5-pack). This
// is an arbitrary but deterministic and auditable choice — it does NOT
// attempt true FIFO-by-grant-date accounting (that would require a
// per-grant lot ledger; out of scope for this task's "attribution +
// report query only" bar — see issue #282 Part 5).
export const SPEND_PRIORITY_ORDER: SpendableSource[] = [
  'promo', 'signup_grant', 'iap_credits_1', 'iap_credits_3', 'iap_credits_5',
];

// Photo credit-cost bounds (launch, Jarrod 9/7 scope amendment #3): ONLY
// 0.5 or 1 credit is a legal photoCreditCostHalfCredits value. Enforced
// HERE, not in any client UI — see clampPhotoCreditCostHalfCredits, the
// "rogue-price rail" issue #282 Part 3 requires.
export const ALLOWED_PHOTO_COST_HALF_CREDITS = new Set([1, 2]);

export type PayoutRates = Partial<Record<SpendableSource, number>>; // cents per FULL credit

export type CreditEconomyConfig = {
  signupGrantCredits: number;                // full credits, int, 1-3
  defaultPhotoCreditCostHalfCredits: number;  // HCU, used when a gallery has no override
  payoutRates: PayoutRates;                   // cents per FULL credit, keyed by grant source
};

// Working defaults (Jarrod 9/7 scope amendment #4) — used whenever
// config/creditEconomy is missing entirely or missing a field. A missing
// config doc must never silently zero out a signup grant or a payout.
export const DEFAULT_CREDIT_ECONOMY_CONFIG: CreditEconomyConfig = {
  signupGrantCredits: 2,
  defaultPhotoCreditCostHalfCredits: 2, // 1 credit
  payoutRates: {
    iap_credits_1: 400, // $9.99 pack
    iap_credits_3: 333, // $24.99 pack
    iap_credits_5: 320, // $39.99 pack
    signup_grant: 200,  // house-funded
    promo: 200,         // house-funded
  },
};

export function clampSignupGrantCredits(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1 || n > 3) return DEFAULT_CREDIT_ECONOMY_CONFIG.signupGrantCredits;
  return n;
}

export function clampPhotoCreditCostHalfCredits(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return ALLOWED_PHOTO_COST_HALF_CREDITS.has(n) ? n : fallback;
}

let cachedConfig: CreditEconomyConfig | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

// Reads config/creditEconomy, merged onto DEFAULT_CREDIT_ECONOMY_CONFIG so
// a partially-seeded doc (or none at all) never breaks a grant or
// redemption. Cached in-memory for the life of the function instance with
// a short TTL — this is pricing config Jarrod dials live; a stale read for
// up to a minute is an acceptable tradeoff against a Firestore read on
// every single grant/redemption call.
export async function getCreditEconomyConfig(db: admin.firestore.Firestore): Promise<CreditEconomyConfig> {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CACHE_TTL_MS) return cachedConfig;

  const snap = await db.collection('config').doc('creditEconomy').get();
  const data = snap.exists ? (snap.data() as Record<string, unknown>) : {};

  const merged: CreditEconomyConfig = {
    signupGrantCredits: clampSignupGrantCredits(
      data.signupGrantCredits ?? DEFAULT_CREDIT_ECONOMY_CONFIG.signupGrantCredits
    ),
    defaultPhotoCreditCostHalfCredits: clampPhotoCreditCostHalfCredits(
      data.defaultPhotoCreditCostHalfCredits,
      DEFAULT_CREDIT_ECONOMY_CONFIG.defaultPhotoCreditCostHalfCredits
    ),
    payoutRates: { ...DEFAULT_CREDIT_ECONOMY_CONFIG.payoutRates, ...(data.payoutRates as PayoutRates || {}) },
  };
  cachedConfig = merged;
  cachedAt = now;
  return merged;
}

export function payoutCentsForHalfCredits(source: SpendableSource, halfCredits: number, rates: PayoutRates): number {
  const centsPerCredit = rates[source] ?? DEFAULT_CREDIT_ECONOMY_CONFIG.payoutRates[source] ?? 0;
  return Math.round((centsPerCredit * halfCredits) / HALF_CREDITS_PER_CREDIT);
}

export type RedemptionBreakdownEntry = {
  source: SpendableSource;
  halfCredits: number;
  payoutCents: number;
};

export type RedemptionResult = {
  breakdown: RedemptionBreakdownEntry[];
  newBalanceBySource: CreditBalanceBySource;
  totalPayoutCents: number;
};

// Pure function — walks SPEND_PRIORITY_ORDER, draws down `costHalfCredits`
// from whichever buckets have balance, and prices each drawn slice at that
// bucket's payout rate (so a 0.5-credit redemption pays half the source's
// per-credit rate, per issue #282 Part 5 amendment). Callers must have
// already verified sum(balanceBySource) >= costHalfCredits — this throws
// rather than silently under-charging if that invariant is violated, since
// it directly feeds the payout ledger.
export function computeRedemptionBreakdown(
  balanceBySource: CreditBalanceBySource,
  costHalfCredits: number,
  rates: PayoutRates
): RedemptionResult {
  let remaining = costHalfCredits;
  const newBalanceBySource: CreditBalanceBySource = { ...balanceBySource };
  const breakdown: RedemptionBreakdownEntry[] = [];

  for (const source of SPEND_PRIORITY_ORDER) {
    if (remaining <= 0) break;
    const available = newBalanceBySource[source] || 0;
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    newBalanceBySource[source] = available - take;
    breakdown.push({ source, halfCredits: take, payoutCents: payoutCentsForHalfCredits(source, take, rates) });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error(`computeRedemptionBreakdown: insufficient balance, ${remaining} half-credits unaccounted for`);
  }

  return {
    breakdown,
    newBalanceBySource,
    totalPayoutCents: breakdown.reduce((sum, b) => sum + b.payoutCents, 0),
  };
}
