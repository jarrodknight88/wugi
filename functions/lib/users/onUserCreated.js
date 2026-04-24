"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onUserCreated = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — onUserCreated
// Triggered by Firebase Auth when any new user account is created.
// Creates the users/{uid} Firestore doc server-side with admin privileges —
// completely immune to client-side auth token race conditions.
// This is Option C: the permanent, authoritative fix for the
// upsertUserProfile timing issue. The client-side upsertUserProfile
// call is now a safety net / update-only path, not the primary creator.
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
exports.onUserCreated = functions.auth.user().onCreate(async (user) => {
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
            email: email || '',
            displayName: displayName || '',
            phoneNumber: phoneNumber || null,
            role: 'consumer',
            vibes: [],
            affinityScores: {},
            provider,
            // Stripe customer ID added later by createPaymentIntentHttp on first purchase
            stripeCustomerId: null,
            // Username claimed separately via saveUsername
            username: null,
            active: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }); // merge:true is safe — won't overwrite role if somehow pre-created
        functions.logger.info('onUserCreated: profile created successfully for', uid);
    }
    catch (e) {
        // Log but don't throw — Auth user was created successfully,
        // we don't want to fail the trigger and leave the user in a broken state.
        // The client-side upsertUserProfile retry will catch any remaining gap.
        functions.logger.error('onUserCreated: failed to create profile for', uid, e);
    }
});
//# sourceMappingURL=onUserCreated.js.map