/**
 * Orphaned-series audit — READ ONLY. Makes ZERO writes (no --execute mode).
 *
 * eventSeries (templates) → events (occurrences linked by seriesId). The
 * generators (generateSeriesEvents callable + generateSeriesEventsScheduled
 * nightly) only extend occurrences for seriesIds that have a matching
 * `eventSeries` doc. Any event carrying a `seriesId` with NO corresponding
 * eventSeries doc is "orphaned": the generator cannot extend it, so it silently
 * drops off the marquee/venue once the scraped instances expire.
 *
 * This script finds every distinct orphaned seriesId and, for each, prints the
 * facts Jarrod needs to author the missing eventSeries doc (run where creds
 * exist). It NEVER writes.
 *
 *   node scripts/audit-series.js            # full report
 *   node scripts/audit-series.js --json     # machine-readable JSON
 *
 * Mirrors the seed scripts' init: firebase-admin + ./serviceAccount.json,
 * projectId 'wugi-prod'.
 */
const admin = require('firebase-admin');
const sa = require('./serviceAccount.json');

admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db = admin.firestore();

const JSON_OUT = process.argv.includes('--json');

const WEEKDAY_TOKENS = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Derive 0–6 weekday for an event: prefer dateISO; else the leading token of a
// display date like "SAT APR 5". Returns null if neither is parseable.
function weekdayOf(ev) {
  if (typeof ev.dateISO === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ev.dateISO)) {
    return new Date(`${ev.dateISO.slice(0, 10)}T00:00:00Z`).getUTCDay();
  }
  const tok = String(ev.date || '').trim().slice(0, 3).toUpperCase();
  return tok in WEEKDAY_TOKENS ? WEEKDAY_TOKENS[tok] : null;
}

// Best-effort YYYY-MM-DD for an event: prefer explicit dateISO; fall back to the
// trailing -YYYY-MM-DD on a deterministic instance id. Returns null if neither.
function isoOf(ev, id) {
  if (typeof ev.dateISO === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ev.dateISO)) {
    return ev.dateISO.slice(0, 10);
  }
  const m = String(id || '').match(/(\d{4}-\d{2}-\d{2})$/);
  return m ? m[1] : null;
}

// Infer recurrence frequency from the median gap (days) between sorted instance
// dates. Falls back to 'unknown' when fewer than 2 dated instances exist.
function inferFrequency(isoDates) {
  const ds = isoDates
    .filter(Boolean)
    .map(s => new Date(`${s}T00:00:00Z`).getTime())
    .sort((a, b) => a - b);
  if (ds.length < 2) return { frequency: 'unknown', medianGapDays: null };
  const gaps = [];
  for (let i = 1; i < ds.length; i++) gaps.push(Math.round((ds[i] - ds[i - 1]) / 86400000));
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  // Bucket to the frequencies generateSeriesEvents understands (7/14/28-day step).
  let frequency = 'unknown';
  if (median <= 10) frequency = 'weekly';
  else if (median <= 18) frequency = 'biweekly';
  else if (median <= 45) frequency = 'monthly';
  return { frequency, medianGapDays: median };
}

// Strip a trailing -YYYY-MM-DD from an instance id to suggest the deterministic
// seriesSlug generateSeriesEvents should use; falls back to seriesId (minus the
// "series-" prefix) so generated ids stay consistent with existing instances.
function suggestSlug(instanceId, seriesId) {
  const m = String(instanceId || '').match(/^(.+)-\d{4}-\d{2}-\d{2}$/);
  return m ? m[1] : String(seriesId).replace(/^series-/, '');
}

// Representative instance: prefer one WITH dateISO (best for derivation), newest
// first; else the first doc.
function pickRepresentative(docs) {
  const withISO = docs
    .filter(d => typeof d.data().dateISO === 'string')
    .sort((a, b) => (b.data().dateISO < a.data().dateISO ? -1 : 1));
  return (withISO[0] || docs[0]) || null;
}

async function main() {
  // ── 1. All eventSeries doc ids (the set of seriesIds that CAN be extended) ──
  const seriesSnap = await db.collection('eventSeries').get();
  const knownSeriesIds = new Set(seriesSnap.docs.map(d => d.id));

  // ── 2. All events carrying a seriesId, grouped by seriesId ──
  const eventsSnap = await db.collection('events').where('seriesId', '!=', null).get();
  const bySeries = new Map(); // seriesId -> array of QueryDocumentSnapshot
  for (const d of eventsSnap.docs) {
    const sid = d.data().seriesId;
    if (!sid) continue;
    if (!bySeries.has(sid)) bySeries.set(sid, []);
    bySeries.get(sid).push(d);
  }

  // ── 3. Orphans = seriesIds present on events but absent from eventSeries ──
  const orphanIds = [...bySeries.keys()].filter(sid => !knownSeriesIds.has(sid)).sort();

  // ── 4. Cache venue names for any venueIds we encounter ──
  const venueNameCache = new Map();
  async function venueName(venueId) {
    if (!venueId) return '';
    if (venueNameCache.has(venueId)) return venueNameCache.get(venueId);
    let name = '';
    try {
      const v = await db.collection('venues').doc(venueId).get();
      if (v.exists) name = v.data().name || v.data().venueName || '';
    } catch { /* read-only best effort */ }
    venueNameCache.set(venueId, name);
    return name;
  }

  // ── 5. Build a report row per orphaned seriesId ──
  const report = [];
  for (const seriesId of orphanIds) {
    const docs = bySeries.get(seriesId);
    const instanceCount = docs.length;

    const isoDates = docs.map(d => isoOf(d.data(), d.id)).filter(Boolean).sort();
    const earliest = isoDates[0] || null;
    const latest = isoDates[isoDates.length - 1] || null;

    const rep = pickRepresentative(docs);
    const ev = rep ? rep.data() : {};
    const dow = rep ? weekdayOf(ev) : null;
    const { frequency, medianGapDays } = inferFrequency(isoDates);

    const venueId = ev.venueId || '';
    const resolvedVenueName = (await venueName(venueId)) || ev.venueName || ev.venue || '';

    report.push({
      seriesId,
      venueId,
      venueName: resolvedVenueName,
      instanceCount,
      earliestInstanceDate: earliest,
      latestInstanceDate: latest,   // when it expires off the marquee
      inferredDayOfWeek: dow,       // 0–6 (Sun–Sat), null if underivable
      inferredDayName: dow === null ? null : WEEKDAY_NAMES[dow],
      inferredFrequency: frequency, // weekly | biweekly | monthly | unknown
      medianGapDays,
      suggestedSeriesSlug: suggestSlug(rep ? rep.id : '', seriesId),
      representativeInstanceId: rep ? rep.id : null,
      // Reconstructable eventSeries template fields, copied from the representative
      // instance — paste these into a new eventSeries/<seriesId> doc.
      sample: {
        title: ev.title || ev.name || '',
        time: ev.time || '',
        age: ev.age || '',
        about: ev.about || '',
        category: ev.category ?? null,
        vibes: ev.vibes || [],
        coverImage: ev.coverImage || (Array.isArray(ev.media) ? (ev.media[0] || '') : ''),
        media: ev.media || [],
        market: ev.market || '',
      },
    });
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({
      scannedEventSeries: knownSeriesIds.size,
      seriesIdsOnEvents: bySeries.size,
      orphanedSeriesCount: report.length,
      orphans: report,
    }, null, 2));
    process.exit(0);
  }

  // ── Human-readable report ──
  console.log('🔍 Orphaned-series audit (READ ONLY — 0 writes)\n');
  console.log(`eventSeries docs           : ${knownSeriesIds.size}`);
  console.log(`distinct seriesId on events: ${bySeries.size}`);
  console.log(`ORPHANED seriesIds         : ${report.length}\n`);

  if (report.length === 0) {
    console.log('✅ No orphaned series — every seriesId on events has an eventSeries doc.');
    process.exit(0);
  }

  for (const r of report) {
    console.log(`── ${r.seriesId} ─────────────────────────────`);
    console.log(`  venue           : ${r.venueId || '(none)'} — ${r.venueName || '(name unknown)'}`);
    console.log(`  instances       : ${r.instanceCount}`);
    console.log(`  date range      : ${r.earliestInstanceDate || '?'} → ${r.latestInstanceDate || '?'}  (LATEST = marquee expiry)`);
    console.log(`  inferred day    : ${r.inferredDayOfWeek === null ? 'UNKNOWN' : `${r.inferredDayOfWeek} (${r.inferredDayName})`}`);
    console.log(`  inferred freq   : ${r.inferredFrequency}${r.medianGapDays !== null ? ` (median gap ${r.medianGapDays}d)` : ''}`);
    console.log(`  suggested slug  : ${r.suggestedSeriesSlug}`);
    console.log(`  representative  : ${r.representativeInstanceId || '(none)'}`);
    console.log(`  sample fields to reconstruct eventSeries/${r.seriesId}:`);
    console.log(`    title      : ${r.sample.title}`);
    console.log(`    time       : ${r.sample.time}`);
    console.log(`    age        : ${r.sample.age}`);
    console.log(`    category   : ${r.sample.category ?? '(null)'}`);
    console.log(`    vibes      : ${JSON.stringify(r.sample.vibes)}`);
    console.log(`    coverImage : ${r.sample.coverImage || '(none)'}`);
    console.log(`    about      : ${r.sample.about ? `"${r.sample.about.slice(0, 80)}${r.sample.about.length > 80 ? '…' : ''}"` : '(empty)'}`);
    console.log('');
  }

  console.log('Next step (where creds exist): for each orphaned seriesId above, author an');
  console.log("eventSeries/<seriesId> doc (status:'active', seriesSlug, recurrence:{dayOfWeek,");
  console.log('frequency, timezone}, + the sample template fields), then run');
  console.log('generateSeriesEvents to extend it forward. This audit wrote nothing.');
  process.exit(0);
}

main().catch(e => { console.error('ERR', e); process.exit(1); });
