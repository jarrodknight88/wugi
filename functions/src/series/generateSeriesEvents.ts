// ─────────────────────────────────────────────────────────────────────
// generateSeriesEvents — callable + NIGHTLY scheduled Cloud Function
//
// For each `active` eventSeries doc, ensure event instances exist for a rolling
// 8-week window. Properties:
//   • Deterministic ids `{seriesSlug}-YYYY-MM-DD` → idempotent (skip existing).
//   • Future-only: never creates or modifies past instances / galleries.
//   • DST-aware: occurrence dates are computed as calendar dates in the series
//     timezone; the wall-clock `time` is a display string (DST-correct as shown).
//   • Inherits the series template (title/venue/category/age/about/media/vibes/
//     time) and is auto-approved.
//   • Anchor is NOT maintained here — the consumer feed computes the anchor at
//     query time (see firestoreService.computeSeriesFeed). Generated docs carry
//     isSeriesAnchor:false purely to keep the field present.
//
// Series lacking a valid recurrence are skipped; the rest still process.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();
const DAY_MS = 86400000;

// Current calendar date (YYYY-MM-DD) in the given IANA timezone.
function todayISOInTz(tz: string): string {
  // en-CA renders ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// Display string like "FRI JUN 20" from a YYYY-MM-DD calendar date.
function displayFromISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  }).format(d).toUpperCase();
}

function stepDaysFor(frequency: string | undefined): number {
  return frequency === 'biweekly' ? 14 : frequency === 'monthly' ? 28 : 7; // default weekly
}

type GenResult = { seriesId: string; generated: number; ids: string[]; skipped?: string };

async function generateForSeries(seriesId: string, weeksAhead = 8): Promise<GenResult> {
  const seriesSnap = await db.collection('eventSeries').doc(seriesId).get();
  if (!seriesSnap.exists) {
    return { seriesId, generated: 0, ids: [], skipped: 'series-not-found' };
  }
  const s = seriesSnap.data()!;

  // ── Validate recurrence (replaces the old always-no-op guard) ──
  const rec = s.recurrence || {};
  const dow = rec.dayOfWeek;
  const tz = rec.timezone;
  const slug = s.seriesSlug;
  const validRecurrence =
    Number.isInteger(dow) && dow >= 0 && dow <= 6 &&
    typeof tz === 'string' && tz.length > 0 &&
    typeof slug === 'string' && slug.length > 0;
  if (!validRecurrence) {
    console.warn(`generateForSeries: ${seriesId} skipped — invalid/missing recurrence`);
    return { seriesId, generated: 0, ids: [], skipped: 'invalid-recurrence' };
  }

  // ── Existing instances → dedupe by id AND by dateISO (covers legacy docs
  //    that may have non-deterministic ids) ──
  const existing = await db.collection('events').where('seriesId', '==', seriesId).get();
  const existingIds = new Set(existing.docs.map(d => d.id));
  const existingISO = new Set(
    existing.docs.map(d => (d.data().dateISO as string | undefined)).filter(Boolean) as string[]
  );

  // ── Compute the rolling window, future-only, in the series timezone ──
  const todayISO = todayISOInTz(tz);
  const [Y, M, D] = todayISO.split('-').map(Number);
  const todayUTC = Date.UTC(Y, M - 1, D);
  const horizonUTC = todayUTC + weeksAhead * 7 * DAY_MS;
  const step = stepDaysFor(rec.frequency);

  // First occurrence on/after today that lands on the recurrence weekday.
  let cursor = todayUTC;
  while (new Date(cursor).getUTCDay() !== dow) cursor += DAY_MS;

  const endDate: Date | null = s.endDate?.toDate?.() || null;
  const generated: string[] = [];

  for (; cursor <= horizonUTC; cursor += step * DAY_MS) {
    if (endDate && cursor > endDate.getTime()) break;
    const iso = new Date(cursor).toISOString().slice(0, 10); // YYYY-MM-DD
    const id = `${slug}-${iso}`;
    if (existingIds.has(id) || existingISO.has(iso)) continue; // idempotent

    await db.collection('events').doc(id).set({
      title:          s.title || s.name || '',
      venue:          s.venue || s.venueName || '',
      venueName:      s.venueName || s.venue || '',
      venueId:        s.venueId || '',
      date:           displayFromISO(iso),
      dateISO:        iso,                       // ensures computed-anchor eligibility works
      time:           s.time || '9:00 PM',
      age:            s.age || '21+',
      about:          s.about || '',
      category:       s.category ?? null,
      media:          s.media || [],
      vibes:          s.vibes || [],
      status:         'approved',                // auto-approved
      hasTickets:     false,
      market:         s.market || 'atlanta',
      seriesId,
      seriesInstance: true,
      instanceDate:   displayFromISO(iso),
      isSeriesAnchor: false,                     // field present; read paths ignore it
      isFeatured:     false,
      createdAt:      admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
    });
    generated.push(id);
  }

  await db.collection('eventSeries').doc(seriesId).update({
    lastGenerated:  admin.firestore.FieldValue.serverTimestamp(),
    totalGenerated: admin.firestore.FieldValue.increment(generated.length),
  });

  return { seriesId, generated: generated.length, ids: generated };
}

// Callable — manual trigger from the dashboard.
export const generateSeriesEvents = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  const { seriesId, weeksAhead = 8 } = data;
  if (!seriesId) throw new functions.https.HttpsError('invalid-argument', 'seriesId required');
  return generateForSeries(seriesId, weeksAhead);
});

// Scheduled — NIGHTLY at 05:00 America/New_York. Generates an 8-week window for
// every active series; one failing series never aborts the rest.
export const generateSeriesEventsScheduled = functions.pubsub
  .schedule('0 5 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    const series = await db.collection('eventSeries').where('status', '==', 'active').get();
    const results = await Promise.allSettled(
      series.docs.map(d => generateForSeries(d.id, 8))
    );
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const made = results.reduce(
      (n, r) => n + (r.status === 'fulfilled' ? (r.value as GenResult).generated : 0), 0
    );
    console.log(`Series generation: ${ok}/${series.size} series ok, ${made} instances created`);
  });
