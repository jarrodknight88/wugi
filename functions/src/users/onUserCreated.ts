// ─────────────────────────────────────────────────────────────────────
// Wugi — onUserCreated
// Triggered by Firebase Auth when any new user account is created.
// Creates the users/{uid} Firestore doc server-side with admin privileges —
// completely immune to client-side auth token race conditions.
// This is Option C: the permanent, authoritative fix for the
// upsertUserProfile timing issue. The client-side upsertUserProfile
// call is now a safety net / update-only path, not the primary creator.
//
// Also grants the signup credit pack (issue #282, Part 4) — config-driven
// via config/creditEconomy.signupGrantCredits (default 2, clamped 1–3).
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { getCreditEconomyConfig } from '../unlocks/creditEconomy';

const db = admin.firestore();

// Idempotent per uid: the ledger entry doc id is deterministic
// ('signup_grant'), so a retried trigger invocation (or a client-side
// upsertUserProfile racing in) sees the ledger doc already exists and
// no-ops instead of double-granting. Runs as its own transaction,
// separate from the user-doc `set` above, so it can safely re-read
// whatever balance already exists (defends against the merge:true user
// doc write and this grant racing each other in unexpected orders).
async function grantSignupCredits(uid: string): Promise<void> {
  const config = await getCreditEconomyConfig();
  const halfCredits = config.signupGrantCredits * 2;

  const userRef = db.collection('users').doc(uid);
  const ledgerRef = userRef.collection('creditLedger').doc('signup_grant');

  await db.runTransaction(async (tx) => {
    const [ledgerSnap, userSnap] = await Promise.all([tx.get(ledgerRef), tx.get(userRef)]);
    if (ledgerSnap.exists) return; // already granted — idempotent no-op

    const currentBalance: number = userSnap.exists ? (userSnap.data()?.creditBalanceHalfCredits ?? 0) : 0;
    const currentBySource: Record<string, number> =
      userSnap.exists ? (userSnap.data()?.creditBalanceBySourceHalfCredits ?? {}) : {};
    const balanceAfterHalfCredits = currentBalance + halfCredits;
    const newBySource = { ...currentBySource, signup_grant: (currentBySource.signup_grant ?? 0) + halfCredits };
    const now = admin.firestore.FieldValue.serverTimestamp();

    tx.set(ledgerRef, {
      source: 'signup_grant',
      deltaHalfCredits: halfCredits,
      balanceAfterHalfCredits,
      ts: now,
      ref: 'signup_grant',
    });
    tx.set(userRef, {
      creditBalanceHalfCredits: balanceAfterHalfCredits,
      creditBalanceBySourceHalfCredits: newBySource,
      updatedAt: now,
    }, { merge: true });
  });
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
      // Evergreen, no-expiry HD unlock credit — one per account. Consumed
      // transactionally by spendFreeUnlock (functions/src/unlocks).
      freeUnlockUsed: false,
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

  try {
    await grantSignupCredits(uid);
    functions.logger.info('onUserCreated: signup credit grant complete for', uid);
  } catch (e) {
    // Same fail-open philosophy as above — don't leave the Auth user in a
    // broken state over a missing signup bonus. grantSignupCredits is
    // idempotent (deterministic ledger doc id), so this is safe to retry
    // out-of-band (e.g. a support script) without double-granting.
    functions.logger.error('onUserCreated: failed to grant signup credits for', uid, e);
  }
});
