#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — intel media persistence helpers test
//
// Plain-Node smoke test (no test framework in this repo — see
// package.json). Exercises the pure helpers in src/intel/intelMedia.ts
// against the compiled lib/ output, so it needs a build first:
//
//   npm run build && node scripts/test-intel-media.js
//
// or just: npm run test:intel-media
//
// downloadAndStoreIntelMedia (fetch + Storage write) is the effectful
// boundary and is intentionally NOT covered here — same split as
// apifyWebhook's fetchApifyRun/fetchDatasetItems, which also have no unit
// coverage in this repo's Node-script test style.
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildIntelMediaPath,
  selectCandidateMediaUrls,
  buildMediaAssetDoc,
  MAX_MEDIA_PER_POST,
} = require(path.join(__dirname, '..', 'lib', 'intel', 'intelMedia.js'));

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

// ── buildIntelMediaPath ─────────────────────────────────────────────

check('builds the intel-media storage path for a given index', () => {
  assert.equal(buildIntelMediaPath('abc123', 0), 'intel-media/abc123/0.jpg');
  assert.equal(buildIntelMediaPath('abc123', 2), 'intel-media/abc123/2.jpg');
});

// ── selectCandidateMediaUrls ────────────────────────────────────────

check('caps to the first 3 (MAX_MEDIA_PER_POST) URLs', () => {
  assert.equal(MAX_MEDIA_PER_POST, 3);
  const urls = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'];
  assert.deepEqual(selectCandidateMediaUrls(urls), ['a.jpg', 'b.jpg', 'c.jpg']);
});

check('respects a custom cap', () => {
  const urls = ['a.jpg', 'b.jpg', 'c.jpg'];
  assert.deepEqual(selectCandidateMediaUrls(urls, 1), ['a.jpg']);
});

check('drops obvious video URLs by extension', () => {
  const urls = ['a.jpg', 'clip.mp4', 'b.jpg', 'reel.mov?x=1', 'stream.m3u8'];
  assert.deepEqual(selectCandidateMediaUrls(urls), ['a.jpg', 'b.jpg']);
});

check('filters out non-string entries', () => {
  const urls = ['a.jpg', null, undefined, 42, 'b.jpg'];
  assert.deepEqual(selectCandidateMediaUrls(urls), ['a.jpg', 'b.jpg']);
});

check('filters out empty/whitespace-only strings', () => {
  const urls = ['a.jpg', '', '   ', 'b.jpg'];
  assert.deepEqual(selectCandidateMediaUrls(urls), ['a.jpg', 'b.jpg']);
});

check('non-array input yields an empty list', () => {
  assert.deepEqual(selectCandidateMediaUrls(undefined), []);
  assert.deepEqual(selectCandidateMediaUrls(null), []);
  assert.deepEqual(selectCandidateMediaUrls('not-an-array'), []);
});

check('preserves order (storagePaths index must match fetch order)', () => {
  const urls = ['third.jpg', 'first.jpg', 'second.jpg'];
  assert.deepEqual(selectCandidateMediaUrls(urls), urls);
});

// ── buildMediaAssetDoc ───────────────────────────────────────────────

check('builds a mediaAssets doc with rightsStatus unverified and venueId null', () => {
  const createdAt = { __sentinel: 'serverTimestamp' };
  const doc = buildMediaAssetDoc(
    {
      venueIntelId: 'intel1',
      sourceAccount: 'atl_nightlife',
      seedAccount: 'chuckyfoto',
      postUrl: 'https://www.instagram.com/p/ABC/',
      storagePaths: ['intel-media/intel1/0.jpg', 'intel-media/intel1/1.jpg'],
    },
    createdAt
  );
  assert.deepEqual(doc, {
    venueIntelId: 'intel1',
    sourceAccount: 'atl_nightlife',
    seedAccount: 'chuckyfoto',
    postUrl: 'https://www.instagram.com/p/ABC/',
    storagePaths: ['intel-media/intel1/0.jpg', 'intel-media/intel1/1.jpg'],
    rightsStatus: 'unverified',
    venueId: null,
    createdAt,
  });
});

console.log(`\n${passed} check(s) passed`);
if (process.exitCode) {
  console.error('\nSome checks FAILED — see above.');
  process.exit(process.exitCode);
}
