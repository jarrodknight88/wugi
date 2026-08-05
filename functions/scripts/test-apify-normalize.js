#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — apifyWebhook normalizer test
//
// Plain-Node smoke test (no test framework in this repo — see
// package.json). Exercises the pure item→doc mapper in
// src/bridge/apifyWebhook.ts against the compiled lib/ output, so it
// needs a build first:
//
//   npm run build && node scripts/test-apify-normalize.js
//
// or just: npm run test:apify-normalize
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const { mapApifyItemToVenueIntelDoc } = require(
  path.join(__dirname, '..', 'lib', 'bridge', 'apifyWebhook.js')
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

// ── mapApifyItemToVenueIntelDoc ─────────────────────────────────────

check('maps a full Instagram item to a venueIntel doc', () => {
  const item = {
    url: 'https://www.instagram.com/p/ABC123/',
    ownerUsername: 'atl_nightlife',
    caption: 'Friday night at the spot',
    timestamp: '2026-07-25T04:00:00.000Z',
    likesCount: 42,
    commentsCount: 3,
    images: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
  };
  const result = mapApifyItemToVenueIntelDoc(item, 'run_1');
  assert.equal(result.docId, sha32('https://www.instagram.com/p/ABC123/'));
  assert.equal(result.docId.length, 32);
  assert.equal(result.doc.sourceAccount, 'atl_nightlife');
  assert.equal(result.doc.postUrl, item.url);
  assert.equal(result.doc.caption, item.caption);
  assert.equal(result.doc.likesCount, 42);
  assert.equal(result.doc.commentsCount, 3);
  assert.deepEqual(result.doc.mediaUrls, item.images);
  assert.equal(result.doc.runId, 'run_1');
  assert.ok(result.doc.postedAt); // Firestore Timestamp instance
});

check('same post URL always hashes to the same docId (dedupe key)', () => {
  const a = mapApifyItemToVenueIntelDoc({ url: 'https://www.instagram.com/p/SAME/' }, 'run_1');
  const b = mapApifyItemToVenueIntelDoc({ url: 'https://www.instagram.com/p/SAME/' }, 'run_2');
  assert.equal(a.docId, b.docId);
});

check('missing engagement fields default to 0', () => {
  const result = mapApifyItemToVenueIntelDoc({ url: 'https://www.instagram.com/p/NOENG/' }, 'run_1');
  assert.equal(result.doc.likesCount, 0);
  assert.equal(result.doc.commentsCount, 0);
});

check('null engagement fields default to 0', () => {
  const result = mapApifyItemToVenueIntelDoc(
    { url: 'https://www.instagram.com/p/NULLENG/', likesCount: null, commentsCount: null },
    'run_1'
  );
  assert.equal(result.doc.likesCount, 0);
  assert.equal(result.doc.commentsCount, 0);
});

check('missing caption defaults to empty string', () => {
  const result = mapApifyItemToVenueIntelDoc({ url: 'https://www.instagram.com/p/NOCAP/' }, 'run_1');
  assert.equal(result.doc.caption, '');
});

check('missing post URL is unmappable — returns null', () => {
  assert.equal(mapApifyItemToVenueIntelDoc({ caption: 'no url here' }, 'run_1'), null);
  assert.equal(mapApifyItemToVenueIntelDoc({ url: '' }, 'run_1'), null);
});

check('falls back to postUrl/inputUrl field names', () => {
  const a = mapApifyItemToVenueIntelDoc({ postUrl: 'https://www.instagram.com/p/PU/' }, 'run_1');
  assert.equal(a.doc.postUrl, 'https://www.instagram.com/p/PU/');
  const b = mapApifyItemToVenueIntelDoc({ inputUrl: 'https://www.instagram.com/p/IU/' }, 'run_1');
  assert.equal(b.doc.postUrl, 'https://www.instagram.com/p/IU/');
});

check('falls back to displayUrl when no images array is present', () => {
  const result = mapApifyItemToVenueIntelDoc(
    { url: 'https://www.instagram.com/p/DISP/', displayUrl: 'https://cdn.example.com/main.jpg' },
    'run_1'
  );
  assert.deepEqual(result.doc.mediaUrls, ['https://cdn.example.com/main.jpg']);
});

check('extracts videoUrl from a video post (scope item 1: "videoUrl / type video")', () => {
  const result = mapApifyItemToVenueIntelDoc(
    {
      url: 'https://www.instagram.com/p/VID/',
      displayUrl: 'https://cdn.example.com/poster.jpg',
      videoUrl: 'https://cdn.example.com/clip.mp4',
      type: 'Video',
    },
    'run_1'
  );
  assert.equal(result.doc.videoUrl, 'https://cdn.example.com/clip.mp4');
  // The poster still flows through mediaUrls regardless of videoUrl — a
  // video post never loses its cover-frame image because of this field.
  assert.deepEqual(result.doc.mediaUrls, ['https://cdn.example.com/poster.jpg', 'https://cdn.example.com/clip.mp4']);
});

check('missing videoUrl (image-only post) yields null, not undefined', () => {
  const result = mapApifyItemToVenueIntelDoc(
    { url: 'https://www.instagram.com/p/IMG/', images: ['https://cdn.example.com/1.jpg'] },
    'run_1'
  );
  assert.equal(result.doc.videoUrl, null);
});

check('extracts mediaUrls from childPosts (carousel) when present', () => {
  const result = mapApifyItemToVenueIntelDoc(
    {
      url: 'https://www.instagram.com/p/CAROUSEL/',
      childPosts: [{ displayUrl: 'https://cdn.example.com/c1.jpg' }, { displayUrl: 'https://cdn.example.com/c2.jpg' }],
    },
    'run_1'
  );
  assert.deepEqual(result.doc.mediaUrls, ['https://cdn.example.com/c1.jpg', 'https://cdn.example.com/c2.jpg']);
  // Image-only carousel: childVideoUrls is index-aligned to mediaUrls but
  // every slide is null (no per-slide video).
  assert.deepEqual(result.childVideoUrls, [null, null]);
});

// ── childVideoUrls / carousel per-slide videos (issue #240) ──────────

check('a mixed image/video carousel pairs each childPosts[].videoUrl to its slide, index-aligned to mediaUrls', () => {
  const result = mapApifyItemToVenueIntelDoc(
    {
      url: 'https://www.instagram.com/p/MIXEDCAROUSEL/',
      childPosts: [
        { displayUrl: 'https://cdn.example.com/c0.jpg', type: 'Image' },
        { displayUrl: 'https://cdn.example.com/c1poster.jpg', videoUrl: 'https://cdn.example.com/c1.mp4', type: 'Video' },
        { displayUrl: 'https://cdn.example.com/c2.jpg', type: 'Image' },
        { displayUrl: 'https://cdn.example.com/c3poster.jpg', videoUrl: 'https://cdn.example.com/c3.mp4', type: 'Video' },
      ],
    },
    'run_1'
  );
  assert.deepEqual(result.doc.mediaUrls, [
    'https://cdn.example.com/c0.jpg',
    'https://cdn.example.com/c1poster.jpg',
    'https://cdn.example.com/c2.jpg',
    'https://cdn.example.com/c3poster.jpg',
  ]);
  assert.deepEqual(result.childVideoUrls, [
    null,
    'https://cdn.example.com/c1.mp4',
    null,
    'https://cdn.example.com/c3.mp4',
  ]);
});

check('a single-video carousel slide (all others plain images) isolates its video to just that index', () => {
  const result = mapApifyItemToVenueIntelDoc(
    {
      url: 'https://www.instagram.com/p/ONEVIDEOSLIDE/',
      childPosts: [
        { displayUrl: 'https://cdn.example.com/a.jpg' },
        { displayUrl: 'https://cdn.example.com/b.jpg' },
        { displayUrl: 'https://cdn.example.com/vposter.jpg', videoUrl: 'https://cdn.example.com/v.mp4' },
      ],
    },
    'run_1'
  );
  assert.deepEqual(result.childVideoUrls, [null, null, 'https://cdn.example.com/v.mp4']);
});

check('a childPosts entry missing displayUrl is skipped from both mediaUrls and childVideoUrls together (stays index-aligned)', () => {
  const result = mapApifyItemToVenueIntelDoc(
    {
      url: 'https://www.instagram.com/p/GAPSLIDE/',
      childPosts: [
        { displayUrl: 'https://cdn.example.com/a.jpg' },
        { videoUrl: 'https://cdn.example.com/orphan.mp4' }, // no displayUrl — dropped entirely
        { displayUrl: 'https://cdn.example.com/b.jpg', videoUrl: 'https://cdn.example.com/b.mp4' },
      ],
    },
    'run_1'
  );
  assert.deepEqual(result.doc.mediaUrls, ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']);
  assert.deepEqual(result.childVideoUrls, [null, 'https://cdn.example.com/b.mp4']);
});

check('a >20-slide carousel is captured in full at the mapper level — the 20-slide ceiling is enforced later at media-persistence time', () => {
  const childPosts = Array.from({ length: 24 }, (_, i) => ({ displayUrl: `https://cdn.example.com/s${i}.jpg` }));
  const result = mapApifyItemToVenueIntelDoc({ url: 'https://www.instagram.com/p/HUGE/', childPosts }, 'run_1');
  assert.equal(result.doc.mediaUrls.length, 24);
  assert.equal(result.childVideoUrls.length, 24);
});

check('non-carousel items (images array) yield an empty childVideoUrls, not a null-filled array', () => {
  const result = mapApifyItemToVenueIntelDoc(
    { url: 'https://www.instagram.com/p/IMAGESONLY/', images: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'] },
    'run_1'
  );
  assert.deepEqual(result.childVideoUrls, []);
});

check('non-carousel single-video post yields an empty childVideoUrls (unchanged top-level videoUrl behavior)', () => {
  const result = mapApifyItemToVenueIntelDoc(
    {
      url: 'https://www.instagram.com/p/SOLOVIDEO/',
      displayUrl: 'https://cdn.example.com/poster.jpg',
      videoUrl: 'https://cdn.example.com/clip.mp4',
    },
    'run_1'
  );
  assert.deepEqual(result.childVideoUrls, []);
});

// ── Regression: non-carousel posts are byte-identical to pre-#240 ────

check('regression: a plain non-carousel doc is unaffected by the carousel/video changes (full doc shape)', () => {
  const result = mapApifyItemToVenueIntelDoc(
    {
      url: 'https://www.instagram.com/p/REGRESSION/',
      ownerUsername: 'atl_nightlife',
      caption: 'Friday flyer',
      likesCount: 10,
      commentsCount: 1,
      images: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
    },
    'run_1'
  );
  assert.deepEqual(result.doc, {
    sourceAccount: 'atl_nightlife',
    seedAccount: '',
    postUrl: 'https://www.instagram.com/p/REGRESSION/',
    caption: 'Friday flyer',
    postedAt: null,
    likesCount: 10,
    commentsCount: 1,
    mediaUrls: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
    videoUrl: null,
    runId: 'run_1',
    mentionedHandles: [],
  });
});

check('unparseable/missing timestamp yields a null postedAt instead of throwing', () => {
  const result = mapApifyItemToVenueIntelDoc(
    { url: 'https://www.instagram.com/p/NOTS/', timestamp: 'not-a-date' },
    'run_1'
  );
  assert.equal(result.doc.postedAt, null);
});

// ── seedAccount attribution ─────────────────────────────────────────

check('seedAccount is parsed from inputUrl', () => {
  const result = mapApifyItemToVenueIntelDoc(
    {
      url: 'https://www.instagram.com/p/SEED/',
      ownerUsername: 'chuckyfoto',
      inputUrl: 'https://www.instagram.com/chuckyfoto/',
    },
    'run_1'
  );
  assert.equal(result.doc.seedAccount, 'chuckyfoto');
  assert.equal(result.doc.sourceAccount, 'chuckyfoto');
});

check('collab post: seedAccount (scraped profile) differs from sourceAccount (post owner)', () => {
  const result = mapApifyItemToVenueIntelDoc(
    {
      url: 'https://www.instagram.com/p/COLLAB/',
      ownerUsername: 'havananightclubatl',
      inputUrl: 'https://www.instagram.com/chuckyfoto/',
    },
    'run_1'
  );
  assert.equal(result.doc.seedAccount, 'chuckyfoto');
  assert.equal(result.doc.sourceAccount, 'havananightclubatl');
});

check('missing inputUrl yields an empty seedAccount', () => {
  const result = mapApifyItemToVenueIntelDoc(
    { url: 'https://www.instagram.com/p/NOSEED/', ownerUsername: 'atl_nightlife' },
    'run_1'
  );
  assert.equal(result.doc.seedAccount, '');
});

check('unparseable inputUrl yields an empty seedAccount', () => {
  const result = mapApifyItemToVenueIntelDoc(
    { url: 'https://www.instagram.com/p/BADSEED/', inputUrl: 'not-a-url' },
    'run_1'
  );
  assert.equal(result.doc.seedAccount, '');
});

// ── mentionedHandles (issue #236) ───────────────────────────────────

check('mentionedHandles unions taggedUsers[].username with mentions, dedupes', () => {
  const result = mapApifyItemToVenueIntelDoc(
    {
      url: 'https://www.instagram.com/p/MENT/',
      caption: 'shoutout @thetestroom',
      taggedUsers: [{ username: 'thetestroom', full_name: 'The Test Room' }, { username: 'djfriend' }],
      mentions: ['thetestroom', 'promotedloungeatl'],
    },
    'run_1'
  );
  assert.deepEqual(result.doc.mentionedHandles, ['thetestroom', 'djfriend', 'promotedloungeatl']);
});

check('mentionedHandles tolerates a taggedUsers entry that is a plain string', () => {
  const result = mapApifyItemToVenueIntelDoc(
    { url: 'https://www.instagram.com/p/MENTSTR/', taggedUsers: ['thetestroom'] },
    'run_1'
  );
  assert.deepEqual(result.doc.mentionedHandles, ['thetestroom']);
});

check('mentionedHandles defaults to an empty array when neither field is present', () => {
  const result = mapApifyItemToVenueIntelDoc({ url: 'https://www.instagram.com/p/NOMENT/' }, 'run_1');
  assert.deepEqual(result.doc.mentionedHandles, []);
});

check('mentionedHandles ignores malformed entries (missing username, non-string mentions)', () => {
  const result = mapApifyItemToVenueIntelDoc(
    {
      url: 'https://www.instagram.com/p/BADMENT/',
      taggedUsers: [{ full_name: 'No Username' }, null, {}],
      mentions: [null, 42, '', 'thetestroom'],
    },
    'run_1'
  );
  assert.deepEqual(result.doc.mentionedHandles, ['thetestroom']);
});

console.log(`\n${passed} check(s) passed`);
if (process.exitCode) {
  console.error('\nSome checks FAILED — see above.');
  process.exit(process.exitCode);
}
