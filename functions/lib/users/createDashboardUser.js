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
exports.createDashboardUser = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
const auth = admin.auth();
const ALLOWED_CREATORS = {
    super_admin: ['super_admin', 'moderator', 'support', 'venue_admin', 'venue_staff', 'event_admin', 'event_staff'],
    moderator: ['venue_admin', 'venue_staff', 'event_admin', 'event_staff'],
    venue_admin: ['venue_staff', 'event_admin', 'event_staff'],
};
exports.createDashboardUser = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
    const callerDoc = await db.collection('users').doc(context.auth.uid).get();
    if (!callerDoc.exists)
        throw new functions.https.HttpsError('permission-denied', 'No user document');
    const callerRole = callerDoc.data()?.role || '';
    const { email, password, role, venueIds = [], eventIds = [], tableAccess = false } = data;
    if (!(ALLOWED_CREATORS[callerRole] || []).includes(role)) {
        throw new functions.https.HttpsError('permission-denied', `${callerRole} cannot create ${role}`);
    }
    if (callerRole === 'venue_admin') {
        const callerVenues = callerDoc.data()?.venueIds || [];
        if (venueIds.some((v) => !callerVenues.includes(v))) {
            throw new functions.https.HttpsError('permission-denied', 'Cannot assign venues you do not manage');
        }
    }
    if (!email || !password || !role) {
        throw new functions.https.HttpsError('invalid-argument', 'email, password, role required');
    }
    const userRecord = await auth.createUser({ email, password });
    await db.collection('users').doc(userRecord.uid).set({
        email, role, venueIds, eventIds,
        tableAccess: tableAccess && role === 'event_admin',
        active: true,
        createdBy: context.auth.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { uid: userRecord.uid };
});
//# sourceMappingURL=createDashboardUser.js.map