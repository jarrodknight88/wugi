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
exports.onTicketTypeSold = void 0;
// ─────────────────────────────────────────────────────────────────────
// Wugi — Update Ticket Inventory
//
// Fires when a pass is created. Updates the ticketType's
// sold/remaining counts and flips status to 'sold_out' if needed.
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
exports.onTicketTypeSold = functions.firestore
    .document('passes/{passId}')
    .onCreate(async (snap) => {
    const pass = snap.data();
    const { eventId, ticketTypeId } = pass;
    if (!eventId || !ticketTypeId)
        return;
    const ticketTypeRef = db
        .collection('events')
        .doc(eventId)
        .collection('ticketTypes')
        .doc(ticketTypeId);
    await db.runTransaction(async (tx) => {
        const ticketTypeDoc = await tx.get(ticketTypeRef);
        if (!ticketTypeDoc.exists)
            return;
        const ticketType = ticketTypeDoc.data();
        const newSold = (ticketType.sold ?? 0) + 1;
        const newRemaining = (ticketType.capacity ?? 0) - newSold;
        const updates = {
            sold: newSold,
            remaining: newRemaining,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        // Flip to sold_out if no remaining capacity
        if (newRemaining <= 0 && ticketType.status === 'on_sale') {
            updates.status = 'sold_out';
            functions.logger.info(`Ticket type ${ticketTypeId} for event ${eventId} is now sold out`);
        }
        tx.update(ticketTypeRef, updates);
    });
});
//# sourceMappingURL=updateInventory.js.map