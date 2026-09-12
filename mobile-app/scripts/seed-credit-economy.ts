// ─────────────────────────────────────────────────────────────────────
// Wugi — seed-credit-economy.ts   (firebase-admin → wugi-prod)
//
// Seeds config/creditEconomy — the server-side pricing knobs for the
// credit economy (Asana 1218248530084817 / issue #282). See
// functions/src/credits/creditEconomy.ts for the full field
// documentation and how each value is clamped/consumed.
//
// UNITS: signupGrantCredits and defaultPhotoCreditCost are written here
// as ordinary numbers (full/half credits) — creditEconomy.ts converts to
// integer half-credit units on read. Only the STORED ledger/balance
// fields elsewhere are half-credit-unit integers; this config doc is
// meant to be hand-edited in the Firebase console, so it stays in
// human-friendly units.
//
// signupGrantCredits: 0 IS a VALID value (DELTA 2, 9/12) — it turns the
// signup gift off entirely. onUserCreated's grant step treats 0 as a
// clean no-op: no ledger entry, no balance mutation, just a log line.
// Valid range is 0–3 (integer full credits).
//
// Run:  npx tsx scripts/seed-credit-economy.ts
// Idempotent: merge:true, so re-running only touches what you edit below.
// ─────────────────────────────────────────────────────────────────────
import admin from 'firebase-admin';
import serviceAccount from './serviceAccount.json';

admin.initializeApp({ credential: admin.credential.cert(serviceAccount as admin.ServiceAccount) });
const db = admin.firestore();

const CREDIT_ECONOMY_CONFIG = {
  // Launch default (Jarrod 9/7): 2 credits. Valid range 0–3 (DELTA 2)
  // — 0 turns the signup gift off.
  signupGrantCredits: 2,

  // Default per-photo cost when a gallery has no photoCreditCost override.
  // Launch allowed values are {0.5, 1} only — anything else gets clamped
  // server-side on read.
  defaultPhotoCreditCost: 1,

  // Cents per FULL credit, keyed by ledger source. A 0.5-credit redemption
  // pays half. Jarrod 9/7 evening (final payout model): flat rate across
  // all three paid packs; house-funded grants pay a lower flat rate.
  payoutRates: {
    iap_credits_1: 500,
    iap_credits_3: 500,
    iap_credits_5: 500,
    signup_grant: 250,
    promo: 250,
  },

  // DELTA 4 (9/12): promo-window signup grants. Schema + server logic
  // only for this task — the dashboard editor UI for this is explicitly
  // a LATER task, not built here. Uncomment and adjust dates to run a
  // promo; `enabled: false` (or omitting this field entirely) means
  // every signup gets the standard `signupGrantCredits` above.
  //
  // signupPromo: {
  //   enabled: true,
  //   grantCredits: 5, // integer full credits, clamped 0–10
  //   startsAt: admin.firestore.Timestamp.fromDate(new Date('2026-10-01T00:00:00Z')),
  //   endsAt:   admin.firestore.Timestamp.fromDate(new Date('2026-10-08T00:00:00Z')),
  // },
};

async function main(): Promise<void> {
  await db.collection('config').doc('creditEconomy').set(
    { ...CREDIT_ECONOMY_CONFIG, updatedAt: admin.firestore.Timestamp.now() },
    { merge: true }
  );
  console.log('Seeded config/creditEconomy:', CREDIT_ECONOMY_CONFIG);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
