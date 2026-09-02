#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — apifyGalleryWebhook normalizer test (issue #267)
//
// Plain-Node smoke test (no test framework in this repo — see
// package.json), same pattern as test-apify-normalize.js. Exercises the
// pure item→doc mapper in src/bridge/apifyGalleryWebhook.ts against the
// compiled lib/ output:
//
//   npm run build && node scripts/test-apify-gallery-normalize.js
//
// or just: npm run test:apify-gallery-normalize
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const { mapGalleryItemToVenueIntelDoc, parseFlexibleEventDate } = require(
  path.join(__dirname, '..', 'lib', 'bridge', 'apifyGalleryWebhook.js')
);

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

function sha32(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
}

// ── mapGalleryItemToVenueIntelDoc ───────────────────────────────────

check('maps a full atlpics gallery item to a venueIntel doc', () => {
  const item = {
    galleryUrl: 'https://atlpics.net/gallery/2026-08-15-opium',
    eventName: 'Saturdays at Opium',
    eventDateText: 'August 15, 2026',
    venueText: 'Opium Atlanta',
    photoUrls: ['https://atlpics.net/img/1.jpg', 'https://atlpics.net/img/2.jpg'],
  };
  const result = mapGalleryItemToVenueIntelDoc(item, 'run_1', 'atlpics');
  assert.equal(result.docId, sha32(item.galleryUrl));
  assert.equal(result.docId.length, 32);
  assert.equal(result.doc.sourceAccount, 'atlpics.net');
  assert.equal(result.doc.seedAccount, 'atlpics.net');
  assert.equal(result.doc.postUrl, item.galleryUrl);
  assert.equal(result.doc.source, 'atlpics');
  assert.deepEqual(result.doc.mediaUrls, item.photoUrls);
  assert.equal(result.doc.videoUrl, null);
  assert.equal(result.doc.runId, 'run_1');
  assert.deepEqual(result.doc.mentionedHandles, []);
  assert.deepEqual(result.childVideoUrls, []);
  assert.ok(result.doc.caption.includes('Saturdays at Opium'));
  assert.ok(result.doc.caption.includes('Opium Atlanta'));
  assert.ok(result.doc.caption.includes('Aug 15'));
  assert.ok(result.doc.postedAt); // Firestore Timestamp instance — parsed from eventDateText
});

check('maps sourceAccount/source correctly for nightlifelink', () => {
  const result = mapGalleryItemToVenueIntelDoc(
    { galleryUrl: 'https://nightlifelink.com/gallery/456', photoUrls: [] },
    'run_1',
    'nightlifelink'
  );
  assert.equal(result.doc.sourceAccount, 'nightlifelink.com');
  assert.equal(result.doc.source, 'nightlifelink');
});

check('same gallery URL always hashes to the same docId (dedupe key)', () => {
  const a = mapGalleryItemToVenueIntelDoc({ galleryUrl: 'https://atlpics.net/g/same' }, 'run_1', 'atlpics');
  const b = mapGalleryItemToVenueIntelDoc({ galleryUrl: 'https://atlpics.net/g/same' }, 'run_2', 'atlpics');
  assert.equal(a.docId, b.docId);
});

check('missing galleryUrl is unmappable — returns null', () => {
  assert.equal(mapGalleryItemToVenueIntelDoc({ eventName: 'no url here' }, 'run_1', 'atlpics'), null);
  assert.equal(mapGalleryItemToVenueIntelDoc({ galleryUrl: '' }, 'run_1', 'atlpics'), null);
});

check('non-string photoUrls entries are dropped, non-array photoUrls becomes []', () => {
  const a = mapGalleryItemToVenueIntelDoc(
    { galleryUrl: 'https://atlpics.net/g/mixed', photoUrls: ['https://a/1.jpg', null, 42, ''] },
    'run_1',
    'atlpics'
  );
  assert.deepEqual(a.doc.mediaUrls, ['https://a/1.jpg']);

  const b = mapGalleryItemToVenueIntelDoc(
    { galleryUrl: 'https://atlpics.net/g/nophotos' },
    'run_1',
    'atlpics'
  );
  assert.deepEqual(b.doc.mediaUrls, []);
});

check('unparseable eventDateText is kept raw in the caption and postedAt is null', () => {
  const result = mapGalleryItemToVenueIntelDoc(
    { galleryUrl: 'https://atlpics.net/g/baddate', eventName: 'Fri Night', eventDateText: 'sometime soon' },
    'run_1',
    'atlpics'
  );
  assert.equal(result.doc.postedAt, null);
  assert.ok(result.doc.caption.includes('sometime soon'));
});

check('missing eventName/venueText/eventDateText degrade to an empty caption, never throw', () => {
  const result = mapGalleryItemToVenueIntelDoc({ galleryUrl: 'https://atlpics.net/g/bare' }, 'run_1', 'atlpics');
  assert.equal(result.doc.caption, '');
});

// ── parseFlexibleEventDate ───────────────────────────────────────────

check('parseFlexibleEventDate parses common date formats', () => {
  assert.ok(parseFlexibleEventDate('August 15, 2026'));
  assert.ok(parseFlexibleEventDate('2026-08-15'));
  assert.ok(parseFlexibleEventDate('8/15/2026'));
});

check('parseFlexibleEventDate returns null for empty/unparseable text', () => {
  assert.equal(parseFlexibleEventDate(''), null);
  assert.equal(parseFlexibleEventDate('sometime soon'), null);
});

console.log(`\n${passed} check(s) passed`);
if (process.exitCode) {
  console.error('\nFAILURES ABOVE');
  process.exit(1);
}
