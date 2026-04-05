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
exports.sendEmail = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — sendEmail Cloud Function
// HTTP endpoint called after purchase/transfer/reclaim
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const emailService_1 = require("./emailService");
exports.sendEmail = functions.runWith({ secrets: ['RESEND_API_KEY'] }).https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const { type, ...data } = req.body;
    try {
        switch (type) {
            case 'purchase':
                await (0, emailService_1.sendPurchaseConfirmation)(data);
                break;
            case 'transfer':
                await (0, emailService_1.sendTransferNotification)(data);
                break;
            case 'reclaim':
                await (0, emailService_1.sendReclaimEmail)(data);
                break;
            default:
                res.status(400).json({ error: `Unknown email type: ${type}` });
                return;
        }
        res.json({ success: true });
    }
    catch (e) {
        functions.logger.error('sendEmail error:', e);
        res.status(500).json({ error: e instanceof Error ? e.message : 'Email failed' });
    }
});
//# sourceMappingURL=sendEmail.js.map