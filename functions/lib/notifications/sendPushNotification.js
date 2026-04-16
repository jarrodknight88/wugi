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
exports.sendPushNotification = void 0;
exports.sendToUser = sendToUser;
exports.sendToTopic = sendToTopic;
exports.sendToUserFCM = sendToUserFCM;
// ─────────────────────────────────────────────────────────────────────
// Wugi — sendPushNotification
// Primary: OneSignal REST API (S1-05)
// Legacy: FCM admin.messaging() kept for Wugi Door compatibility
// Secrets: ONESIGNAL_REST_API_KEY, ONESIGNAL_APP_ID
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
// ── OneSignal REST API helper ─────────────────────────────────────────
async function sendOneSignal(payload) {
    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    const appId = process.env.ONESIGNAL_APP_ID;
    if (!apiKey || !appId)
        throw new Error('OneSignal secrets not configured');
    const res = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Key ${apiKey}`,
        },
        body: JSON.stringify({ app_id: appId, ...payload }),
    });
    const data = await res.json();
    if (!res.ok || data.errors) {
        throw new Error(`OneSignal error: ${JSON.stringify(data.errors ?? data)}`);
    }
}
// ── Send to specific user by UID ──────────────────────────────────────
async function sendToUser(uid, title, body, data) {
    await sendOneSignal({
        headings: { en: title },
        contents: { en: body },
        data: data ?? {},
        filters: [{ field: 'external_user_id', value: uid }],
        target_channel: 'push',
    });
}
// ── Send to a topic/segment ───────────────────────────────────────────
async function sendToTopic(topic, title, body, data) {
    // Map legacy FCM topics to OneSignal segments
    const segmentMap = {
        'atlanta-events': 'All', // default segment until we set up custom segments
    };
    const segment = segmentMap[topic] ?? 'All';
    await sendOneSignal({
        headings: { en: title },
        contents: { en: body },
        data: data ?? {},
        included_segments: [segment],
        target_channel: 'push',
    });
}
// ── HTTP callable for dashboard sends ────────────────────────────────
exports.sendPushNotification = functions
    .runWith({ secrets: ['ONESIGNAL_REST_API_KEY', 'ONESIGNAL_APP_ID'] })
    .https.onCall(async (request) => {
    const { title, body, data, uid, topic } = request.data;
    if (!title || !body) {
        throw new functions.https.HttpsError('invalid-argument', 'title and body are required');
    }
    try {
        if (uid)
            await sendToUser(uid, title, body, data);
        else if (topic)
            await sendToTopic(topic, title, body, data);
        else
            throw new functions.https.HttpsError('invalid-argument', 'Must provide uid or topic');
        return { success: true };
    }
    catch (e) {
        functions.logger.error('sendPushNotification error:', e);
        throw new functions.https.HttpsError('internal', 'Failed to send notification');
    }
});
// ── Legacy FCM functions — kept for Wugi Door compatibility ──────────
// DO NOT REMOVE until [BACK-30] post-launch consolidation
// These are used by Wugi Door which still uses @react-native-firebase/messaging
async function sendToUserFCM(uid, title, body, data) {
    const userDoc = await db.collection('users').doc(uid).get();
    const token = userDoc.data()?.fcmToken;
    if (!token)
        return;
    await admin.messaging().send({
        token,
        notification: { title, body },
        data: data ?? {},
        apns: { payload: { aps: { sound: 'default' } } },
    });
}
//# sourceMappingURL=sendPushNotification.js.map