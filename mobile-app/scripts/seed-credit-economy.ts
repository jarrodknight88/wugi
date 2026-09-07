// ─────────────────────────────────────────────────────────────────────
// Wugi — seed-credit-economy.ts   (firebase-admin → wugi-prod)
//
// Seeds the single `config/creditEconomy` doc that prices the entire
// credit economy (issue #282, Part 3) — signup grant size, the default
// per-photo cost, and photographer payout rates. Read server-side by
// functions/src/unlocks/creditEconomy.ts (getCreditEconomyConfig),
// which already falls back to these exact values if the doc is missing,
// so running this script isn't strictly required for functions to work —
// it exists so the doc is EXPLICIT in Firestore (visible/editable in the
// console) rather than only living as a hardcoded fallback.
//
// Run:  npx tsx scripts/seed-credit-economy.ts
// Idempotent: deterministic doc id ('config/creditEconomy') + merge, so
// re-running just re-applies these defaults (any hand-edits made in the
// console since would be preserved for fields NOT listed below, but
// OVERWRITTEN for fields that are — this is a defaults seed, not a
// read-modify-write; don't re-run casually once real values diverge).
// ─────────────────────────────────────────────────────────────────────
import admin from 'firebase-admin';
import serviceAccount from './serviceAccount.json';

admin.initializeApp({ credential: admin.credential.cert(serviceAccount as admin.ServiceAccount) });
const db = admin.firestore();

async function main() {
  const ref = db.collection('config').doc('creditEconomy');

  await ref.set({
    // Full credits granted to every new account (onUserCreated), clamped
    // server-side to 1–3. 2 credits = one full-price gallery unlock's
    // worth of goodwill at the default per-photo rate below.
    signupGrantCredits: 2,

    // Half-credits (1 credit) — used whenever a gallery has no
    // `photoCreditCostHalfCredits` override. Per-gallery overrides are
    // restricted to {1, 2} half-credits server-side (setGalleryCreditPricing).
    defaultPhotoCreditCostHalfCredits: 2,

    // Integer CENTS PER FULL CREDIT, keyed by creditLedger `source`. The
    // three paid IAP packs are flat (no bulk-pack scaling); house-funded
    // sources (signup_grant, promo) pay out at half the paid rate — see
    // functions/src/unlocks/spendCredits.ts module doc comment for the
    // full drawdown-order rationale.
    payoutRates: {
      iap_credits_1: 500,
      iap_credits_3: 500,
      iap_credits_5: 500,
      signup_grant: 250,
      promo: 250,
    },

    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log('✓ Seeded config/creditEconomy');
  const check = await ref.get();
  console.log(check.data());
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
