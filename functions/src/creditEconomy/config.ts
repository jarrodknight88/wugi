// ─────────────────────────────────────────────────────────────────────
// Wugi — creditEconomy/config
// Reads `config/creditEconomy` (Asana 1218248530084817 / issue #282,
// Part 3) — the server-side knobs for the credit economy, editable by
// Jarrod straight in the Firebase console with NO deploy required:
//   signupGrantCredits    — Part 4 signup grant, clamped 1–3
//   defaultPhotoCreditCost — fallback photo price when a gallery has no
//                            override, clamped 1–4
//   payoutPerCreditCents  — Part 5 photographer payout rate, no bound
//                           (Jarrod-adjustable, not user-facing)
// Falls back to hardcoded defaults if the doc doesn't exist yet — no
// manual Firestore setup is required before this deploys. Cached for
// CACHE_TTL_MS per function instance (short, not indefinite, so a config
// edit lands without redeploying AND without hammering Firestore on every
// call — mirrors the instance-lifetime caching precedent in
// functions/src/unlocks/validateUnlockPurchase.ts's Apple root certs).
// ─────────────────────────────────────────────────────────────────────
import * as admin from 'firebase-admin';

const db = admin.firestore();

export type CreditEconomyConfig = {
  signupGrantCredits: number;
  defaultPhotoCreditCost: number;
  payoutPerCreditCents: number;
};

export const DEFAULT_CREDIT_ECONOMY_CONFIG: CreditEconomyConfig = {
  signupGrantCredits: 2,
  defaultPhotoCreditCost: 1,
  payoutPerCreditCents: 175, // $1.75 — working blend across the 3 SKUs at Apple 30% + Wugi 30%-of-gross
};

export const SIGNUP_GRANT_BOUNDS = { min: 1, max: 3 } as const;
export const PHOTO_CREDIT_COST_BOUNDS = { min: 1, max: 4 } as const;

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// Exported so setGalleryCreditPricing (the client-facing write path) and
// spendCredit (the read/redeem path) apply the IDENTICAL clamp — a value
// that somehow got written out-of-bounds (hand-edited in console) is
// still clamped defensively at spend time, not just at write time.
export function clampSignupGrantCredits(value: number): number {
  return clampInt(value, SIGNUP_GRANT_BOUNDS.min, SIGNUP_GRANT_BOUNDS.max, DEFAULT_CREDIT_ECONOMY_CONFIG.signupGrantCredits);
}

export function clampPhotoCreditCost(value: number): number {
  return clampInt(value, PHOTO_CREDIT_COST_BOUNDS.min, PHOTO_CREDIT_COST_BOUNDS.max, DEFAULT_CREDIT_ECONOMY_CONFIG.defaultPhotoCreditCost);
}

let cached: CreditEconomyConfig | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

export async function getCreditEconomyConfig(): Promise<CreditEconomyConfig> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;

  const snap = await db.collection('config').doc('creditEconomy').get();
  const data = snap.exists ? snap.data() || {} : {};

  cached = {
    signupGrantCredits: clampSignupGrantCredits(Number(data.signupGrantCredits ?? DEFAULT_CREDIT_ECONOMY_CONFIG.signupGrantCredits)),
    defaultPhotoCreditCost: clampPhotoCreditCost(Number(data.defaultPhotoCreditCost ?? DEFAULT_CREDIT_ECONOMY_CONFIG.defaultPhotoCreditCost)),
    payoutPerCreditCents: Number.isFinite(Number(data.payoutPerCreditCents))
      ? Number(data.payoutPerCreditCents)
      : DEFAULT_CREDIT_ECONOMY_CONFIG.payoutPerCreditCents,
  };
  cachedAt = now;
  return cached;
}
