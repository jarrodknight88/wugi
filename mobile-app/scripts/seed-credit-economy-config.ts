// ─────────────────────────────────────────────────────────────────────
// Wugi — seed-credit-economy-config.ts   (firebase-admin → wugi-prod)
//
// Seeds `config/creditEconomy` — the single doc that prices the entire
// 3-SKU credit economy (Asana 1218248530084817 / issue #282): the
// signup-grant size, the default per-photo credit cost, and the per-source
// payout-rate table. functions/src/economy/creditEconomy.ts falls back to
// its own hardcoded defaults if this doc is missing/partial, so this
// script is a convenience for making the *live* config match Jarrod's
// numbers explicitly rather than relying on the code fallback.
//
// UNITS: signupGrantCredits is whole credits (1-3, int). Everything else
// credit-shaped in this repo is stored as integer HALF-credit units
// (1 credit = 2 HCU) — see creditEconomy.ts module doc comment. This doc
// has no HCU fields itself (defaultPhotoCreditCostHalfCredits is set
// directly below, already in HCU).
//
// Per-gallery overrides (photoCreditCostHalfCredits, allowed {1,2} only;
// galleryUnlockCreditsHalfCredits; promoFlag) are NOT set here — those
// live on individual `galleries/{id}` docs and are out of scope for this
// script (photographer-facing pricing UI is out of scope for v1; admin
// sets a gallery's fields directly, e.g. via the Firebase console or a
// one-off admin script).
//
// Run:  npx tsx scripts/seed-credit-economy-config.ts
// Idempotent: merge:true — re-running just touches updatedAt unless the
// constants below have changed.
//
// DO NOT execute as part of an automated workflow — Jarrod runs this
// manually after confirming the numbers against the current App Store
// Connect price tier / Apple Small Business Program status.
// ─────────────────────────────────────────────────────────────────────
import admin from 'firebase-admin';
import serviceAccount from './serviceAccount.json';

admin.initializeApp({ credential: admin.credential.cert(serviceAccount as admin.ServiceAccount) });
const db = admin.firestore();

// Jarrod 9/7 scope amendment — final for launch. Keep in sync with
// functions/src/economy/creditEconomy.ts DEFAULT_CREDIT_ECONOMY_CONFIG
// (that object is the code-level fallback if this doc is ever missing).
const CONFIG = {
  signupGrantCredits: 2, // whole credits, dial 1-3 without a deploy
  defaultPhotoCreditCostHalfCredits: 2, // 1 credit — used when a gallery has no override
  payoutRates: {
    iap_credits_1: 400, // $9.99 pack → $4.00/credit to the photographer
    iap_credits_3: 333, // $24.99 pack → $3.33/credit
    iap_credits_5: 320, // $39.99 pack → $3.20/credit
    signup_grant: 200,  // house-funded — $2.00/credit
    promo: 200,         // house-funded — $2.00/credit
  },
};

async function main() {
  console.log('Seeding config/creditEconomy…');
  await db.collection('config').doc('creditEconomy').set(
    { ...CONFIG, updatedAt: admin.firestore.Timestamp.now() },
    { merge: true }
  );
  console.log('✓ config/creditEconomy seeded:', JSON.stringify(CONFIG, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
