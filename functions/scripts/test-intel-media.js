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
// downloadAndStoreIntelMedia and downloadAndStoreIntelVideo (fetch + Storage
// write) are the effectful boundary and are intentionally NOT covered here —
// same split as apifyWebhook's fetchApifyRun/fetchDatasetItems, which also
// have no unit coverage in this repo's Node-script test style.
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildIntelMediaPath,
  buildIntelMediaVideoPath,
  selectCandidateMediaUrls,
  selectCandidateSlideVideos,
  buildMediaAssetDoc,
  MAX_MEDIA_PER_POST,
  MAX_VIDEO_BYTES,
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

// ── buildIntelMediaVideoPath ─────────────────────────────────────────

check('builds the intel-media video storage path for a given index', () => {
  assert.equal(buildIntelMediaVideoPath('abc123', 0), 'intel-media/abc123/video0.mp4');
  assert.equal(buildIntelMediaVideoPath('abc123', 2), 'intel-media/abc123/video2.mp4');
});

check('MAX_VIDEO_BYTES is the documented ~60MB cap', () => {
  assert.equal(MAX_VIDEO_BYTES, 60 * 1024 * 1024);
});

// ── selectCandidateMediaUrls ────────────────────────────────────────

check('MAX_MEDIA_PER_POST is the issue #240 20-slide safety ceiling (Instagram\'s own carousel max)', () => {
  assert.equal(MAX_MEDIA_PER_POST, 20);
});

check('caps to the first 20 (MAX_MEDIA_PER_POST) URLs — full-carousel support, not just the first 3', () => {
  const urls = Array.from({ length: 25 }, (_, i) => `slide${i}.jpg`);
  const result = selectCandidateMediaUrls(urls);
  assert.equal(result.length, 20);
  assert.deepEqual(result, urls.slice(0, 20));
});

check('an 8-slide carousel (well under the ceiling) passes through in full', () => {
  const urls = Array.from({ length: 8 }, (_, i) => `slide${i}.jpg`);
  assert.deepEqual(selectCandidateMediaUrls(urls), urls);
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

// ── selectCandidateSlideVideos (issue #240 scope item 2) ─────────────

check('pairs per-slide video URLs by index with selectCandidateMediaUrls output (mixed image/video carousel)', () => {
  const mediaUrls = ['s0.jpg', 's1.jpg', 's2.jpg', 's3.jpg'];
  const slideVideoUrls = [null, 's1.mp4', null, 's3.mp4'];
  const images = selectCandidateMediaUrls(mediaUrls);
  const videos = selectCandidateSlideVideos(mediaUrls, slideVideoUrls);
  assert.equal(images.length, videos.length);
  assert.deepEqual(images, mediaUrls);
  assert.deepEqual(videos, [null, 's1.mp4', null, 's3.mp4']);
});

check('an images-only carousel yields all-null slide videos', () => {
  const mediaUrls = ['s0.jpg', 's1.jpg', 's2.jpg'];
  const slideVideoUrls = [null, null, null];
  assert.deepEqual(selectCandidateSlideVideos(mediaUrls, slideVideoUrls), [null, null, null]);
});

check('a single-video slide (only one child has a video) yields nulls elsewhere', () => {
  const mediaUrls = ['s0.jpg', 's1.jpg'];
  const slideVideoUrls = [null, 's1.mp4'];
  assert.deepEqual(selectCandidateSlideVideos(mediaUrls, slideVideoUrls), [null, 's1.mp4']);
});

check('respects the same 20-slide (MAX_MEDIA_PER_POST) ceiling as selectCandidateMediaUrls', () => {
  const mediaUrls = Array.from({ length: 25 }, (_, i) => `slide${i}.jpg`);
  const slideVideoUrls = Array.from({ length: 25 }, (_, i) => (i % 5 === 0 ? `slide${i}.mp4` : null));
  const images = selectCandidateMediaUrls(mediaUrls);
  const videos = selectCandidateSlideVideos(mediaUrls, slideVideoUrls);
  assert.equal(videos.length, 20);
  assert.equal(images.length, videos.length);
  // Slide 20 (i % 5 === 0) is beyond the ceiling and must not appear.
  assert.ok(!videos.includes('slide20.mp4'));
  assert.equal(videos[0], 'slide0.mp4');
  assert.equal(videos[5], 'slide5.mp4');
});

check('non-array slideVideoUrls degrades to all nulls rather than throwing', () => {
  const mediaUrls = ['s0.jpg', 's1.jpg'];
  assert.deepEqual(selectCandidateSlideVideos(mediaUrls, undefined), [null, null]);
  assert.deepEqual(selectCandidateSlideVideos(mediaUrls, null), [null, null]);
});

check('a dropped image slide (obvious video-extension URL) keeps its paired video array aligned, not shifted', () => {
  // mediaUrls[1] gets filtered out by selectCandidateMediaUrls (video
  // extension) — the resulting videos array must still correspond
  // position-for-position with the filtered images array, not the raw input.
  const mediaUrls = ['s0.jpg', 'clip.mp4', 's2.jpg'];
  const slideVideoUrls = [null, 'unused.mp4', 's2companion.mp4'];
  const images = selectCandidateMediaUrls(mediaUrls);
  const videos = selectCandidateSlideVideos(mediaUrls, slideVideoUrls);
  assert.deepEqual(images, ['s0.jpg', 's2.jpg']);
  assert.deepEqual(videos, [null, 's2companion.mp4']);
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
    assets: [
      { path: 'intel-media/intel1/0.jpg', type: 'image' },
      { path: 'intel-media/intel1/1.jpg', type: 'image' },
    ],
    rightsStatus: 'unverified',
    venueId: null,
    createdAt,
  });
});

check('omitted assets defaults to storagePaths mapped to image entries (backward-compat callers, e.g. the backfill script)', () => {
  const doc = buildMediaAssetDoc(
    {
      venueIntelId: 'intel2',
      sourceAccount: 'atl_nightlife',
      seedAccount: 'chuckyfoto',
      postUrl: 'https://www.instagram.com/p/DEF/',
      storagePaths: ['intel-media/intel2/0.jpg'],
    },
    'ts'
  );
  assert.deepEqual(doc.assets, [{ path: 'intel-media/intel2/0.jpg', type: 'image' }]);
});

check('explicit assets (with a video entry) are passed through as-is, not re-derived from storagePaths', () => {
  const assets = [
    { path: 'intel-media/intel3/0.jpg', type: 'image' },
    { path: 'intel-media/intel3/video0.mp4', type: 'video', posterPath: 'intel-media/intel3/0.jpg' },
  ];
  const doc = buildMediaAssetDoc(
    {
      venueIntelId: 'intel3',
      sourceAccount: 'atl_nightlife',
      seedAccount: 'chuckyfoto',
      postUrl: 'https://www.instagram.com/p/GHI/',
      storagePaths: ['intel-media/intel3/0.jpg'],
      assets,
    },
    'ts'
  );
  assert.deepEqual(doc.assets, assets);
  // storagePaths (images only) stays the backward-compat field regardless.
  assert.deepEqual(doc.storagePaths, ['intel-media/intel3/0.jpg']);
});

console.log(`\n${passed} check(s) passed`);
if (process.exitCode) {
  console.error('\nSome checks FAILED — see above.');
  process.exit(process.exitCode);
}
