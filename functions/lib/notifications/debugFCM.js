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
exports.debugFCM = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — debugFCM
// Called from the app to debug FCM token registration
// Returns exactly what the server sees
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
const fcm = admin.messaging();
exports.debugFCM = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    const { uid, token } = req.body;
    const result = {
        received: { uid, token: token ? token.slice(0, 30) + '...' : null },
        steps: [],
    };
    const steps = result.steps;
    try {
        // Step 1: Check user doc exists
        const userDoc = await db.collection('users').doc(uid).get();
        steps.push(userDoc.exists ? '✅ User doc exists' : '❌ User doc MISSING');
        // Step 2: Try writing token
        await db.collection('users').doc(uid).set({ fcmToken: token, fcmUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        steps.push('✅ Token written to Firestore');
        // Step 3: Verify it was written
        const verify = await db.collection('users').doc(uid).get();
        const savedToken = verify.data()?.fcmToken;
        steps.push(savedToken === token ? '✅ Token verified in Firestore' : '❌ Token mismatch after write');
        // Step 4: Try sending a test notification
        try {
            const msgId = await fcm.send({
                token,
                notification: { title: '✅ Wugi Debug', body: 'FCM is working!' },
                apns: { payload: { aps: { sound: 'default' } } },
            });
            steps.push('✅ Test notification sent: ' + msgId);
        }
        catch (e) {
            steps.push('❌ FCM send failed: ' + (e instanceof Error ? e.message : String(e)));
        }
        res.json({ success: true, ...result });
    }
    catch (e) {
        steps.push('❌ Error: ' + (e instanceof Error ? e.message : String(e)));
        res.status(500).json({ success: false, ...result });
    }
});
//# sourceMappingURL=debugFCM.js.map