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
exports.onVenueChargebackUpdate = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — Chargeback Suspension
//
// Fires when a chargeback doc is updated.
// If venue chargebackBalance exceeds threshold and is unpaid,
// triggers account suspension.
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
// Suspend venue if outstanding chargeback balance > $50
const SUSPENSION_THRESHOLD_CENTS = 5000;
exports.onVenueChargebackUpdate = functions.firestore
    .document('chargebacks/{chargebackId}')
    .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();
    // Only act when a chargeback is lost and venue billed directly
    if (before.status === after.status ||
        after.status !== 'lost' ||
        !after.venueBilledDirectly) {
        return;
    }
    const venueId = after.venueId;
    const venueRef = db.collection('venues').doc(venueId);
    const venueDoc = await venueRef.get();
    const venue = venueDoc.data();
    if (!venue)
        return;
    const outstandingBalance = venue.chargebackBalance ?? 0;
    // Check if suspension threshold exceeded
    if (outstandingBalance >= SUSPENSION_THRESHOLD_CENTS &&
        !venue.chargebackSuspended) {
        await venueRef.update({
            chargebackSuspended: true,
            chargebackSuspendedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Update chargeback doc to note suspension triggered
        await change.after.ref.update({
            suspensionTriggered: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Increment admin badge
        await db.collection('config').doc('admin').set({
            suspendedVenueCount: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        logger.warn(`Venue ${venueId} suspended`, {
            outstandingBalance,
            chargebackId: change.after.id,
        });
    }
});
//# sourceMappingURL=chargebackSuspension.js.map