#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────
 * Wugi — VENUE-DATA-08 Deliverable C — series dedupe backfill
 *
 * Reads all events. Groups by (venueId, normalizedTitle). Writes:
 *   seriesId            — stable id derived from venueId + normalizedTitle
 *   isSeriesAnchor      — true on the lowest future-dateISO occurrence
 *                         (only one per series; false on siblings)
 *   seriesOccurrences   — only set on the anchor; lists all sibling ids
 *
 * Special cases:
 *   - Single-occurrence series with a future date: that doc IS the anchor,
 *     seriesOccurrences = [self].
 *   - All-past series (no future occurrence): no anchor; every doc gets
 *     isSeriesAnchor=false. Series goes dormant and stays out of consumer
 *     feeds — which matches the documented behavior of feed queries that
 *     filter on isSeriesAnchor==true. The next scrape (or roll-forward
 *     function) will pick a new anchor when fresh future occurrences land.
 *   - Anchor selection from FUTURE-or-today dates only; never falls back
 *     to a past occurrence (that would surface stale series in feeds).
 *
 * Idempotent — safe to re-run.
 * ───────────────────────────────────────────────────────────────────── */
'use strict';

const path = require('path');
const admin = require('firebase-admin');
const sa = require(path.resolve(__dirname, 'serviceAccount.json'));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

// ── Title normalization ──────────────────────────────────────────────
// Lowercase, strip emoji + extended pictograms, collapse whitespace.
// Regex covers the common Unicode ranges for emoji used in event titles.
function normalizeTitle(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    // Emoji + pictographs + symbols (covers 🥞 🔥 🍹 🌍⚽ etc.)
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}]/gu, '')
    // Variation selectors / zero-width joiner
    .replace(/[‍️]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unnamed';
}

function makeSeriesId(venueId, normTitle) {
  // Stable key — same inputs yield same id, so re-runs converge.
  return `series-${slugify(venueId || 'no-venue')}-${slugify(normTitle || 'untitled')}`;
}

const TODAY_ISO = new Date().toISOString().slice(0, 10);

// ── Anchor selection ─────────────────────────────────────────────────
// Picks the lowest-future-or-today occurrence. If no future occurrence
// exists, returns null and the caller stamps every sibling isSeriesAnchor=
// false — the series goes dormant and stays out of consumer feeds.
function pickAnchor(siblings) {
  const future = siblings.filter(s => (s.dateISO || '') >= TODAY_ISO);
  if (future.length === 0) return null;
  future.sort((a, b) => (a.dateISO || '').localeCompare(b.dateISO || ''));
  return future[0];
}

(async function main() {
  const startedAt = Date.now();
  console.log(`Backfill started ${new Date().toISOString()} (today=${TODAY_ISO})`);

  const snap = await db.collection('events').get();
  console.log(`Loaded ${snap.size} events from wugi-prod\n`);

  // Group by (venueId, normalizedTitle)
  const groups = new Map();   // key -> [event,...]
  for (const d of snap.docs) {
    const e = { id: d.id, ...d.data() };
    const venueId   = e.venueId || '_no_venue';
    const normTitle = normalizeTitle(e.title || e.name || '');
    const key = `${venueId}::${normTitle}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: d.id, dateISO: e.dateISO || '', ref: d.ref, raw: e });
  }
  console.log(`Grouped into ${groups.size} series\n`);

  // Stats
  const stats = {
    totalSeries:        groups.size,
    soloSeries:         0,
    multiSeries:        0,
    anchorsSet:         0,
    siblingsDemoted:    0,
    seriesNoFutureAnchor: 0,
    largestSeries:      { key: '', size: 0 },
    seriesByCount:      {},   // { count -> howManySeries }
    writes:             0,
  };

  // Build operations
  const ops = []; // { ref, data }
  for (const [key, siblings] of groups) {
    const size = siblings.length;
    stats.seriesByCount[size] = (stats.seriesByCount[size] || 0) + 1;
    if (size > stats.largestSeries.size) stats.largestSeries = { key, size };
    if (size === 1) stats.soloSeries += 1;
    else            stats.multiSeries += 1;

    const seriesId = makeSeriesId(siblings[0].raw.venueId, normalizeTitle(siblings[0].raw.title || siblings[0].raw.name || ''));
    const anchor = pickAnchor(siblings);
    const hasFutureAnchor = anchor && (anchor.dateISO >= TODAY_ISO);
    if (anchor && !hasFutureAnchor) stats.seriesNoFutureAnchor += 1;

    const allSiblingIds = siblings.map(s => s.id);

    for (const s of siblings) {
      const isAnchor = anchor && s.id === anchor.id;
      const update = {
        seriesId,
        isSeriesAnchor: isAnchor,
        seriesOccurrences: isAnchor ? allSiblingIds : null,
        seriesBackfilledAt: FV.serverTimestamp(),
        updatedAt: FV.serverTimestamp(),
      };
      ops.push({ ref: s.ref, data: update });
      if (isAnchor) stats.anchorsSet += 1;
      else          stats.siblingsDemoted += 1;
    }
  }

  console.log(`Will write ${ops.length} doc updates`);
  console.log(`  series total:                  ${stats.totalSeries}`);
  console.log(`  series with single occurrence: ${stats.soloSeries}`);
  console.log(`  series with multiple:          ${stats.multiSeries}`);
  console.log(`  series with no future anchor:  ${stats.seriesNoFutureAnchor}`);
  console.log(`  largest series:                ${stats.largestSeries.size} (${stats.largestSeries.key})`);
  console.log(`  anchors set:                   ${stats.anchorsSet}`);
  console.log(`  siblings demoted:              ${stats.siblingsDemoted}`);
  console.log(`  size distribution:`);
  for (const k of Object.keys(stats.seriesByCount).sort((a, b) => Number(a) - Number(b))) {
    console.log(`    ${k.padStart(2)}-occurrence series: ${stats.seriesByCount[k]}`);
  }
  console.log('');

  // Commit in batches of 500
  let committed = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const slice = ops.slice(i, i + 500);
    const batch = db.batch();
    for (const op of slice) batch.update(op.ref, op.data);
    await batch.commit();
    committed += slice.length;
    process.stdout.write(`  committed ${committed}/${ops.length}\n`);
  }
  stats.writes = committed;

  // Audit entry on a meta doc (NOT per-event, would explode the audit collection)
  await db.collection('meta').doc('series-backfill-runs').collection('runs').add({
    ranAt: FV.serverTimestamp(),
    todayISO: TODAY_ISO,
    elapsedMs: Date.now() - startedAt,
    stats,
  });

  console.log(`\n✓ Backfill complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  process.exit(0);
})().catch(e => { console.error('ERR backfill:', e); process.exit(1); });
