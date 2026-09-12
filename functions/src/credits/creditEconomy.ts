// ─────────────────────────────────────────────────────────────────────
// Wugi — creditEconomy
// Server-side pricing config for the credit economy (Asana 1218248530084817
// / issue #282). Apple only ever sells CREDITS (validateUnlockPurchase.ts)
// — every other price a user or photographer sees (signup gift, photo
// unlock cost, payout rate) lives in `config/creditEconomy` instead, so
// Jarrod can retune the economy with a Firestore write instead of an App
// Store review cycle.
//
// UNITS: credits are stored EVERYWHERE as integer HALF-CREDIT UNITS (1
// credit == 2 units) — never as a float or decimal (Jarrod 9/7: "never
// floats, never decimals in storage"). This is what makes a 0.5-credit
// photo representable without floating-point drift accumulating across
// thousands of ledger entries. `creditsToHalfUnits`/`halfUnitsToCredits`
// below are the only place that conversion should happen — every other
// module works exclusively in half-unit integers.
// ─────────────────────────────────────────────────────────────────────
import * as admin from 'firebase-admin';

function db() {
  return admin.firestore();
}

export const CONFIG_DOC_ID = 'creditEconomy';

// The full closed set of ledger sources. Keep in sync with
// firebase/firestore.rules (creditLedger match block) and the mobile
// display helper (mobile-app/src/utils/credits.ts).
export type CreditLedgerSource =
  | 'iap_credits_1'
  | 'iap_credits_3'
  | 'iap_credits_5'
  | 'signup_grant'
  | 'promo'
  | 'redemption'
  | 'refund';

// Fixed drawdown order when SPENDING credits — house-funded sources go
// first (they cost Wugi nothing sitting unused in a balance; paid credits
// are drawn down last so a user's real money purchase lasts as long as
// possible). spendCredits.ts and the payout attribution both depend on
// this exact order — documented once, here.
export const DRAWDOWN_ORDER: CreditLedgerSource[] = [
  'promo', 'signup_grant', 'iap_credits_1', 'iap_credits_3', 'iap_credits_5',
];

export const PAID_SOURCES: ReadonlySet<CreditLedgerSource> = new Set(['iap_credits_1', 'iap_credits_3', 'iap_credits_5']);

// credits_1/3/5 SKUs → full credits granted per pack (Jarrod 9/7 scope
// amendment). Prices ($9.99/$24.99/$39.99) live only in App Store Connect
// + mobile-app/src/lib/iap.ts display copy — Apple is the price source of
// truth for what the SKU costs; this map is only "how many credits".
export const CREDIT_PACKS: Record<string, { source: CreditLedgerSource; credits: number }> = {
  credits_1: { source: 'iap_credits_1', credits: 1 },
  credits_3: { source: 'iap_credits_3', credits: 3 },
  credits_5: { source: 'iap_credits_5', credits: 5 },
};

export function creditsToHalfUnits(credits: number): number {
  return Math.round(credits * 2);
}
export function halfUnitsToCredits(halfUnits: number): number {
  return halfUnits / 2;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

export type SignupPromo = {
  enabled: boolean;
  grantCreditsHalfUnits: number;
  startsAt: admin.firestore.Timestamp;
  endsAt: admin.firestore.Timestamp;
};

export type CreditEconomyConfig = {
  // DELTA 2 (9/12): clamp widened to 0–3 integer full credits. 0 means the
  // signup gift is off entirely (grantSignupCredits skips cleanly — no
  // ledger entry, no balance mutation).
  signupGrantCreditsHalfUnits: number;
  defaultPhotoCreditCostHalfUnits: number;
  // Launch bounds are an ALLOWED SET, not a continuous range — {0.5, 1}
  // credit only (Jarrod 9/7: "1 credit is the cap — no 2+ credit photos").
  // Because these are integer half-credit units, min=1/max=2 IS that set;
  // there is no representable value between them.
  photoCreditCostBoundsHalfUnits: { min: number; max: number };
  // Cents per FULL credit, keyed by ledger source. A 0.5-credit redemption
  // pays half. Jarrod 9/7 evening (final): flat 500¢ for all three paid
  // packs, 250¢ house-funded for signup_grant/promo. Keeping the table
  // keyed by source (rather than a single flat constant) is deliberate —
  // it's what lets Apple Small Business Program enrollment later become a
  // config edit instead of a code change.
  payoutRatesCentsPerCredit: Record<string, number>;
  // DELTA 4 (9/12): optional promo-window signup grant. Dashboard editor
  // UI is explicitly a LATER task — this is schema + server logic only.
  // Shape for that future editor to write against:
  //   config/creditEconomy.signupPromo = {
  //     enabled: boolean,
  //     grantCredits: number,   // integer full credits, clamped 0–10
  //     startsAt: Timestamp,
  //     endsAt: Timestamp,
  //   }
  // Missing/partial/invalid object (wrong types, missing field) MUST
  // behave exactly as if there were no promo at all — fail safe to the
  // standard signupGrantCredits grant, never throw.
  signupPromo: SignupPromo | null;
};

const DEFAULT_PHOTO_COST_BOUNDS_CREDITS = { min: 0.5, max: 1 };

const DEFAULTS: CreditEconomyConfig = {
  signupGrantCreditsHalfUnits: creditsToHalfUnits(2),
  defaultPhotoCreditCostHalfUnits: creditsToHalfUnits(1),
  photoCreditCostBoundsHalfUnits: {
    min: creditsToHalfUnits(DEFAULT_PHOTO_COST_BOUNDS_CREDITS.min),
    max: creditsToHalfUnits(DEFAULT_PHOTO_COST_BOUNDS_CREDITS.max),
  },
  payoutRatesCentsPerCredit: {
    iap_credits_1: 500,
    iap_credits_3: 500,
    iap_credits_5: 500,
    signup_grant: 250,
    promo: 250,
  },
  signupPromo: null,
};

// DELTA 4: parses config/creditEconomy.signupPromo defensively. Any
// missing/malformed field returns null (== "no promo"), never throws —
// onUserCreated's grant step falls back to the standard grant in that case.
function parseSignupPromo(raw: unknown): SignupPromo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== 'boolean') return null;
  if (typeof r.grantCredits !== 'number' || !Number.isFinite(r.grantCredits)) return null;
  if (!(r.startsAt instanceof admin.firestore.Timestamp)) return null;
  if (!(r.endsAt instanceof admin.firestore.Timestamp)) return null;

  const grantCredits = clampInt(r.grantCredits, 0, 10);
  return {
    enabled: r.enabled,
    grantCreditsHalfUnits: creditsToHalfUnits(grantCredits),
    startsAt: r.startsAt,
    endsAt: r.endsAt,
  };
}

function parsePayoutRates(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS.payoutRatesCentsPerCredit };
  const merged: Record<string, number> = { ...DEFAULTS.payoutRatesCentsPerCredit };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      merged[key] = Math.round(value);
    }
  }
  return merged;
}

// Reads config/creditEconomy, applying defaults + server-side clamps to
// every field — this is the ONLY place other than setGalleryCreditPricing
// (per-gallery override) that pricing bounds are enforced, and it's read
// fresh on every call rather than cached, so a Firestore-only pricing
// change (no redeploy) takes effect immediately.
export async function getCreditEconomyConfig(): Promise<CreditEconomyConfig> {
  const snap = await db().collection('config').doc(CONFIG_DOC_ID).get();
  if (!snap.exists) return DEFAULTS;
  const d = snap.data() || {};

  const signupGrantCredits = typeof d.signupGrantCredits === 'number'
    ? clampInt(d.signupGrantCredits, 0, 3)
    : halfUnitsToCredits(DEFAULTS.signupGrantCreditsHalfUnits);

  const photoCreditCostBoundsHalfUnits = {
    min: creditsToHalfUnits(DEFAULT_PHOTO_COST_BOUNDS_CREDITS.min),
    max: creditsToHalfUnits(DEFAULT_PHOTO_COST_BOUNDS_CREDITS.max),
  };

  const defaultPhotoCreditCost = typeof d.defaultPhotoCreditCost === 'number'
    ? d.defaultPhotoCreditCost
    : halfUnitsToCredits(DEFAULTS.defaultPhotoCreditCostHalfUnits);

  const defaultPhotoCreditCostHalfUnits = clampInt(
    creditsToHalfUnits(defaultPhotoCreditCost),
    photoCreditCostBoundsHalfUnits.min,
    photoCreditCostBoundsHalfUnits.max,
  );

  return {
    signupGrantCreditsHalfUnits: creditsToHalfUnits(signupGrantCredits),
    defaultPhotoCreditCostHalfUnits,
    photoCreditCostBoundsHalfUnits,
    payoutRatesCentsPerCredit: parsePayoutRates(d.payoutRates),
    signupPromo: parseSignupPromo(d.signupPromo),
  };
}

// Clamps a photographer/admin-supplied photo credit cost into the launch
// allowed set ({0.5, 1} credit) — the "rogue-price rail" from Part 3. Used
// both at write time (setGalleryCreditPricing) and defensively again at
// spend time (spendCredits) in case the gallery doc was ever written by
// something other than that callable.
export function clampPhotoCreditCostHalfUnits(halfUnits: number, config: CreditEconomyConfig): number {
  return clampInt(halfUnits, config.photoCreditCostBoundsHalfUnits.min, config.photoCreditCostBoundsHalfUnits.max);
}

// cents per FULL credit → cents owed for redeeming `halfUnits` of `source`.
export function payoutCentsForRedemption(source: string, halfUnits: number, config: CreditEconomyConfig): number {
  const rate = config.payoutRatesCentsPerCredit[source] ?? 0;
  return Math.round((rate * halfUnits) / 2);
}
