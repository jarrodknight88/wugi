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
// ─────────────────────────────────────────────────────────────────────
// Wugi — sendPushNotification
// Sends FCM push notifications. Can target:
//   - A specific user by uid (looks up their fcmToken)
//   - A specific FCM token directly
//   - A topic (e.g. "atlanta-events")
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
const fcm = admin.messaging();
async function sendToUser(uid, title, body, data) {
    const userDoc = await db.collection('users').doc(uid).get();
    const token = userDoc.data()?.fcmToken;
    if (!token)
        return;
    await fcm.send({
        token,
        notification: { title, body },
        data: data ?? {},
        apns: { payload: { aps: { sound: 'default' } } },
    });
}
async function sendToTopic(topic, title, body, data) {
    await fcm.send({
        topic,
        notification: { title, body },
        data: data ?? {},
        apns: { payload: { aps: { sound: 'default' } } },
    });
}
// HTTP callable for manual sends from dashboard
exports.sendPushNotification = functions.https.onCall(async (request) => {
    const { title, body, data, uid, token, topic } = request.data;
    if (!title || !body) {
        throw new functions.https.HttpsError('invalid-argument', 'title and body are required');
    }
    try {
        if (uid) {
            await sendToUser(uid, title, body, data);
        }
        else if (token) {
            await fcm.send({ token, notification: { title, body }, data: data ?? {} });
        }
        else if (topic) {
            await sendToTopic(topic, title, body, data);
        }
        else {
            throw new functions.https.HttpsError('invalid-argument', 'Must provide uid, token, or topic');
        }
        return { success: true };
    }
    catch (e) {
        functions.logger.error('sendPushNotification error:', e);
        throw new functions.https.HttpsError('internal', 'Failed to send notification');
    }
});
//# sourceMappingURL=sendPushNotification.js.map