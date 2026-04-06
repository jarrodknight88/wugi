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
// generateSeriesEvents — creates individual event instances from a series
// Called on series create/update and weekly via scheduler
// ─────────────────────────────────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
const DAY_MAP = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
};
// Get next N occurrences of a given weekday from a start date
function getOccurrences(dayOfWeek, frequency, startDate, endDate, count) {
    const target = DAY_MAP[dayOfWeek.toLowerCase()] ?? 5; // default friday
    const dates = [];
    const cursor = new Date(startDate);
    // Advance to first occurrence on or after startDate
    while (cursor.getDay() !== target) {
        cursor.setDate(cursor.getDate() + 1);
    }
    const step = frequency === 'weekly' ? 7
        : frequency === 'biweekly' ? 14
            : 28; // monthly approx
    while (dates.length < count) {
        const d = new Date(cursor);
        if (endDate && d > endDate)
            break;
        dates.push(d);
        cursor.setDate(cursor.getDate() + step);
    }
    return dates;
}
function formatDate(d) {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase();
}
// Callable: manually generate events for a series
exports.generateSeriesEvents = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
    const { seriesId, weeksAhead = 8 } = data;
    if (!seriesId)
        throw new functions.https.HttpsError('invalid-argument', 'seriesId required');
    const seriesDoc = await db.collection('eventSeries').doc(seriesId).get();
    if (!seriesDoc.exists)
        throw new functions.https.HttpsError('not-found', 'Series not found');
    const s = seriesDoc.data();
    const startDate = s.startDate?.toDate() ?? new Date();
    const endDate = s.endDate?.toDate() ?? null;
    const dates = getOccurrences(s.day || 'friday', s.frequency || 'weekly', startDate, endDate, weeksAhead);
    // Check which dates already have events
    const existing = await db.collection('events')
        .where('seriesId', '==', seriesId).get();
    const existingDates = new Set(existing.docs.map(d => d.data().instanceDate));
    const batch = db.batch();
    let created = 0;
    for (const date of dates) {
        const instanceDate = formatDate(date);
        if (existingDates.has(instanceDate))
            continue;
        const eventRef = db.collection('events').doc();
        batch.set(eventRef, {
            // Inherit series fields
            title: s.name,
            venue: s.venueName || '',
            venueId: s.venueId || '',
            time: s.time || '10:00 PM',
            age: s.age || '21+',
            about: s.about || '',
            vibes: s.vibes || [],
            media: s.coverImage ? [{ type: 'image', uri: s.coverImage }] : [],
            // Series metadata
            seriesId,
            seriesName: s.name,
            seriesInstance: true,
            instanceDate,
            date: instanceDate,
            // Status / timestamps
            status: 'approved',
            hasTickets: false,
            promoterId: s.promoterId || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        created++;
    }
    await batch.commit();
    return { created, total: dates.length };
});
// Scheduled: run every Monday at 6am to generate the coming week's events
exports.generateSeriesEventsScheduled = functions.pubsub
    .schedule('0 6 * * 1')
    .timeZone('America/New_York')
    .onRun(async () => {
    const activeSeries = await db.collection('eventSeries')
        .where('status', '==', 'active').get();
    for (const seriesDoc of activeSeries.docs) {
        const s = seriesDoc.data();
        const startDate = s.startDate?.toDate() ?? new Date();
        const endDate = s.endDate?.toDate() ?? null;
        const dates = getOccurrences(s.day || 'friday', s.frequency || 'weekly', startDate, endDate, 2);
        const existing = await db.collection('events')
            .where('seriesId', '==', seriesDoc.id).get();
        const existingDates = new Set(existing.docs.map(d => d.data().instanceDate));
        const batch = db.batch();
        for (const date of dates) {
            const instanceDate = formatDate(date);
            if (existingDates.has(instanceDate))
                continue;
            const eventRef = db.collection('events').doc();
            batch.set(eventRef, {
                title: s.name, venue: s.venueName || '', venueId: s.venueId || '',
                time: s.time || '10:00 PM', age: s.age || '21+', about: s.about || '',
                vibes: s.vibes || [], media: s.coverImage ? [{ type: 'image', uri: s.coverImage }] : [],
                seriesId: seriesDoc.id, seriesName: s.name, seriesInstance: true,
                instanceDate, date: instanceDate, status: 'approved', hasTickets: false,
                promoterId: s.promoterId || null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        await batch.commit();
    }
    return null;
});
//# sourceMappingURL=generateSeriesEvents.js.map