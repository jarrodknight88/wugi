// ─────────────────────────────────────────────────────────────────────
// generateSeriesEvents — creates individual event instances from a series
// Called on series create/update and weekly via scheduler
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

const DAY_MAP: Record<string, number> = {
  sunday:0, monday:1, tuesday:2, wednesday:3,
  thursday:4, friday:5, saturday:6,
};

// Get next N occurrences of a given weekday from a start date
function getOccurrences(
  dayOfWeek: string,
  frequency: 'weekly' | 'biweekly' | 'monthly',
  startDate: Date,
  endDate: Date | null,
  count: number
): Date[] {
  const target = DAY_MAP[dayOfWeek.toLowerCase()] ?? 5; // default friday
  const dates: Date[] = [];
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
    if (endDate && d > endDate) break;
    dates.push(d);
    cursor.setDate(cursor.getDate() + step);
  }

  return dates;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'2-digit', year:'numeric' }).toUpperCase();
}

// Callable: manually generate events for a series
export const generateSeriesEvents = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

  const { seriesId, weeksAhead = 8 } = data;
  if (!seriesId) throw new functions.https.HttpsError('invalid-argument', 'seriesId required');

  const seriesDoc = await db.collection('eventSeries').doc(seriesId).get();
  if (!seriesDoc.exists) throw new functions.https.HttpsError('not-found', 'Series not found');

  const s = seriesDoc.data()!;
  const startDate = s.startDate?.toDate() ?? new Date();
  const endDate   = s.endDate?.toDate() ?? null;

  const dates = getOccurrences(
    s.day || 'friday',
    s.frequency || 'weekly',
    startDate,
    endDate,
    weeksAhead
  );

  // Check which dates already have events
  const existing = await db.collection('events')
    .where('seriesId', '==', seriesId).get();
  const existingDates = new Set(existing.docs.map(d => d.data().instanceDate));

  const batch = db.batch();
  let created = 0;

  for (const date of dates) {
    const instanceDate = formatDate(date);
    if (existingDates.has(instanceDate)) continue;

    const eventRef = db.collection('events').doc();
    batch.set(eventRef, {
      // Inherit series fields
      title:       s.name,
      venue:       s.venueName  || '',
      venueId:     s.venueId    || '',
      time:        s.time       || '10:00 PM',
      age:         s.age        || '21+',
      about:       s.about      || '',
      vibes:       s.vibes      || [],
      media:       s.coverImage ? [{ type: 'image', uri: s.coverImage }] : [],
      // Series metadata
      seriesId,
      seriesName:    s.name,
      seriesInstance: true,
      instanceDate,
      date:          instanceDate,
      // Status / timestamps
      status:        'approved',
      hasTickets:    false,
      promoterId:    s.promoterId || null,
      createdAt:     admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
    });
    created++;
  }

  await batch.commit();
  return { created, total: dates.length };
});

// Scheduled: run every Monday at 6am to generate the coming week's events
export const generateSeriesEventsScheduled = functions.pubsub
  .schedule('0 6 * * 1')
  .timeZone('America/New_York')
  .onRun(async () => {
    const activeSeries = await db.collection('eventSeries')
      .where('status', '==', 'active').get();

    for (const seriesDoc of activeSeries.docs) {
      const s = seriesDoc.data();
      const startDate = s.startDate?.toDate() ?? new Date();
      const endDate   = s.endDate?.toDate() ?? null;

      const dates = getOccurrences(s.day || 'friday', s.frequency || 'weekly', startDate, endDate, 2);

      const existing = await db.collection('events')
        .where('seriesId', '==', seriesDoc.id).get();
      const existingDates = new Set(existing.docs.map(d => d.data().instanceDate));

      const batch = db.batch();
      for (const date of dates) {
        const instanceDate = formatDate(date);
        if (existingDates.has(instanceDate)) continue;
        const eventRef = db.collection('events').doc();
        batch.set(eventRef, {
          title: s.name, venue: s.venueName || '', venueId: s.venueId || '',
          time: s.time || '10:00 PM', age: s.age || '21+', about: s.about || '',
          vibes: s.vibes || [], media: s.coverImage ? [{ type:'image', uri:s.coverImage }] : [],
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
