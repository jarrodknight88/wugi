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
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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

// ── Small utils ──────────────────────────────────────────────────────────
function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'at']);
function significantWords(normalized) {
  return normalized.split(' ').filter((w) => w && !STOPWORDS.has(w));
}

// ── 1. Year inference ─────────────────────────────────────────────────
// SerpAPI date.start_date is yearless ("Aug 1", "Jul 30"). Anchor on the
// capturing file's capturedAt; if the same-year candidate lands more than
// ~30 days BEFORE capturedAt, it must mean next year (Dec capture, "Jan 4").
const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const START_DATE_RE = /^([A-Za-z]{3,9})\s+(\d{1,2})\b/;

function parseDateISO(startDateStr, capturedAt) {
  if (!startDateStr || typeof startDateStr !== 'string') return null;
  const m = startDateStr.trim().match(START_DATE_RE);
  if (!m) return null;
  const monKey = m[1].slice(0, 3).toLowerCase();
  const day = parseInt(m[2], 10);
  if (!(monKey in MONTHS) || !Number.isInteger(day) || day < 1 || day > 31) return null;
  const month = MONTHS[monKey];

  const capturedDate = new Date(capturedAt);
  if (Number.isNaN(capturedDate.getTime())) return null;
  const capturedYear = capturedDate.getUTCFullYear();

  let candidate = new Date(Date.UTC(capturedYear, month, day));
  if (candidate.getUTCMonth() !== month) return null; // invalid day-for-month (e.g. Feb 30)

  if (capturedDate.getTime() - candidate.getTime() > THIRTY_DAYS_MS) {
    candidate = new Date(Date.UTC(capturedYear + 1, month, day));
    if (candidate.getUTCMonth() !== month) return null;
  }
  return candidate.toISOString().slice(0, 10);
}

// date.when e.g. "Sat, 11 AM – 9 PM" — best-effort start/end time extraction.
// Missing/unparseable times are fine; only a missing DATE causes rejection.
const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])/g;
function parseTimes(whenStr) {
  if (!whenStr || typeof whenStr !== 'string') return {};
  const matches = [...whenStr.matchAll(TIME_RE)];
  if (!matches.length) return {};
  const to24h = (match) => {
    let h = parseInt(match[1], 10);
    const min = match[2] ? parseInt(match[2], 10) : 0;
    const meridiem = match[3].toLowerCase();
    if (meridiem === 'am') { if (h === 12) h = 0; } else if (h !== 12) { h += 12; }
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  };
  const startTime = to24h(matches[0]);
  const endTime = matches.length > 1 ? to24h(matches[1]) : undefined;
  return { startTime, endTime };
}

// nightOf: the night an event belongs to, 6AM cutoff. An event whose start
// time is after midnight but before 6AM is still "last night" to a user —
// without this, a midnight-crossing Friday event vanishes from Friday's feed.
function computeNightOf(dateISO, startTime) {
  if (!startTime) return dateISO;
  const hour = parseInt(startTime.slice(0, 2), 10);
  if (!Number.isInteger(hour) || hour >= 6) return dateISO;
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── 3. Relevance gate ──────────────────────────────────────────────────
const PLACE_NAME_RE = /^[A-Za-z][A-Za-z\s.'-]*,\s*[A-Z]{2}$/; // "Atlanta, GA", "Decatur, GA"
const KNOWN_PLACE_NAMES = new Set([
  'atlanta', 'decatur', 'buckhead', 'midtown', 'downtown', 'sandy springs',
  'marietta', 'roswell', 'alpharetta', 'smyrna', 'brookhaven', 'avondale estates',
]);

function looksLikePlaceName(title) {
  const trimmed = String(title || '').trim();
  if (PLACE_NAME_RE.test(trimmed)) return true;
  return KNOWN_PLACE_NAMES.has(trimmed.toLowerCase());
}

// Case-insensitive, word-bounded so "class" doesn't hit "classic", "run"
// doesn't hit "running", etc.
const NON_NIGHTLIFE_PATTERNS = [
  /restaurant\s*week/i,
  /\bbrunch\b/i,
  /farmers?\s*market/i,
  /\byoga\b/i,
  /\bworkshop\b/i,
  /\bclass(es)?\b/i,
  /\bkids?\b/i,
  /\bfamily\b/i,
  /\b5k\b/i,
  /\b10k\b/i,
  /\bfun run\b/i,
  /\bcareer\s*fair\b/i,
  /\bjob\s*fair\b/i,
  /\bconference\b/i,
  /\bnetworking\b/i,
  /corporate\s*dinner/i,
  /regional\s*dinner/i,
  /\bdog(gie)?\b/i,
  /\bpuppy\b/i,
  /\bpaws\b/i,
  /\bpet(s)?\b/i,
];

function nonNightlifeReason(title) {
  return NON_NIGHTLIFE_PATTERNS.some((re) => re.test(title));
}

// ── 4. Venue matching ────────────────────────────────────────────────
function buildVenueIndex(venues) {
  const byName = new Map(); // normalized name/alias -> [venue, ...]
  for (const v of venues) {
    const names = [v.name, ...(v.aliases || [])].filter(Boolean);
    for (const n of names) {
      const key = normalizeText(n);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(v);
    }
  }
  return { byName, all: venues };
}

function matchVenue(eventVenueName, index) {
  const key = normalizeText(eventVenueName);
  if (!key) return { status: 'unmatched' };

  const exact = index.byName.get(key);
  if (exact) {
    const uniq = Array.from(new Map(exact.map((v) => [v.id, v])).values());
    if (uniq.length === 1) return { status: 'matched', venue: uniq[0], via: 'exact' };
    return { status: 'ambiguous', candidates: uniq };
  }

  // Alias/contains fallback: word-subset match, ignoring stopwords, only
  // auto-accepted when exactly one candidate survives — ambiguous otherwise.
  const eventWords = significantWords(key);
  if (eventWords.length < 2) return { status: 'unmatched' }; // too generic to fuzzy-match safely

  const candidates = index.all.filter((v) => {
    const names = [v.name, ...(v.aliases || [])].filter(Boolean);
    return names.some((n) => {
      const venueWords = significantWords(normalizeText(n));
      if (venueWords.length < 2) return false;
      const isSubset = (a, b) => a.every((w) => b.includes(w));
      return isSubset(eventWords, venueWords) || isSubset(venueWords, eventWords);
    });
  });
  const uniqCandidates = Array.from(new Map(candidates.map((v) => [v.id, v])).values());
  if (uniqCandidates.length === 1) return { status: 'matched', venue: uniqCandidates[0], via: 'contains' };
  if (uniqCandidates.length > 1) return { status: 'ambiguous', candidates: uniqCandidates };
  return { status: 'unmatched' };
}

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
