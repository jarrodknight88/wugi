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
//
// Architecture: the date math + doc-building + idempotency live ONLY in the pure
// planner `planSeries` (no writes). The writer `generateForSeries` consumes a
// plan and performs the writes; the dryRun callable returns a plan and writes
// nothing. There is no duplicated logic.
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

// Build the FULL instance doc for a given series + occurrence date. This is the
// exact payload written by the writer — keep it identical to preserve the write
// path byte-for-byte. (serverTimestamp() sentinels resolve at write time, so it
// is harmless to build them here even on the dry-run path, where they are never
// written.)
function buildInstanceDoc(s: FirebaseFirestore.DocumentData, seriesId: string, iso: string) {
  return {
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
  };
}

// Roles permitted to trigger generation from the dashboard. Mirrors the
// dashboard's write-access definition (AuthContext `canWrite` =
// super_admin | moderator | support | venue_admin | event_admin) so every
// caller the dashboard exposes the Create/Generate buttons to still passes,
// while consumers, staff-only roles, and other authenticated users are rejected.
// Role source is the `users/{uid}.role` doc — the SAME mechanism the existing
// createDashboardUser callable gates on.
const SERIES_WRITE_ROLES = new Set([
  'super_admin', 'moderator', 'support', 'venue_admin', 'event_admin',
]);

// Assert the caller is signed in AND holds a series-write role, else throw the
// codebase's standard permission error. Read-only — performs no writes.
async function assertSeriesWriteAccess(
  context: functions.https.CallableContext
): Promise<void> {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  const callerDoc = await db.collection('users').doc(context.auth.uid).get();
  if (!callerDoc.exists) throw new functions.https.HttpsError('permission-denied', 'No user document');
  const callerRole: string = callerDoc.data()?.role || '';
  if (!SERIES_WRITE_ROLES.has(callerRole)) {
    throw new functions.https.HttpsError('permission-denied', `${callerRole || 'role'} cannot generate series events`);
  }
}

type GenResult = { seriesId: string; generated: number; ids: string[]; skipped?: string };

type PlanInstance = { id: string; dateISO: string; doc: ReturnType<typeof buildInstanceDoc> };
type PlanSkip = { id: string; dateISO: string; reason: string };
export type SeriesPlan = {
  seriesId: string;
  toCreate: PlanInstance[];
  toSkip: PlanSkip[];
  skipped?: string; // 'series-not-found' | 'invalid-recurrence' (whole series skipped)
};

// PURE planner — performs NO writes. Reads the eventSeries doc + existing
// instances, computes the rolling future window, builds each would-create doc
// with its deterministic id, and partitions occurrences into toCreate / toSkip
// (idempotency: existing instances skipped by id AND by dateISO).
export async function planSeries(seriesId: string, weeksAhead = 8): Promise<SeriesPlan> {
  const seriesSnap = await db.collection('eventSeries').doc(seriesId).get();
  if (!seriesSnap.exists) {
    return { seriesId, toCreate: [], toSkip: [], skipped: 'series-not-found' };
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
    return { seriesId, toCreate: [], toSkip: [], skipped: 'invalid-recurrence' };
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
  const toCreate: PlanInstance[] = [];
  const toSkip: PlanSkip[] = [];

  for (; cursor <= horizonUTC; cursor += step * DAY_MS) {
    if (endDate && cursor > endDate.getTime()) break;
    const iso = new Date(cursor).toISOString().slice(0, 10); // YYYY-MM-DD
    const id = `${slug}-${iso}`;
    if (existingIds.has(id)) { toSkip.push({ id, dateISO: iso, reason: 'exists-by-id' }); continue; }
    if (existingISO.has(iso)) { toSkip.push({ id, dateISO: iso, reason: 'exists-by-dateISO' }); continue; }
    toCreate.push({ id, dateISO: iso, doc: buildInstanceDoc(s, seriesId, iso) });
  }

  return { seriesId, toCreate, toSkip };
}

// WRITER — consumes a plan and performs the writes. Write payload + the
// eventSeries update are byte-for-byte unchanged from the prior implementation.
async function generateForSeries(seriesId: string, weeksAhead = 8): Promise<GenResult> {
  const plan = await planSeries(seriesId, weeksAhead);
  if (plan.skipped) {
    if (plan.skipped === 'invalid-recurrence') {
      console.warn(`generateForSeries: ${seriesId} skipped — invalid/missing recurrence`);
    }
    return { seriesId, generated: 0, ids: [], skipped: plan.skipped };
  }

  const ids: string[] = [];
  for (const item of plan.toCreate) {
    await db.collection('events').doc(item.id).set(item.doc);
    ids.push(item.id);
  }

  await db.collection('eventSeries').doc(seriesId).update({
    lastGenerated:  admin.firestore.FieldValue.serverTimestamp(),
    totalGenerated: admin.firestore.FieldValue.increment(ids.length),
  });

  return { seriesId, generated: ids.length, ids };
}

// Callable — manual trigger from the dashboard.
//   • dryRun === true  → preview only (planSeries), writes NOTHING. seriesId is
//     optional; when omitted, previews every `active` series.
//   • dryRun false/absent → unchanged behavior: requires seriesId, plan → write.
export const generateSeriesEvents = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  const { seriesId, weeksAhead = 8, dryRun } = data;

  if (dryRun === true) {
    let ids: string[];
    if (seriesId) {
      ids = [seriesId];
    } else {
      const active = await db.collection('eventSeries').where('status', '==', 'active').get();
      ids = active.docs.map(d => d.id);
    }
    const plans = await Promise.all(ids.map(id => planSeries(id, weeksAhead)));
    return {
      dryRun: true,
      totalToCreate: plans.reduce((n, p) => n + p.toCreate.length, 0),
      series: plans.map(p => ({
        seriesId: p.seriesId,
        skipped: p.skipped ?? null,
        toCreateCount: p.toCreate.length,
        toCreate: p.toCreate.map(i => ({ id: i.id, dateISO: i.dateISO })),
        toSkip: p.toSkip.map(i => ({ id: i.id, dateISO: i.dateISO, reason: i.reason })),
      })),
    };
  }

  // ── Write path: admin/role gate (dryRun above is read-only preview) ──
  await assertSeriesWriteAccess(context);

  if (!seriesId) throw new functions.https.HttpsError('invalid-argument', 'seriesId required');
  return generateForSeries(seriesId, weeksAhead);
});

// Scheduled — NIGHTLY at 05:00 America/New_York. Generates an 8-week window for
// every active series; one failing series never aborts the rest. Always writes.
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
