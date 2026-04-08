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
exports.validateSuperAdminPin = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — validateSuperAdminPin Cloud Function
// Supports multiple named super admin PINs via Secret Manager:
//   SUPER_ADMIN_PIN       → Jarrod (owner)
//   SUPER_ADMIN_PIN_RICH  → Rich (partner/investor)
// Add new admins: firebase functions:secrets:set SUPER_ADMIN_PIN_NAME
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const SUPER_ADMIN_SECRETS = ['SUPER_ADMIN_PIN', 'SUPER_ADMIN_PIN_RICH'];
const SUPER_ADMIN_NAMES = {
    SUPER_ADMIN_PIN: 'Jarrod',
    SUPER_ADMIN_PIN_RICH: 'Rich',
};
function constantTimeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    return a.split('').every((c, i) => c === b[i]);
}
exports.validateSuperAdminPin = functions
    .runWith({ secrets: SUPER_ADMIN_SECRETS })
    .https.onCall(async (data, context) => {
    const { pin } = data;
    if (!pin || typeof pin !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'PIN required');
    }
    // Check pin against all registered super admin PINs
    for (const secretKey of SUPER_ADMIN_SECRETS) {
        const storedPin = process.env[secretKey];
        if (!storedPin)
            continue;
        if (constantTimeEqual(pin, storedPin)) {
            const adminName = SUPER_ADMIN_NAMES[secretKey] || 'Admin';
            functions.logger.info('Super admin PIN accepted', {
                admin: adminName,
                ip: context.rawRequest?.ip,
                timestamp: new Date().toISOString(),
            });
            return {
                isSuperAdmin: true,
                adminName,
                eventId: '__super_admin__',
                eventName: 'All Events',
                venueName: 'Super Admin',
                venueId: '__super_admin__',
                venueLatitude: 0,
                venueLongitude: 0,
                date: new Date().toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                }),
                role: 'super_admin',
            };
        }
    }
    functions.logger.warn('Super admin PIN failed attempt', {
        ip: context.rawRequest?.ip,
        timestamp: new Date().toISOString(),
    });
    throw new functions.https.HttpsError('permission-denied', 'Invalid PIN');
});
//# sourceMappingURL=validateSuperAdminPin.js.map