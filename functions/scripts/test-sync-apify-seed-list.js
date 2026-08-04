#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — syncApifySeedList merge/url-conversion test
//
// Plain-Node smoke test (no test framework in this repo — see
// package.json). Exercises the pure seed-list merge and URL<->handle
// helpers in src/bridge/syncApifySeedList.ts against the compiled lib/
// output, so it needs a build first:
//
//   npm run build && node scripts/test-sync-apify-seed-list.js
//
// or just: npm run test:sync-apify-seed-list
//
// The scheduled handler itself (Firestore reads + Apify fetch calls) is
// thin glue over these pure functions and isn't covered here — same
// precedent as runTargetedScrape.ts's own handler vs.
// buildTargetedScrapeRunRequest (see test-run-targeted-scrape.js).
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  mergeSeedHandles,
  handlesToDirectUrls,
  directUrlToHandle,
} = require(path.join(__dirname, '..', 'lib', 'bridge', 'syncApifySeedList.js'));

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

// ── mergeSeedHandles ─────────────────────────────────────────────────

check('unions approved handles onto the base list, base first', () => {
  const { merged, added } = mergeSeedHandles(['a', 'b'], ['c']);
  assert.deepEqual(merged, ['a', 'b', 'c']);
  assert.deepEqual(added, ['c']);
});

check('does not duplicate an approved handle already in the base list', () => {
  const { merged, added } = mergeSeedHandles(['a', 'b'], ['b', 'c']);
  assert.deepEqual(merged, ['a', 'b', 'c']);
  assert.deepEqual(added, ['c']);
});

check('dedupes duplicate approved handles against each other', () => {
  const { merged, added } = mergeSeedHandles(['a'], ['b', 'b']);
  assert.deepEqual(merged, ['a', 'b']);
  assert.deepEqual(added, ['b']);
});

check('dedupes duplicate base handles against each other', () => {
  const { merged, added } = mergeSeedHandles(['a', 'a', 'b'], []);
  assert.deepEqual(merged, ['a', 'b']);
  assert.deepEqual(added, []);
});

check('trims whitespace on both lists', () => {
  const { merged, added } = mergeSeedHandles([' a '], [' b ']);
  assert.deepEqual(merged, ['a', 'b']);
  assert.deepEqual(added, ['b']);
});

check('drops empty/whitespace-only entries from both lists', () => {
  const { merged, added } = mergeSeedHandles(['a', '', '  '], ['b', '']);
  assert.deepEqual(merged, ['a', 'b']);
  assert.deepEqual(added, ['b']);
});

check('no approved handles yields the base list unchanged and empty added', () => {
  const { merged, added } = mergeSeedHandles(['a', 'b'], []);
  assert.deepEqual(merged, ['a', 'b']);
  assert.deepEqual(added, []);
});

check('empty base list with approved handles yields no cap on growth', () => {
  const { merged, added } = mergeSeedHandles([], ['a', 'b', 'c']);
  assert.deepEqual(merged, ['a', 'b', 'c']);
  assert.deepEqual(added, ['a', 'b', 'c']);
});

// ── handlesToDirectUrls / directUrlToHandle ──────────────────────────

check('handlesToDirectUrls builds Instagram profile URLs', () => {
  assert.deepEqual(handlesToDirectUrls(['atl_nightlife', 'chuckyfoto']), [
    'https://www.instagram.com/atl_nightlife/',
    'https://www.instagram.com/chuckyfoto/',
  ]);
});

check('directUrlToHandle recovers the handle from a profile URL', () => {
  assert.equal(directUrlToHandle('https://www.instagram.com/atl_nightlife/'), 'atl_nightlife');
  assert.equal(directUrlToHandle('https://instagram.com/atl_nightlife'), 'atl_nightlife');
});

check('directUrlToHandle rejects a non-Instagram URL', () => {
  assert.equal(directUrlToHandle('https://www.twitter.com/atl_nightlife'), null);
});

check('directUrlToHandle rejects a malformed URL', () => {
  assert.equal(directUrlToHandle('not a url'), null);
});

check('handlesToDirectUrls and directUrlToHandle round-trip', () => {
  const handles = ['atl_nightlife', 'teranga.atl'];
  const roundTripped = handlesToDirectUrls(handles).map(directUrlToHandle);
  assert.deepEqual(roundTripped, handles);
});

console.log(`\n${passed} check(s) passed`);
if (process.exitCode) {
  console.error('\nSome checks FAILED — see above.');
  process.exit(process.exitCode);
}
