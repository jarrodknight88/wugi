#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — runTargetedScrape request-builder test
//
// Plain-Node smoke test (no test framework in this repo — see
// package.json). Exercises the pure handle-normalization and direct-run
// request-builder functions in src/bridge/runTargetedScrape.ts against the
// compiled lib/ output, so it needs a build first:
//
//   npm run build && node scripts/test-run-targeted-scrape.js
//
// or just: npm run test:run-targeted-scrape
//
// The HTTP handler itself (auth check + Apify fetch calls + Firestore
// write) is thin glue over these pure functions and isn't covered here —
// same precedent as apifyWebhook.ts's own handler vs.
// mapApifyItemToVenueIntelDoc (see test-apify-normalize.js).
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  normalizeInstagramHandle,
  normalizeTargetType,
  normalizeVenueId,
  buildTargetedScrapeRunRequest,
  DEFAULT_RESULTS_LIMIT,
} = require(path.join(__dirname, '..', 'lib', 'bridge', 'runTargetedScrape.js'));

let passed = 0;
function check(label, fn) {
  try {
    fn();
    passed++;
    console.log(`ok   - ${label}`);
  } catch (err) {
    console.error(`FAIL - ${label}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// ── normalizeInstagramHandle ────────────────────────────────────────

check('plain handle passes through unchanged', () => {
  assert.equal(normalizeInstagramHandle('atl_nightlife'), 'atl_nightlife');
});

check('trims surrounding whitespace', () => {
  assert.equal(normalizeInstagramHandle('  atl_nightlife  '), 'atl_nightlife');
});

check('strips a leading @', () => {
  assert.equal(normalizeInstagramHandle('@atl_nightlife'), 'atl_nightlife');
});

check('extracts the username from a pasted full profile URL', () => {
  assert.equal(normalizeInstagramHandle('https://www.instagram.com/atl_nightlife/'), 'atl_nightlife');
  assert.equal(normalizeInstagramHandle('https://instagram.com/atl_nightlife'), 'atl_nightlife');
  assert.equal(normalizeInstagramHandle('http://www.instagram.com/atl_nightlife?hl=en'), 'atl_nightlife');
});

check('rejects a non-Instagram URL', () => {
  assert.equal(normalizeInstagramHandle('https://www.twitter.com/atl_nightlife'), null);
});

check('rejects a handle with invalid charset', () => {
  assert.equal(normalizeInstagramHandle('atl nightlife!'), null);
  assert.equal(normalizeInstagramHandle('atl#nightlife'), null);
});

check('rejects a handle over 30 characters', () => {
  assert.equal(normalizeInstagramHandle('a'.repeat(31)), null);
});

check('rejects empty/whitespace-only/non-string input', () => {
  assert.equal(normalizeInstagramHandle(''), null);
  assert.equal(normalizeInstagramHandle('   '), null);
  assert.equal(normalizeInstagramHandle(undefined), null);
  assert.equal(normalizeInstagramHandle(null), null);
  assert.equal(normalizeInstagramHandle(42), null);
});

// ── normalizeTargetType ──────────────────────────────────────────────

check('accepts each valid targetType', () => {
  for (const t of ['venue', 'event', 'influencer', 'other']) {
    assert.equal(normalizeTargetType(t), t);
  }
});

check('defaults an unrecognized or missing targetType to other', () => {
  assert.equal(normalizeTargetType('bogus'), 'other');
  assert.equal(normalizeTargetType(undefined), 'other');
  assert.equal(normalizeTargetType(null), 'other');
});

// ── normalizeVenueId ─────────────────────────────────────────────────

check('passes through a non-empty venueId string', () => {
  assert.equal(normalizeVenueId('venue_123'), 'venue_123');
});

check('normalizes a missing/empty venueId to null', () => {
  assert.equal(normalizeVenueId(undefined), null);
  assert.equal(normalizeVenueId(''), null);
  assert.equal(normalizeVenueId('   '), null);
  assert.equal(normalizeVenueId(42), null);
});

// ── buildTargetedScrapeRunRequest ────────────────────────────────────

check('builds directUrls from the normalized handle', () => {
  const req = buildTargetedScrapeRunRequest({
    handle: 'atl_nightlife',
    actorId: 'apify~instagram-scraper',
    resultsType: 'posts',
    webhookTargetUrl: 'https://us-central1-wugi-prod.cloudfunctions.net/apifyWebhook',
  });
  assert.deepEqual(req.body.directUrls, ['https://www.instagram.com/atl_nightlife/']);
  assert.equal(req.body.resultsType, 'posts');
});

check('defaults resultsLimit to 30, overridable', () => {
  const withDefault = buildTargetedScrapeRunRequest({
    handle: 'atl_nightlife',
    actorId: 'apify~instagram-scraper',
    resultsType: 'posts',
    webhookTargetUrl: 'https://example.com/webhook',
  });
  assert.equal(withDefault.body.resultsLimit, DEFAULT_RESULTS_LIMIT);
  assert.equal(withDefault.body.resultsLimit, 30);

  const withOverride = buildTargetedScrapeRunRequest({
    handle: 'atl_nightlife',
    actorId: 'apify~instagram-scraper',
    resultsType: 'posts',
    webhookTargetUrl: 'https://example.com/webhook',
    resultsLimit: 50,
  });
  assert.equal(withOverride.body.resultsLimit, 50);
});

check('run URL targets the resolved actorId, URL-encoded', () => {
  const req = buildTargetedScrapeRunRequest({
    handle: 'atl_nightlife',
    actorId: 'apify~instagram-scraper',
    resultsType: 'posts',
    webhookTargetUrl: 'https://example.com/webhook',
  });
  assert.ok(req.url.startsWith('https://api.apify.com/v2/acts/apify~instagram-scraper/runs?webhooks='));
});

check('webhooks query param base64-decodes to a well-formed ad-hoc webhook spec', () => {
  const req = buildTargetedScrapeRunRequest({
    handle: 'atl_nightlife',
    actorId: 'apify~instagram-scraper',
    resultsType: 'posts',
    webhookTargetUrl: 'https://us-central1-wugi-prod.cloudfunctions.net/apifyWebhook',
  });
  const webhooksParam = new URL(req.url).searchParams.get('webhooks');
  const decoded = JSON.parse(Buffer.from(webhooksParam, 'base64').toString('utf8'));

  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0].eventTypes, ['ACTOR.RUN.SUCCEEDED']);
  assert.equal(decoded[0].requestUrl, 'https://us-central1-wugi-prod.cloudfunctions.net/apifyWebhook');

  // The payload template itself must render into exactly the shape
  // apifyWebhook expects — eventType + resource.id/actId/defaultDatasetId —
  // so ingestion needs zero changes.
  const renderedPayload = decoded[0].payloadTemplate
    .replace('{{resource.id}}', 'run_123')
    .replace('{{resource.actId}}', 'apify~instagram-scraper')
    .replace('{{resource.defaultDatasetId}}', 'dataset_456');
  const parsedPayload = JSON.parse(renderedPayload);
  assert.equal(parsedPayload.eventType, 'ACTOR.RUN.SUCCEEDED');
  assert.equal(parsedPayload.resource.id, 'run_123');
  assert.equal(parsedPayload.resource.actId, 'apify~instagram-scraper');
  assert.equal(parsedPayload.resource.defaultDatasetId, 'dataset_456');
});

console.log(`\n${passed} check(s) passed`);
if (process.exitCode) {
  console.error('\nSome checks FAILED — see above.');
  process.exit(process.exitCode);
}
