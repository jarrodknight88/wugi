#!/usr/bin/env node
/**
 * Wugi — Raw capture: Google Places + SerpAPI Google Events → data/raw/
 *
 * ACQUISITION only. Captures complete, unmodified API responses to disk.
 * Zero Firestore writes, zero transformation. Pairs with
 * mobile-app/scripts/scrape/03-transform-and-write.js (INFRA-VENUE-01
 * phase 3), which does the offline transform + write from cached JSON —
 * that way every logic change is free to re-run; only the initial capture
 * costs API credits.
 *
 * Output layout (all under data/raw/, gitignored):
 *   places/search/{areaSlug}__{querySlug}.json   raw Places searchText response
 *   places/details/{placeId}.json                raw Places Details response (full field mask, incl. reviews)
 *   events/{areaSlug}.json                        raw SerpAPI google_events response
 *   manifest/run-{timestamp}.json                 per-run manifest
 *
 * Every file is the verbatim API response wrapped in a thin capture
 * envelope ({capturedAt, ...request metadata, response}) — no fields are
 * dropped or renamed. This deliberately does NOT reproduce the exact
 * data/raw/phase2-details-result.json single-file shape that
 * 03-transform-and-write.js reads today: resumability requires one file
 * per unit of work (per query, per place, per area) so a crash only
 * costs the in-flight request, not the whole run. A follow-up transform
 * step will fold places/details/*.json into whatever shape the phase-3
 * writer (or its successor) expects.
 *
 * Usage:
 *   node scripts/capture-raw.js --dry-run --places --events
 *   node scripts/capture-raw.js --places --areas="Midtown,Buckhead" --max-requests=3
 *   node scripts/capture-raw.js --places --events --max-requests=500
 *
 * Flags:
 *   --places            capture venue discovery (Places API text search + details)
 *   --events            capture SerpAPI Google Events
 *   --areas="a,b,c"     limit to these neighborhoods (name or slug, case-insensitive)
 *   --max-requests=N    hard ceiling on total HTTP requests issued this run
 *   --dry-run           print the plan and issue ZERO API calls
 *
 * Credentials: mobile-app/scripts/.env → GOOGLE_PLACES_API_KEY, SERP_API_KEY.
 * Keys are never logged; redact() strips them from any printed URL/error.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, 'mobile-app/scripts/.env');

// ── Minimal .env loader (no new npm dependency) ──────────────────────────
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile(ENV_PATH);

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY || '';
const SERP_KEY = process.env.SERP_API_KEY || '';

// ── Redaction — never let a key reach stdout/stderr ─────────────────────
function redact(input) {
  let s = String(input);
  for (const secret of [GOOGLE_KEY, SERP_KEY]) {
    if (secret) s = s.split(secret).join('[REDACTED]');
  }
  s = s.replace(/([?&](?:key|api_key)=)[^&\s"']+/gi, '$1[REDACTED]');
  return s;
}

// ── CLI ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const getOpt = (name) => {
  const found = argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

const DO_PLACES = hasFlag('places');
const DO_EVENTS = hasFlag('events');
const DRY_RUN = hasFlag('dry-run');
const AREAS_ARG = getOpt('areas');

const maxRequestsRaw = getOpt('max-requests');
let MAX_REQUESTS = Infinity;
if (maxRequestsRaw != null) {
  const parsed = Number(maxRequestsRaw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.error(`ERR  --max-requests must be a non-negative number, got "${maxRequestsRaw}"`);
    process.exit(1);
  }
  MAX_REQUESTS = parsed;
}

if (!DO_PLACES && !DO_EVENTS) {
  console.log([
    'Usage: node scripts/capture-raw.js [--places] [--events] [--areas="a,b,c"] [--max-requests=N] [--dry-run]',
    '',
    'At least one of --places or --events is required.',
  ].join('\n'));
  process.exit(1);
}

// ── Atlanta neighborhoods ────────────────────────────────────────────────
// Intentionally duplicated from mobile-app/scripts/importPlaces.js (a plain
// data literal, not shared code) rather than requiring that file — it's
// being edited by another task in parallel and isn't set up to be imported.
const NEIGHBORHOODS = [
  { name: 'Midtown', slug: 'midtown', center: { latitude: 33.7950, longitude: -84.3850 },
    searchQueries: ['bars', 'nightclubs', 'lounges', 'rooftop bars', 'cocktail bars', 'restaurants'] },
  { name: 'Buckhead', slug: 'buckhead', center: { latitude: 33.8450, longitude: -84.3750 },
    searchQueries: ['bars', 'nightclubs', 'lounges', 'upscale restaurants', 'cocktail bars'] },
  { name: 'Old Fourth Ward', slug: 'old-fourth-ward', center: { latitude: 33.7675, longitude: -84.3750 },
    searchQueries: ['bars', 'nightclubs', 'restaurants', 'cocktail bars', 'lounges'] },
  { name: 'East Atlanta Village', slug: 'east-atlanta-village', center: { latitude: 33.7300, longitude: -84.3500 },
    searchQueries: ['bars', 'dive bars', 'live music venues', 'restaurants'] },
  { name: 'Westside', slug: 'westside', center: { latitude: 33.7750, longitude: -84.4200 },
    searchQueries: ['bars', 'restaurants', 'cocktail bars', 'breweries'] },
  { name: 'Downtown', slug: 'downtown', center: { latitude: 33.7550, longitude: -84.3900 },
    searchQueries: ['bars', 'nightclubs', 'restaurants', 'lounges', 'sports bars'] },
  { name: 'Inman Park', slug: 'inman-park', center: { latitude: 33.7550, longitude: -84.3650 },
    searchQueries: ['bars', 'restaurants', 'cocktail bars'] },
  { name: 'Virginia Highland', slug: 'virginia-highland', center: { latitude: 33.7800, longitude: -84.3650 },
    searchQueries: ['bars', 'restaurants', 'cocktail bars', 'wine bars'] },
  { name: 'Little Five Points', slug: 'little-five-points', center: { latitude: 33.7575, longitude: -84.3625 },
    searchQueries: ['bars', 'dive bars', 'live music', 'restaurants'] },
  { name: 'Summerhill', slug: 'summerhill', center: { latitude: 33.7350, longitude: -84.3850 },
    searchQueries: ['bars', 'restaurants', 'cocktail bars'] },
  { name: 'Decatur', slug: 'decatur', center: { latitude: 33.7700, longitude: -84.3000 },
    searchQueries: ['bars', 'restaurants', 'breweries', 'cocktail bars'] },
  { name: 'Sandy Springs', slug: 'sandy-springs', center: { latitude: 33.9200, longitude: -84.3650 },
    searchQueries: ['bars', 'restaurants', 'lounges', 'nightclubs'] },
  { name: 'Castleberry Hill', slug: 'castleberry-hill', center: { latitude: 33.7400, longitude: -84.4050 },
    searchQueries: ['bars', 'nightclubs', 'art bars', 'restaurants'] },
];

function resolveAreas() {
  if (!AREAS_ARG) return NEIGHBORHOODS;
  const wanted = AREAS_ARG.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const matched = NEIGHBORHOODS.filter((a) =>
    wanted.some((w) => a.slug.toLowerCase() === w || a.name.toLowerCase() === w || a.name.toLowerCase().includes(w))
  );
  if (!matched.length) {
    console.error(`ERR  --areas="${AREAS_ARG}" matched no known neighborhood`);
    process.exit(1);
  }
  return matched;
}

// ── Paths ────────────────────────────────────────────────────────────────
const RAW_ROOT = path.join(ROOT, 'data/raw');
const SEARCH_DIR = path.join(RAW_ROOT, 'places/search');
const DETAILS_DIR = path.join(RAW_ROOT, 'places/details');
const EVENTS_DIR = path.join(RAW_ROOT, 'events');
const MANIFEST_DIR = path.join(RAW_ROOT, 'manifest');

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}
function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJsonAtomic(finalPath, obj) {
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const tmp = path.join(path.dirname(finalPath), `.tmp-${path.basename(finalPath)}-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, finalPath); // atomic — a crash mid-write never leaves a file that looks "captured"
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// ── Budget (--max-requests hard ceiling) ─────────────────────────────────
class BudgetExceeded extends Error {}
let requestsIssued = 0;
function assertBudget() {
  if (requestsIssued >= MAX_REQUESTS) throw new BudgetExceeded();
}

// ── Rate limiting ─────────────────────────────────────────────────────────
const HOUR_MS = 60 * 60 * 1000;
const SERP_HOURLY_CAP = 950; // SerpAPI hard caps at 1000/hour — stay under with margin
const SERP_MIN_DELAY_MS = 300;
const PLACES_MIN_DELAY_MS = 120; // no documented Google cap; be polite anyway
const serpTimestamps = [];

async function throttleSerp() {
  const now = Date.now();
  while (serpTimestamps.length && now - serpTimestamps[0] > HOUR_MS) serpTimestamps.shift();
  if (serpTimestamps.length >= SERP_HOURLY_CAP) {
    const waitMs = HOUR_MS - (now - serpTimestamps[0]) + 1000;
    console.log(`[rate-limit] SerpAPI hourly cap reached — sleeping ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
  }
  await sleep(SERP_MIN_DELAY_MS);
}

async function fetchWithBackoff(url, options, label) {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      if (attempt >= maxAttempts) throw new Error(`${label} network error: ${redact(err.message)}`);
      await sleep(Math.min(2000 * 2 ** attempt, 60000));
      continue;
    }
    if (res.status === 429 && attempt < maxAttempts) {
      const retryAfter = res.headers.get('retry-after');
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.min(5000 * 2 ** attempt, 5 * 60 * 1000);
      console.log(`[429] ${label} — backing off ${Math.ceil(waitMs / 1000)}s (attempt ${attempt}/${maxAttempts})`);
      await sleep(waitMs);
      continue;
    }
    return res;
  }
  throw new Error(`${label} exhausted retries`);
}

// ── Places API v1 field masks ─────────────────────────────────────────────
// Search stays lean (cheap, called many times, mostly for ID discovery).
// Details requests the full superset — including `reviews`, the pricier
// tier — because it's called at most once per unique place (resumable).
const PLACES_SEARCH_FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.types', 'places.primaryType', 'places.businessStatus',
  'places.rating', 'places.userRatingCount',
].join(',');

const PLACES_DETAILS_FIELD_MASK = [
  'id', 'displayName', 'formattedAddress', 'addressComponents',
  'nationalPhoneNumber', 'internationalPhoneNumber', 'websiteUri',
  'rating', 'userRatingCount', 'priceLevel', 'types', 'primaryType', 'primaryTypeDisplayName',
  'location', 'viewport',
  'currentOpeningHours', 'regularOpeningHours', // whole-message masks — includes specialDays, weekdayDescriptions, periods, etc.
  'photos.name', 'photos.widthPx', 'photos.heightPx', 'photos.authorAttributions',
  'businessStatus', 'parkingOptions', 'editorialSummary', 'reviews',
  'reservable', 'googleMapsUri',
].join(',');

// ── Stats + manifest ───────────────────────────────────────────────────────
const stats = {
  places: { searchRequests: 0, searchSkipped: 0, searchCaptured: 0, detailsRequests: 0, detailsSkipped: 0, detailsCaptured: 0 },
  events: { requests: 0, skipped: 0, captured: 0 },
};
const queriesIssued = [];
const manifestErrors = [];

// ── Places: search phase ──────────────────────────────────────────────────
async function searchPlaces(area, query) {
  assertBudget();
  await sleep(PLACES_MIN_DELAY_MS);
  requestsIssued += 1;
  stats.places.searchRequests += 1;
  queriesIssued.push({ type: 'places.search', area: area.name, query });

  const url = 'https://places.googleapis.com/v1/places:searchText';
  const body = JSON.stringify({
    textQuery: `${query} in ${area.name}, Atlanta, GA`,
    locationBias: { circle: { center: area.center, radius: 1500 } },
    maxResultCount: 20,
  });
  let res;
  try {
    res = await fetchWithBackoff(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_KEY,
        'X-Goog-FieldMask': PLACES_SEARCH_FIELD_MASK,
      },
      body,
    }, `places.searchText[${area.slug}/${slugify(query)}]`);
  } catch (err) {
    manifestErrors.push({ stage: 'places.search', area: area.slug, query, error: redact(err.message) });
    return;
  }
  const text = await res.text();
  if (!res.ok) {
    manifestErrors.push({ stage: 'places.search', area: area.slug, query, status: res.status, error: redact(text).slice(0, 500) });
    return;
  }
  const json = JSON.parse(text);
  writeJsonAtomic(path.join(SEARCH_DIR, `${area.slug}__${slugify(query)}.json`), {
    capturedAt: new Date().toISOString(),
    endpoint: 'places:searchText',
    area: area.name,
    areaSlug: area.slug,
    query,
    response: json,
  });
  stats.places.searchCaptured += 1;
}

async function runPlacesSearchPhase(areas) {
  for (const area of areas) {
    for (const query of area.searchQueries) {
      const outPath = path.join(SEARCH_DIR, `${area.slug}__${slugify(query)}.json`);
      if (fs.existsSync(outPath)) { stats.places.searchSkipped += 1; continue; }
      await searchPlaces(area, query);
    }
  }
}

function collectDiscoveredPlaceIds(areas) {
  const ids = new Set();
  for (const area of areas) {
    for (const query of area.searchQueries) {
      const p = path.join(SEARCH_DIR, `${area.slug}__${slugify(query)}.json`);
      if (!fs.existsSync(p)) continue;
      try {
        const rec = loadJson(p);
        for (const place of (rec.response && rec.response.places) || []) {
          if (place.id) ids.add(place.id);
        }
      } catch {
        // corrupt/partial file from an earlier crash — treated as not-yet-usable, will not block re-search
      }
    }
  }
  return Array.from(ids);
}

// ── Places: details phase ─────────────────────────────────────────────────
async function fetchPlaceDetails(placeId) {
  assertBudget();
  await sleep(PLACES_MIN_DELAY_MS);
  requestsIssued += 1;
  stats.places.detailsRequests += 1;
  queriesIssued.push({ type: 'places.details', placeId });

  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
  let res;
  try {
    res = await fetchWithBackoff(url, {
      headers: { 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': PLACES_DETAILS_FIELD_MASK },
    }, `places.details[${placeId}]`);
  } catch (err) {
    manifestErrors.push({ stage: 'places.details', placeId, error: redact(err.message) });
    return;
  }
  const text = await res.text();
  if (!res.ok) {
    manifestErrors.push({ stage: 'places.details', placeId, status: res.status, error: redact(text).slice(0, 500) });
    return;
  }
  const json = JSON.parse(text);
  writeJsonAtomic(path.join(DETAILS_DIR, `${placeId}.json`), {
    capturedAt: new Date().toISOString(),
    endpoint: 'places/{placeId}',
    placeId,
    response: json,
  });
  stats.places.detailsCaptured += 1;
}

async function runPlacesDetailsPhase(areas) {
  const ids = collectDiscoveredPlaceIds(areas);
  for (const placeId of ids) {
    const outPath = path.join(DETAILS_DIR, `${placeId}.json`);
    if (fs.existsSync(outPath)) { stats.places.detailsSkipped += 1; continue; }
    await fetchPlaceDetails(placeId);
  }
}

// ── Events (SerpAPI google_events) ────────────────────────────────────────
async function fetchEvents(area) {
  assertBudget();
  await throttleSerp();
  serpTimestamps.push(Date.now());
  requestsIssued += 1;
  stats.events.requests += 1;
  const query = `events in ${area.name}, Atlanta, GA`;
  queriesIssued.push({ type: 'events.search', area: area.name, query });

  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google_events');
  url.searchParams.set('q', query);
  url.searchParams.set('hl', 'en');
  url.searchParams.set('gl', 'us');
  url.searchParams.set('api_key', SERP_KEY);

  let res;
  try {
    res = await fetchWithBackoff(url.toString(), {}, `serpapi.events[${area.slug}]`);
  } catch (err) {
    manifestErrors.push({ stage: 'events', area: area.slug, error: redact(err.message) });
    return;
  }
  const text = await res.text();
  if (!res.ok) {
    manifestErrors.push({ stage: 'events', area: area.slug, status: res.status, error: redact(text).slice(0, 500) });
    return;
  }
  const json = JSON.parse(text);
  writeJsonAtomic(path.join(EVENTS_DIR, `${area.slug}.json`), {
    capturedAt: new Date().toISOString(),
    endpoint: 'serpapi:google_events',
    area: area.name,
    areaSlug: area.slug,
    query,
    response: json,
  });
  stats.events.captured += 1;
}

async function runEventsPhase(areas) {
  for (const area of areas) {
    const outPath = path.join(EVENTS_DIR, `${area.slug}.json`);
    if (fs.existsSync(outPath)) { stats.events.skipped += 1; continue; }
    await fetchEvents(area);
  }
}

// ── Dry run ────────────────────────────────────────────────────────────────
function printPlan(areas) {
  console.log('DRY RUN — plan only, zero API calls issued.\n');
  console.log(`Mode:         ${[DO_PLACES && 'places', DO_EVENTS && 'events'].filter(Boolean).join(' + ')}`);
  console.log(`Areas (${areas.length}): ${areas.map((a) => a.name).join(', ')}`);
  console.log(`Max requests: ${MAX_REQUESTS === Infinity ? 'unlimited' : MAX_REQUESTS}`);

  if (DO_PLACES) {
    let searchDone = 0;
    const searchPending = [];
    for (const area of areas) {
      for (const query of area.searchQueries) {
        const p = path.join(SEARCH_DIR, `${area.slug}__${slugify(query)}.json`);
        if (fs.existsSync(p)) searchDone += 1;
        else searchPending.push(`${area.name}/${query}`);
      }
    }
    const discovered = collectDiscoveredPlaceIds(areas);
    const detailsPending = discovered.filter((id) => !fs.existsSync(path.join(DETAILS_DIR, `${id}.json`)));
    console.log('\nPlaces:');
    console.log(`  search queries already captured:      ${searchDone}`);
    console.log(`  search queries pending:                ${searchPending.length}`);
    console.log(`  place IDs discovered from prior runs:  ${discovered.length}`);
    console.log(`  place details already captured:        ${discovered.length - detailsPending.length}`);
    console.log(`  place details pending (known so far):  ${detailsPending.length}`);
    console.log('  (running pending searches will discover more place IDs to fetch details for)');
    if (!GOOGLE_KEY) console.log('  [warn] GOOGLE_PLACES_API_KEY not set — a live run would fail fast.');
  }

  if (DO_EVENTS) {
    let eventsDone = 0;
    const eventsPending = [];
    for (const area of areas) {
      const p = path.join(EVENTS_DIR, `${area.slug}.json`);
      if (fs.existsSync(p)) eventsDone += 1;
      else eventsPending.push(area.name);
    }
    console.log('\nEvents:');
    console.log(`  area queries already captured: ${eventsDone}`);
    console.log(`  area queries pending:          ${eventsPending.length} (${eventsPending.join(', ') || 'none'})`);
    if (!SERP_KEY) console.log('  [warn] SERP_API_KEY not set — a live run would fail fast.');
  }
}

// ── Manifest ────────────────────────────────────────────────────────────
function writeManifest(startedAt, areas) {
  const finishedAt = new Date().toISOString();
  const record = {
    startedAt,
    finishedAt,
    argv: redact(argv.join(' ')),
    areas: areas.map((a) => a.name),
    maxRequests: MAX_REQUESTS === Infinity ? null : MAX_REQUESTS,
    requestsIssued,
    requestCountsByApi: {
      places: stats.places.searchRequests + stats.places.detailsRequests,
      serpapi: stats.events.requests,
    },
    queriesIssued,
    resultsCaptured: {
      placesSearch: stats.places.searchCaptured,
      placeDetails: stats.places.detailsCaptured,
      events: stats.events.captured,
    },
    skipped: {
      placesSearch: stats.places.searchSkipped,
      placeDetails: stats.places.detailsSkipped,
      events: stats.events.skipped,
    },
    errors: manifestErrors,
  };
  const fname = `run-${finishedAt.replace(/[:.]/g, '-')}.json`;
  writeJsonAtomic(path.join(MANIFEST_DIR, fname), record);
  return { record, fname };
}

function printSummary() {
  console.log('\n───────────────────────────────────────────────────────');
  console.log(`Requests issued this run: ${requestsIssued}${MAX_REQUESTS === Infinity ? '' : ` / ${MAX_REQUESTS} budget`}`);
  console.log(`Places search — captured ${stats.places.searchCaptured}, skipped(already captured) ${stats.places.searchSkipped}`);
  console.log(`Places details — captured ${stats.places.detailsCaptured}, skipped(already captured) ${stats.places.detailsSkipped}`);
  console.log(`Events — captured ${stats.events.captured}, skipped(already captured) ${stats.events.skipped}`);
  if (manifestErrors.length) {
    console.log(`Errors: ${manifestErrors.length}`);
    for (const e of manifestErrors.slice(0, 10)) console.log(`  ${redact(JSON.stringify(e))}`);
  }
}

function validateCredentials() {
  if (DO_PLACES && !GOOGLE_KEY) {
    console.error(`ERR  GOOGLE_PLACES_API_KEY not found (expected in ${path.relative(ROOT, ENV_PATH)})`);
    process.exit(1);
  }
  if (DO_EVENTS && !SERP_KEY) {
    console.error(`ERR  SERP_API_KEY not found (expected in ${path.relative(ROOT, ENV_PATH)})`);
    process.exit(1);
  }
}

// ── Main ───────────────────────────────────────────────────────────────
(async function main() {
  const areas = resolveAreas();

  if (DRY_RUN) {
    printPlan(areas);
    process.exit(0);
  }

  validateCredentials();
  const startedAt = new Date().toISOString();
  console.log(`capture-raw — ${startedAt} — mode=${[DO_PLACES && 'places', DO_EVENTS && 'events'].filter(Boolean).join('+')} areas=${areas.length} maxRequests=${MAX_REQUESTS === Infinity ? 'unlimited' : MAX_REQUESTS}`);

  try {
    if (DO_PLACES) {
      await runPlacesSearchPhase(areas);
      await runPlacesDetailsPhase(areas);
    }
    if (DO_EVENTS) {
      await runEventsPhase(areas);
    }
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      console.log(`\n[budget] --max-requests=${MAX_REQUESTS} reached — stopping cleanly (resumable next run).`);
    } else {
      manifestErrors.push({ stage: 'fatal', error: redact(err && err.stack ? err.stack : String(err)) });
      console.error(redact(err && err.stack ? err.stack : String(err)));
    }
  }

  const { fname } = writeManifest(startedAt, areas);
  printSummary();
  console.log(`\nManifest: ${path.relative(ROOT, path.join(MANIFEST_DIR, fname))}`);
  process.exit(0);
})();
