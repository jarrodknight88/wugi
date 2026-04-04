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
exports.onEventPublished = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — onEventPublished
// Fires when an event is approved. Sends push to "atlanta-events" topic.
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const sendPushNotification_1 = require("./sendPushNotification");
exports.onEventPublished = functions.firestore
    .document('events/{eventId}')
    .onWrite(async (change) => {
    const before = change.before.data();
    const after = change.after.data();
    // Only fire when status changes TO approved
    if (before?.status === 'approved' || after?.status !== 'approved')
        return;
    const title = after.title ?? 'New Event on Wugi';
    const venue = after.venueName ?? after.venue ?? 'Atlanta';
    const date = after.date ?? 'Tonight';
    const body = `${venue} · ${date}`;
    try {
        await (0, sendPushNotification_1.sendToTopic)('atlanta-events', title, body, {
            eventId: change.after.id,
            eventSlug: after.slug ?? '',
            screen: 'EventDetail',
        });
        functions.logger.info(`Sent notification for event: ${change.after.id}`);
    }
    catch (e) {
        functions.logger.error('onEventPublished notification error:', e);
    }
});
//# sourceMappingURL=onEventPublished.js.map