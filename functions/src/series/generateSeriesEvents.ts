// ─────────────────────────────────────────────────────────────────────
// generateSeriesEvents — callable + scheduled Cloud Function
// Creates individual event instances from an eventSeries doc.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

const DAYS: Record<string, number> = {
  sunday:0, monday:1, tuesday:2, wednesday:3,
  thursday:4, friday:5, saturday:6,
};

function nextOccurrence(day: string, fromDate: Date): Date {
  const target = DAYS[day.toLowerCase()] ?? 5;
  const d = new Date(fromDate);
  d.setHours(0, 0, 0, 0);
  const diff = (target - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + (diff === 0 ? 0 : diff));
  return d;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday:'short', month:'short', day:'numeric', year:'numeric',
  }).toUpperCase();
}

async function generateForSeries(seriesId: string, weeksAhead = 8) {
  const seriesSnap = await db.collection('eventSeries').doc(seriesId).get();
  if (!seriesSnap.exists) throw new Error(`Series ${seriesId} not found`);

  const s = seriesSnap.data()!;
  const now = new Date();
  const endDate = s.endDate?.toDate?.() || null;
  const generated: string[] = [];

  // Get existing instance dates to avoid duplicates
  const existing = await db.collection('events')
    .where('seriesId', '==', seriesId).get();
  const existingDates = new Set(existing.docs.map(d => d.data().instanceDate));

  let cursor = nextOccurrence(s.day, now);

  for (let i = 0; i < weeksAhead; i++) {
    if (endDate && cursor > endDate) break;

    const instanceDate = formatDate(cursor);
    if (!existingDates.has(instanceDate)) {
      const ref = await db.collection('events').add({
        title:       s.name,
        venue:       s.venueName || '',
        venueId:     s.venueId  || '',
        date:        instanceDate,
        time:        s.time     || '10:00 PM',
        age:         s.age      || '21+',
        about:       s.about    || '',
        vibes:       s.vibes    || [],
        coverImage:  s.coverImage || '',
        status:      'approved',
        hasTickets:  false,
        seriesId,
        seriesInstance: true,
        instanceDate,
        promoterId:  s.promoterId || null,
        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
        updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
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
export const generateSeriesEvents = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  const { seriesId, weeksAhead = 8 } = data;
  if (!seriesId) throw new functions.https.HttpsError('invalid-argument', 'seriesId required');
  return generateForSeries(seriesId, weeksAhead);
});

// Scheduled — runs every Monday at 6am ET, generates 2 weeks ahead for all active series
export const generateSeriesEventsScheduled = functions.pubsub
  .schedule('0 6 * * 1')
  .timeZone('America/New_York')
  .onRun(async () => {
    const series = await db.collection('eventSeries').where('status', '==', 'active').get();
    const results = await Promise.allSettled(
      series.docs.map(d => generateForSeries(d.id, 2))
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    console.log(`Series generation: ${succeeded}/${series.size} succeeded`);
  });
