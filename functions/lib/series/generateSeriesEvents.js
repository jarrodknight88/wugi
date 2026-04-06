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
exports.generateSeriesEventsScheduled = exports.generateSeriesEvents = void 0;
// ─────────────────────────────────────────────────────────────────────
// generateSeriesEvents — callable + scheduled Cloud Function
// Creates individual event instances from an eventSeries doc.
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
const DAYS = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
};
function nextOccurrence(day, fromDate) {
    const target = DAYS[day.toLowerCase()] ?? 5;
    const d = new Date(fromDate);
    d.setHours(0, 0, 0, 0);
    const diff = (target - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (diff === 0 ? 0 : diff));
    return d;
}
function formatDate(d) {
    return d.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    }).toUpperCase();
}
async function generateForSeries(seriesId, weeksAhead = 8) {
    const seriesSnap = await db.collection('eventSeries').doc(seriesId).get();
    if (!seriesSnap.exists)
        throw new Error(`Series ${seriesId} not found`);
    const s = seriesSnap.data();
    const now = new Date();
    const endDate = s.endDate?.toDate?.() || null;
    const generated = [];
    // Get existing instance dates to avoid duplicates
    const existing = await db.collection('events')
        .where('seriesId', '==', seriesId).get();
    const existingDates = new Set(existing.docs.map(d => d.data().instanceDate));
    let cursor = nextOccurrence(s.day, now);
    for (let i = 0; i < weeksAhead; i++) {
        if (endDate && cursor > endDate)
            break;
        const instanceDate = formatDate(cursor);
        if (!existingDates.has(instanceDate)) {
            const ref = await db.collection('events').add({
                title: s.name,
                venue: s.venueName || '',
                venueId: s.venueId || '',
                date: instanceDate,
                time: s.time || '10:00 PM',
                age: s.age || '21+',
                about: s.about || '',
                vibes: s.vibes || [],
                coverImage: s.coverImage || '',
                status: 'approved',
                hasTickets: false,
                seriesId,
                seriesInstance: true,
                instanceDate,
                promoterId: s.promoterId || null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            generated.push(ref.id);
        }
        // Advance by frequency
        const weeks = s.frequency === 'biweekly' ? 2 : s.frequency === 'monthly' ? 4 : 1;
        cursor.setDate(cursor.getDate() + (weeks * 7));
    }
    await db.collection('eventSeries').doc(seriesId).update({
        lastGenerated: admin.firestore.FieldValue.serverTimestamp(),
        totalGenerated: admin.firestore.FieldValue.increment(generated.length),
    });
    return { generated: generated.length, ids: generated };
}
// Callable — manually trigger from dashboard
exports.generateSeriesEvents = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
    const { seriesId, weeksAhead = 8 } = data;
    if (!seriesId)
        throw new functions.https.HttpsError('invalid-argument', 'seriesId required');
    return generateForSeries(seriesId, weeksAhead);
});
// Scheduled — runs every Monday at 6am ET, generates 2 weeks ahead for all active series
exports.generateSeriesEventsScheduled = functions.pubsub
    .schedule('0 6 * * 1')
    .timeZone('America/New_York')
    .onRun(async () => {
    const series = await db.collection('eventSeries').where('status', '==', 'active').get();
    const results = await Promise.allSettled(series.docs.map(d => generateForSeries(d.id, 2)));
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    console.log(`Series generation: ${succeeded}/${series.size} succeeded`);
});
//# sourceMappingURL=generateSeriesEvents.js.map