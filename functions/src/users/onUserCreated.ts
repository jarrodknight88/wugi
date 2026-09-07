// ─────────────────────────────────────────────────────────────────────
// Wugi — onUserCreated
// Triggered by Firebase Auth when any new user account is created.
// Creates the users/{uid} Firestore doc server-side with admin privileges —
// completely immune to client-side auth token race conditions.
// This is Option C: the permanent, authoritative fix for the
// upsertUserProfile timing issue. The client-side upsertUserProfile
// call is now a safety net / update-only path, not the primary creator.
//
// Also grants the config-driven signup credit (Asana 1218248530084817 /
// issue #282, Part 4) — see grantSignupCredits below. Kept as a separate
// try/catch AFTER the profile write so a grant failure never blocks
// account creation, the more critical path.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { getCreditEconomyConfig } from '../creditEconomy/config';

const db = admin.firestore();

// Idempotent per uid via a DETERMINISTIC ledger doc id (`signup_grant`) —
// auth triggers can retry on failure, and a second invocation must not
// double-grant. Transactional so the ledger entry and the denormalized
// `creditBalance` cache never drift apart.
async function grantSignupCredits(uid: string): Promise<void> {
  const userRef = db.collection('users').doc(uid);
  const ledgerRef = userRef.collection('creditLedger').doc('signup_grant');
  const config = await getCreditEconomyConfig();

  await db.runTransaction(async (tx) => {
    const [userSnap, ledgerSnap] = await Promise.all([tx.get(userRef), tx.get(ledgerRef)]);
    if (ledgerSnap.exists) return; // already granted — idempotent no-op

    const currentBalance = userSnap.exists ? Number(userSnap.data()?.creditBalance ?? 0) : 0;
    const newBalance = currentBalance + config.signupGrantCredits;
    const now = admin.firestore.FieldValue.serverTimestamp();

    tx.set(ledgerRef, {
      source: 'signup_grant',
      delta: config.signupGrantCredits,
      balanceAfter: newBalance,
      ts: now,
      ref: null,
    });
    tx.set(userRef, { creditBalance: newBalance, updatedAt: now }, { merge: true });
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
      // Defensive default in case grantSignupCredits below fails entirely —
      // overwritten with the real grant a moment later on the happy path.
      creditBalance: 0,
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
    functions.logger.info('onUserCreated: granted signup credits for', uid);
  } catch (e) {
    functions.logger.error('onUserCreated: failed to grant signup credits for', uid, e);
  }
});
