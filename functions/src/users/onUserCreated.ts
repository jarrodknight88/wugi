// ─────────────────────────────────────────────────────────────────────
// Wugi — onUserCreated
// Triggered by Firebase Auth when any new user account is created.
// Creates the users/{uid} Firestore doc server-side with admin privileges —
// completely immune to client-side auth token race conditions.
// This is Option C: the permanent, authoritative fix for the
// upsertUserProfile timing issue. The client-side upsertUserProfile
// call is now a safety net / update-only path, not the primary creator.
//
// DELTA 3 (Jarrod/PM 9/12): the evergreen free HD-unlock credit is
// retired from the product surface — new accounts no longer get a
// `freeUnlockUsed` flag at all. Credits (via the signup grant below) are
// the only giveaway mechanism now. `spendFreeUnlock` itself stays
// deployed and exported untouched (decommissioning it is a separate
// post-launch cleanup) — it just never gets offered to new accounts.
//
// Signup credit grant (Part 4, DELTA 2, DELTA 4): idempotent per uid via
// a deterministic `creditLedger` doc id ('signup') regardless of which
// path granted it. DELTA 2 widens the standard grant's clamp to 0–3 — 0
// means the gift is off, and grants NO ledger entry / NO balance
// mutation (a clean, logged no-op), not a zero-amount write. DELTA 4:
// if config/creditEconomy.signupPromo is enabled and `now` falls inside
// its [startsAt, endsAt] window, that promo amount is granted instead
// with ledger source 'promo'; any missing/malformed signupPromo object
// falls back to the standard grant exactly as if no promo existed.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { getCreditEconomyConfig, CreditLedgerSource } from '../credits/creditEconomy';

const db = admin.firestore();

async function grantSignupCredits(uid: string): Promise<void> {
  const config = await getCreditEconomyConfig();
  const now = admin.firestore.Timestamp.now();

  let source: CreditLedgerSource = 'signup_grant';
  let amountHalfUnits = config.signupGrantCreditsHalfUnits;

  const promo = config.signupPromo;
  if (promo && promo.enabled && now.toMillis() >= promo.startsAt.toMillis() && now.toMillis() <= promo.endsAt.toMillis()) {
    source = 'promo';
    amountHalfUnits = promo.grantCreditsHalfUnits;
  }

  // DELTA 2: 0 is a valid, config-driven "gift is off" — skip cleanly,
  // still log, write nothing (no ledger entry, no balance mutation).
  if (amountHalfUnits <= 0) {
    functions.logger.info('grantSignupCredits: skipped, 0 credits configured', { uid, source });
    return;
  }

  const userRef = db.collection('users').doc(uid);
  // Deterministic doc id regardless of which branch (standard vs promo)
  // granted it — this IS the idempotency guard against onUserCreated
  // retrying after a transient failure.
  const ledgerRef = userRef.collection('creditLedger').doc('signup');

  await db.runTransaction(async (tx) => {
    const [ledgerSnap, userSnap] = await Promise.all([tx.get(ledgerRef), tx.get(userRef)]);
    if (ledgerSnap.exists) {
      functions.logger.info('grantSignupCredits: already granted, skipping', { uid });
      return;
    }

    const currentTotal: number = userSnap.data()?.creditBalanceHalfUnits || 0;
    const balanceBySource: Record<string, number> = userSnap.data()?.creditBalanceBySourceHalfUnits || {};
    const newTotal = currentTotal + amountHalfUnits;
    const nextBalanceBySource = { ...balanceBySource, [source]: (balanceBySource[source] || 0) + amountHalfUnits };
    const writeTs = admin.firestore.FieldValue.serverTimestamp();

    tx.set(ledgerRef, {
      source,
      delta: amountHalfUnits,
      ts: writeTs,
      ref: { reason: source === 'promo' ? 'signup_promo' : 'signup_standard' },
      balanceAfterHalfUnits: newTotal,
    });
    tx.update(userRef, {
      creditBalanceHalfUnits: newTotal,
      creditBalanceBySourceHalfUnits: nextBalanceBySource,
      updatedAt: writeTs,
    });
  });

  functions.logger.info('grantSignupCredits: granted', { uid, source, amountHalfUnits });
}

export const onUserCreated = functions.auth.user().onCreate(async (user) => {
  const { uid, email, displayName, phoneNumber, providerData } = user;

  // Determine sign-in provider for analytics
  const provider = providerData?.[0]?.providerId || 'password';

  functions.logger.info('onUserCreated: creating profile for', uid, email);

  try {
    const userRef = db.collection('users').doc(uid);

    // Use set with merge:false — this is a brand new account, doc should not exist.
    // If somehow it already exists (race with client), merge:true protects existing data.
    await userRef.set({
      uid,
      email:        email        || '',
      displayName:  displayName  || '',
      phoneNumber:  phoneNumber  || null,
      role:         'consumer',
      vibes:        [],
      affinityScores: {},
      provider,
      // Stripe customer ID added later by createPaymentIntentHttp on first purchase
      stripeCustomerId: null,
      // Username claimed separately via saveUsername
      username: null,
      active: true,
      // Credit-economy balance (Asana 1218248530084817 / issue #282),
      // stored as integer half-credit units — see functions/src/credits/
      // creditEconomy.ts. Mutated ONLY by Cloud Function transactions
      // (validateUnlockPurchase, spendCredits, grantSignupCredits below);
      // firebase/firestore.rules blocks every client write path to these
      // fields, including admin roles.
      creditBalanceHalfUnits: 0,
      creditBalanceBySourceHalfUnits: {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });  // merge:true is safe — won't overwrite role if somehow pre-created

    functions.logger.info('onUserCreated: profile created successfully for', uid);

    try {
      await grantSignupCredits(uid);
    } catch (e) {
      // Same policy as the profile write below: log, don't throw — a
      // failed signup grant shouldn't leave a new account in a broken
      // state. Worst case the user starts with 0 credits instead of the
      // configured gift; there is no retry path today.
      functions.logger.error('onUserCreated: signup credit grant failed for', uid, e);
    }
  } catch (e) {
    // Log but don't throw — Auth user was created successfully,
    // we don't want to fail the trigger and leave the user in a broken state.
    // The client-side upsertUserProfile retry will catch any remaining gap.
    functions.logger.error('onUserCreated: failed to create profile for', uid, e);
  }
});
