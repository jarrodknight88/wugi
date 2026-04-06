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
exports.generateDoorPin = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — generateDoorPin Cloud Function
// Generates a 6-digit PIN for venue-level or event-level door access.
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
function randomPin() {
    return String(Math.floor(100000 + Math.random() * 900000));
}
exports.generateDoorPin = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
    }
    const { scope, // 'venue' | 'event'
    venueId, venueName, venueLatitude, venueLongitude, eventId, eventName, eventDate, label, expiresInHours, } = data;
    if (!scope || !venueId) {
        throw new functions.https.HttpsError('invalid-argument', 'scope and venueId are required');
    }
    // Deactivate existing active PINs for this exact scope
    let query = db.collection('eventPins')
        .where('venueId', '==', venueId)
        .where('active', '==', true)
        .where('scope', '==', scope);
    if (scope === 'event' && eventId) {
        query = query.where('eventId', '==', eventId);
    }
    const existing = await query.get();
    const batch = db.batch();
    existing.docs.forEach(doc => batch.update(doc.ref, {
        active: false,
        deactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }));
    // Build new PIN doc
    const pin = randomPin();
    const expiresAt = expiresInHours
        ? admin.firestore.Timestamp.fromDate(new Date(Date.now() + expiresInHours * 60 * 60 * 1000))
        : null;
    const pinDoc = {
        pin,
        scope,
        venueId,
        venueName: venueName || '',
        venueLatitude: venueLatitude || null,
        venueLongitude: venueLongitude || null,
        active: true,
        label: label || (scope === 'venue' ? 'Venue Access' : 'Event Access'),
        role: 'door',
        createdBy: context.auth.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt,
    };
    if (scope === 'event') {
        pinDoc.eventId = eventId || null;
        pinDoc.eventName = eventName || '';
        pinDoc.date = eventDate || '';
    }
    const pinRef = db.collection('eventPins').doc();
    batch.set(pinRef, pinDoc);
    await batch.commit();
    return { pin, pinId: pinRef.id };
});
//# sourceMappingURL=generateDoorPin.js.map