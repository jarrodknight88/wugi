// ─────────────────────────────────────────────────────────────────────
// Wugi — onUserCreated
// Triggered by Firebase Auth when any new user account is created.
// Creates the users/{uid} Firestore doc server-side with admin privileges —
// completely immune to client-side auth token race conditions.
// This is Option C: the permanent, authoritative fix for the
// upsertUserProfile timing issue. The client-side upsertUserProfile
// call is now a safety net / update-only path, not the primary creator.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { getCreditEconomyConfig, HALF_CREDITS_PER_CREDIT } from '../economy/creditEconomy';

const db = admin.firestore();

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
      // Evergreen, no-expiry HD unlock credit — one per account. Consumed
      // transactionally by spendFreeUnlock (functions/src/unlocks). Separate
      // mechanic from the credit economy below — not a "credit".
      freeUnlockUsed: false,
      // Credit economy (Asana 1218248530084817 / issue #282) — balance in
      // integer half-credit units (HCU), see functions/src/economy/
      // creditEconomy.ts. The signup grant itself is applied by
      // grantSignupCredits() below, AFTER this doc exists.
      creditBalanceHalfCredits: 0,
      creditBalanceBySource: {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });  // merge:true is safe — won't overwrite role if somehow pre-created

    functions.logger.info('onUserCreated: profile created successfully for', uid);
  } catch (e) {
    // Log but don't throw — Auth user was created successfully,
    // we don't want to fail the trigger and leave the user in a broken state.
    // The client-side upsertUserProfile retry will catch any remaining gap.
    functions.logger.error('onUserCreated: failed to create profile for', uid, e);
  }

  // Signup credit grant (Part 4) — config-driven (1-3 full credits,
  // launch default 2) so Jarrod can dial the amount without a deploy.
  // Separate try/catch from profile creation: a grant failure must never
  // be conflated with "no profile".
  try {
    await grantSignupCredits(uid);
  } catch (e) {
    functions.logger.error('onUserCreated: signup credit grant failed for', uid, e);
  }
});

async function grantSignupCredits(uid: string): Promise<void> {
  const config = await getCreditEconomyConfig(db);
  const halfCredits = config.signupGrantCredits * HALF_CREDITS_PER_CREDIT;

  const userRef = db.collection('users').doc(uid);
  // Deterministic doc id — idempotent per uid (issue #282 Part 4) even if
  // this trigger somehow re-fires (Cloud Functions triggers are
  // at-least-once delivery, not exactly-once).
  const ledgerRef = userRef.collection('creditLedger').doc('signup_grant');

  await db.runTransaction(async (tx) => {
    const [ledgerSnap, userSnap] = await Promise.all([tx.get(ledgerRef), tx.get(userRef)]);
    if (ledgerSnap.exists) return; // already granted

    const currentBalance: number = userSnap.data()?.creditBalanceHalfCredits || 0;
    const currentBucket: number = userSnap.data()?.creditBalanceBySource?.signup_grant || 0;
    const newBalance = currentBalance + halfCredits;
    const now = admin.firestore.FieldValue.serverTimestamp();

    tx.set(ledgerRef, {
      source: 'signup_grant',
      deltaHalfCredits: halfCredits,
      balanceAfterHalfCredits: newBalance,
      ts: now,
      ref: uid,
    });
    tx.update(userRef, {
      creditBalanceHalfCredits: newBalance,
      'creditBalanceBySource.signup_grant': currentBucket + halfCredits,
    });
  });
}
