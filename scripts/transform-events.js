#!/usr/bin/env node
/**
 * Wugi — Events transform: data/raw/events/*.json → scripts/data/events-review.json
 *
 * READ-ONLY. Writes zero Firestore docs, creates zero venue docs, calls zero
 * external HTTP APIs. Pure offline transform of the raw SerpAPI google_events
 * captures (scripts/capture-raw.js --events) into a human-reviewable file.
 * Import to Firestore is a separate task, after Jarrod approves the output.
 *
 * Pipeline: captured -> deduped -> relevance-passed -> date-parsed ->
 * venue-matched -> ACCEPTED. Every rejection is counted and grouped by reason.
 *
 * Venue matching needs the ~768 `venues` docs, which live only in Firestore
 * — there is no local export of the full venue collection in this repo (only
 * `scripts/data/flagged-venues.json`, 7 curated demo venues, not the full set).
 * This script queries Firestore `venues` READ-ONLY (.get() only — see
 * fetchVenuesFromFirestore, never a .set/.update/.delete/.add call) using the
 * same firebase-admin + serviceAccount.json pattern already used by
 * scripts/migrateVenues.js, scripts/repair-deal-venues.js, etc. "Do not call
 * any API" (task DO NOT list) is read here as "do not call SerpAPI / Google
 * Places" (capture-raw.js's job, named in the same breath) — not Firestore
 * reads, which the task's own SCOPE line explicitly allows ("Read-only
 * against Firestore"). Flagging this reading in the PR for confirmation.
 *
 * For offline iteration without live credentials, --venues=<path> points at
 * a local JSON snapshot instead (array of venue docs, or {venues: [...]});
 * this is checked first and Firestore is never touched if it's present.
 *
 * Core transform logic (normalizeText, year inference, date parsing,
 * night-of semantics, venue matching, relevance gate) lives in
 * functions/src/intel/eventTransformCore.ts — this script requires the
 * compiled output (same build-output pattern as
 * functions/scripts/test-apify-normalize.js) so there is ONE source of
 * truth, shared with the onVenueIntelApproved Cloud Function. Build first:
 *
 *   (cd functions && npm run build)
 *
 * Usage:
 *   node scripts/transform-events.js
 *   node scripts/transform-events.js --events-dir=data/raw/events --venues=scripts/data/venues-snapshot.json --out=scripts/data/events-review.json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TIMEZONE = 'America/New_York';
const MARKET = 'Atlanta';

const {
  normalizeText,
  parseDateISO,
  parseTimes,
  computeNightOf,
  looksLikePlaceName,
  nonNightlifeReason,
  buildVenueIndex,
  matchVenue,
} = require(path.join(ROOT, 'functions', 'lib', 'intel', 'eventTransformCore.js'));

// ── CLI ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getOpt = (name, fallback) => {
  const found = argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const EVENTS_DIR = path.resolve(ROOT, getOpt('events-dir', 'data/raw/events'));
const OUT_PATH = path.resolve(ROOT, getOpt('out', 'scripts/data/events-review.json'));
const VENUES_SNAPSHOT_ARG = getOpt('venues', null);
const DEFAULT_VENUES_SNAPSHOT = path.join(ROOT, 'scripts/data/venues-snapshot.json');
const SERVICE_ACCOUNT_PATH = path.join(ROOT, 'mobile-app/scripts/serviceAccount.json');

// ── Venue source ─────────────────────────────────────────────────────
async function loadVenues() {
  const snapshotPath = VENUES_SNAPSHOT_ARG
    ? path.resolve(ROOT, VENUES_SNAPSHOT_ARG)
    : (fs.existsSync(DEFAULT_VENUES_SNAPSHOT) ? DEFAULT_VENUES_SNAPSHOT : null);

  if (snapshotPath) {
    if (!fs.existsSync(snapshotPath)) {
      console.error(`ERR  --venues="${VENUES_SNAPSHOT_ARG}" does not exist`);
      process.exit(1);
    }
    const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const venues = Array.isArray(parsed) ? parsed : parsed.venues;
    console.log(`Venues:       ${venues.length} (local snapshot: ${path.relative(ROOT, snapshotPath)})`);
    return venues;
  }

  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error('ERR  No venue data source available.');
    console.error(`     Missing both a local snapshot (--venues=<path>) and`);
    console.error(`     ${path.relative(ROOT, SERVICE_ACCOUNT_PATH)} (Firebase Admin credential).`);
    console.error('     Provide one — venue matching cannot run without the venues list.');
    process.exit(1);
  }

  // eslint-disable-next-line global-require
  const admin = require('firebase-admin');
  const sa = require(SERVICE_ACCOUNT_PATH);
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
  }
  const db = admin.firestore();
  const snapshot = await db.collection('venues').get(); // READ-ONLY — .get() only
  const venues = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  console.log(`Venues:       ${venues.length} (live Firestore, read-only)`);
  return venues;
}

// ── Load captured events ─────────────────────────────────────────────
function loadCapturedEvents() {
  if (!fs.existsSync(EVENTS_DIR)) {
    console.error(`ERR  ${path.relative(ROOT, EVENTS_DIR)} does not exist.`);
    console.error('     Run scripts/capture-raw.js --events first (see its --areas/--max-requests flags).');
    process.exit(1);
  }
  const files = fs.readdirSync(EVENTS_DIR).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) {
    console.error(`ERR  ${path.relative(ROOT, EVENTS_DIR)} has no .json files.`);
    process.exit(1);
  }

  const events = [];
  for (const file of files) {
    const full = path.join(EVENTS_DIR, file);
    let envelope;
    try {
      envelope = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (err) {
      console.error(`WARN  skipping unreadable file ${file}: ${err.message}`);
      continue;
    }
    const raw = envelope?.response?.events_results;
    if (!Array.isArray(raw)) {
      console.log(`  (${file}) no events_results — 0 events`);
      continue;
    }
    for (const rawEvent of raw) {
      events.push({
        raw: rawEvent,
        areaSlug: envelope.areaSlug,
        area: envelope.area,
        capturedAt: envelope.capturedAt,
        sourceFile: file,
      });
    }
  }
  return events;
}

// ── Main pipeline ─────────────────────────────────────────────────────
async function main() {
  const funnel = { captured: 0, deduped: 0, relevancePassed: 0, dateParsed: 0, venueMatched: 0, accepted: 0 };
  const rejected = {
    duplicate: [],
    noVenueName: [],
    titleEqualsVenue: [],
    titleIsPlaceName: [],
    nonNightlife: [],
    dateUnparseable: [],
    venueNotInDb: [],
    venueAmbiguous: [],
  };
  const accepted = [];

  console.log(`Reading:      ${path.relative(ROOT, EVENTS_DIR)}`);
  const items = loadCapturedEvents();
  funnel.captured = items.length;

  const venues = await loadVenues();
  const venueIndex = buildVenueIndex(venues);

  // ── Dedup: same normalized title + raw start date ──────────────────
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const title = item.raw?.title;
    const startDateRaw = item.raw?.date?.start_date;
    const key = `${normalizeText(title)}|${normalizeText(startDateRaw)}`;
    if (key !== '|' && seen.has(key)) {
      rejected.duplicate.push(baseFields(item, { reason: 'duplicate' }));
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  funnel.deduped = deduped.length;

  // ── Relevance gate ──────────────────────────────────────────────────
  const relevancePassed = [];
  for (const item of deduped) {
    const title = String(item.raw?.title || '').trim();
    const venueName = item.raw?.venue?.name ? String(item.raw.venue.name).trim() : '';

    if (!venueName) {
      rejected.noVenueName.push(baseFields(item, { reason: 'no-venue-name' }));
      continue;
    }
    if (normalizeText(title) === normalizeText(venueName)) {
      rejected.titleEqualsVenue.push(baseFields(item, { reason: 'title-equals-venue-name' }));
      continue;
    }
    if (looksLikePlaceName(title)) {
      rejected.titleIsPlaceName.push(baseFields(item, { reason: 'title-is-place-or-city-name' }));
      continue;
    }
    if (nonNightlifeReason(title)) {
      rejected.nonNightlife.push(baseFields(item, { reason: 'non-nightlife-keyword' }));
      continue;
    }
    relevancePassed.push(item);
  }
  funnel.relevancePassed = relevancePassed.length;

  // ── Date parsing (year inference) ───────────────────────────────────
  const dateParsed = [];
  for (const item of relevancePassed) {
    const startDateRaw = item.raw?.date?.start_date;
    const dateISO = parseDateISO(startDateRaw, item.capturedAt);
    if (!dateISO) {
      rejected.dateUnparseable.push(baseFields(item, { reason: 'date-unparseable' }));
      continue;
    }
    const { startTime, endTime } = parseTimes(item.raw?.date?.when);
    dateParsed.push({ ...item, dateISO, startTime, endTime });
  }
  funnel.dateParsed = dateParsed.length;

  // ── Venue matching ──────────────────────────────────────────────────
  const venueMatched = [];
  for (const item of dateParsed) {
    const venueName = String(item.raw.venue.name).trim();
    const match = matchVenue(venueName, venueIndex);
    if (match.status === 'unmatched') {
      rejected.venueNotInDb.push(baseFields(item, { reason: 'venue-not-in-our-db' }));
      continue;
    }
    if (match.status === 'ambiguous') {
      rejected.venueAmbiguous.push(baseFields(item, {
        reason: 'venue-ambiguous',
        candidates: match.candidates.map((v) => ({ id: v.id, name: v.name })),
      }));
      continue;
    }
    venueMatched.push({ ...item, venueId: match.venue.id, venueMatchedName: match.venue.name, venueMatchVia: match.via });
  }
  funnel.venueMatched = venueMatched.length;

  // ── Accepted ──────────────────────────────────────────────────────
  for (const item of venueMatched) {
    const title = String(item.raw.title).trim();
    const venueName = String(item.raw.venue.name).trim();
    const nightOf = computeNightOf(item.dateISO, item.startTime);
    accepted.push({
      title,
      venueName,
      venueId: item.venueId,
      dateISO: item.dateISO,
      nightOf,
      timezone: TIMEZONE,
      startTime: item.startTime || null,
      endTime: item.endTime || null,
      isRecurring: false,
      recurrenceRule: null,
      sourceUrl: item.raw.link || null,
      about: item.raw.description || undefined,
      market: MARKET,
      source: 'serpapi',
      areaSlug: item.areaSlug,
    });
  }
  funnel.accepted = accepted.length;

  // ── Write review file ───────────────────────────────────────────────
  const out = {
    generatedAt: new Date().toISOString(),
    input: { sourceDir: path.relative(ROOT, EVENTS_DIR), totalCaptured: funnel.captured },
    funnel,
    accepted,
    rejected,
    counts: {
      byReason: Object.fromEntries(Object.entries(rejected).map(([k, v]) => [k, v.length])),
    },
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));

  printSummary(funnel, rejected, accepted);
  console.log(`\nWrote ${path.relative(ROOT, OUT_PATH)}`);
}

function baseFields(item, extra) {
  return {
    title: item.raw?.title ?? null,
    venueName: item.raw?.venue?.name ?? null,
    dateRaw: item.raw?.date?.start_date ?? null,
    dateISO: item.dateISO ?? null,
    sourceUrl: item.raw?.link ?? null,
    areaSlug: item.areaSlug,
    sourceFile: item.sourceFile,
    ...extra,
  };
}

function printSummary(funnel, rejected, accepted) {
  console.log('\n── Funnel ──────────────────────────────────────────────');
  console.log(`captured(${funnel.captured}) -> deduped(${funnel.deduped}) -> relevance-passed(${funnel.relevancePassed}) -> date-parsed(${funnel.dateParsed}) -> venue-matched(${funnel.venueMatched}) -> ACCEPTED(${funnel.accepted})`);

  console.log('\n── Rejected, grouped by reason ─────────────────────────');
  for (const [reason, list] of Object.entries(rejected)) {
    console.log(`  ${reason}: ${list.length}`);
  }
  const coverageGap = rejected.venueNotInDb.length;
  console.log(`\n  NOTE: venue-not-in-our-db (${coverageGap}) is a COVERAGE gap, not a quality issue —`);
  console.log('  those venues aren\'t in our 768-venue DB yet, distinct from every other rejection reason.');

  if (rejected.venueAmbiguous.length) {
    console.log('\n── Ambiguous venue matches (REPORT — never guessed) ───');
    for (const item of rejected.venueAmbiguous) {
      const candidateNames = item.candidates.map((c) => `${c.name} (${c.id})`).join(', ');
      console.log(`  "${item.venueName}" (event: "${item.title}") -> ${candidateNames}`);
    }
  }

  console.log(`\n── Accepted (${accepted.length}) ───────────────────────────────────────`);
  for (const item of accepted) {
    console.log(`  ${item.dateISO} (night of ${item.nightOf})${item.startTime ? ' ' + item.startTime : ''} — "${item.title}" @ ${item.venueName} [${item.venueId}]`);
  }
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
