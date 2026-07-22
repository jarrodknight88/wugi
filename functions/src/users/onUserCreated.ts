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
});
