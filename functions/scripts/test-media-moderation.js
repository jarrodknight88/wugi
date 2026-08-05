#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — Cloud Vision SafeSearch moderation test (issue #170)
//
// Plain-Node smoke test (no test framework in this repo — see
// package.json). Exercises the pure decision function and the batched
// Vision call (against a fake VisionBatchClient — no network, no real
// Vision API needed) in src/intel/mediaModeration.ts against the compiled
// lib/ output, so it needs a build first:
//
//   npm run build && node scripts/test-media-moderation.js
//
// or just: npm run test:media-moderation
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const { computeModerationStatus, moderateImagesForPost } = require(
  path.join(__dirname, '..', 'lib', 'intel', 'mediaModeration.js')
);

let passed = 0;
function check(label, fn) {
  const result = fn();
  return Promise.resolve(result)
    .then(() => {
      passed++;
      console.log(`ok   - ${label}`);
    })
    .catch((err) => {
      console.error(`FAIL - ${label}`);
      console.error(err);
      process.exitCode = 1;
    });
}

const CLEAR = { adult: 'VERY_UNLIKELY', racy: 'UNLIKELY', violence: 'VERY_UNLIKELY', medical: 'UNKNOWN', spoof: 'UNKNOWN' };

async function main() {
  // ── computeModerationStatus: flagged mapping ────────────────────────

  await check('clear SafeSearch result stays clear', () => {
    assert.equal(computeModerationStatus(CLEAR), 'clear');
  });

  await check('adult at LIKELY flags', () => {
    assert.equal(computeModerationStatus({ ...CLEAR, adult: 'LIKELY' }), 'flagged');
  });

  await check('adult at VERY_LIKELY flags', () => {
    assert.equal(computeModerationStatus({ ...CLEAR, adult: 'VERY_LIKELY' }), 'flagged');
  });

  await check('adult below LIKELY (POSSIBLE) does not flag', () => {
    assert.equal(computeModerationStatus({ ...CLEAR, adult: 'POSSIBLE' }), 'clear');
  });

  await check('violence at LIKELY flags', () => {
    assert.equal(computeModerationStatus({ ...CLEAR, violence: 'LIKELY' }), 'flagged');
  });

  await check('violence below LIKELY (POSSIBLE) does not flag', () => {
    assert.equal(computeModerationStatus({ ...CLEAR, violence: 'POSSIBLE' }), 'clear');
  });

  // ── computeModerationStatus: racy tolerance (the whole point of the
  // custom threshold — nightlife content is inherently racy-adjacent) ──

  await check('racy at LIKELY does NOT flag (nightlife-tolerance threshold)', () => {
    assert.equal(computeModerationStatus({ ...CLEAR, racy: 'LIKELY' }), 'clear');
  });

  await check('racy at POSSIBLE does not flag', () => {
    assert.equal(computeModerationStatus({ ...CLEAR, racy: 'POSSIBLE' }), 'clear');
  });

  await check('racy at VERY_LIKELY flags', () => {
    assert.equal(computeModerationStatus({ ...CLEAR, racy: 'VERY_LIKELY' }), 'flagged');
  });

  await check('medical and spoof never flag on their own', () => {
    assert.equal(computeModerationStatus({ ...CLEAR, medical: 'VERY_LIKELY', spoof: 'VERY_LIKELY' }), 'clear');
  });

  // ── moderateImagesForPost: fail-open ────────────────────────────────

  await check('empty path list short-circuits without calling the client', async () => {
    let called = false;
    const client = { batchAnnotateImages: async () => { called = true; return [{ responses: [] }]; } };
    const result = await moderateImagesForPost(client, 'bucket', []);
    assert.equal(result.size, 0);
    assert.equal(called, false);
  });

  await check('a request-level failure fails every path open to unscanned', async () => {
    const client = { batchAnnotateImages: async () => { throw new Error('quota exceeded'); } };
    const result = await moderateImagesForPost(client, 'bucket', ['a.jpg', 'b.jpg']);
    assert.deepEqual(result.get('a.jpg'), { moderationStatus: 'unscanned' });
    assert.deepEqual(result.get('b.jpg'), { moderationStatus: 'unscanned' });
  });

  await check('a per-image error in an otherwise-successful batch fails open only that image', async () => {
    const client = {
      batchAnnotateImages: async () => [
        {
          responses: [
            { safeSearchAnnotation: { adult: 'VERY_UNLIKELY', racy: 'UNLIKELY', violence: 'VERY_UNLIKELY', medical: 'UNKNOWN', spoof: 'UNKNOWN' } },
            { error: { message: 'image too large' } },
          ],
        },
      ],
    };
    const result = await moderateImagesForPost(client, 'bucket', ['ok.jpg', 'bad.jpg']);
    assert.equal(result.get('ok.jpg').moderationStatus, 'clear');
    assert.deepEqual(result.get('bad.jpg'), { moderationStatus: 'unscanned' });
  });

  await check('a missing safeSearchAnnotation on an otherwise-ok response fails open', async () => {
    const client = { batchAnnotateImages: async () => [{ responses: [{}] }] };
    const result = await moderateImagesForPost(client, 'bucket', ['a.jpg']);
    assert.deepEqual(result.get('a.jpg'), { moderationStatus: 'unscanned' });
  });

  await check('a successful batch call is sent as one request per post (gs:// URIs, SAFE_SEARCH_DETECTION feature)', async () => {
    let capturedRequest = null;
    const client = {
      batchAnnotateImages: async (request) => {
        capturedRequest = request;
        return [{ responses: request.requests.map(() => ({ safeSearchAnnotation: CLEAR })) }];
      },
    };
    await moderateImagesForPost(client, 'my-bucket', ['intel-media/x/0.jpg', 'intel-media/x/1.jpg']);
    assert.deepEqual(capturedRequest.requests, [
      { image: { source: { imageUri: 'gs://my-bucket/intel-media/x/0.jpg' } }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] },
      { image: { source: { imageUri: 'gs://my-bucket/intel-media/x/1.jpg' } }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] },
    ]);
  });

  await check('a full 20-slide carousel (issue #240 ceiling) is still sent as one batched request, no per-image assumption', async () => {
    const paths = Array.from({ length: 20 }, (_, i) => `intel-media/carousel/${i}.jpg`);
    let capturedCount = null;
    const client = {
      batchAnnotateImages: async (request) => {
        capturedCount = request.requests.length;
        return [{ responses: request.requests.map(() => ({ safeSearchAnnotation: CLEAR })) }];
      },
    };
    const result = await moderateImagesForPost(client, 'bucket', paths);
    assert.equal(capturedCount, 20);
    assert.equal(result.size, 20);
    paths.forEach((p) => assert.equal(result.get(p).moderationStatus, 'clear'));
  });

  await check('an unrecognized likelihood value from the API degrades to UNKNOWN (clear) rather than throwing', async () => {
    const client = {
      batchAnnotateImages: async () => [{ responses: [{ safeSearchAnnotation: { adult: 'SOME_FUTURE_ENUM_VALUE', racy: 'UNLIKELY', violence: 'UNLIKELY' } }] }],
    };
    const result = await moderateImagesForPost(client, 'bucket', ['a.jpg']);
    assert.equal(result.get('a.jpg').moderationStatus, 'clear');
    assert.equal(result.get('a.jpg').safeSearch.adult, 'UNKNOWN');
  });

  console.log(`\n${passed} check(s) passed`);
  if (process.exitCode) {
    console.error('\nSome checks FAILED — see above.');
    process.exit(process.exitCode);
  }
}

main();
