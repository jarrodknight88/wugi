#!/usr/bin/env node
// Plain-Node smoke test — see test-sha-check.js header for the pattern.
// npm run build && node test/test-overlap.js

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const { checkFileOverlap } = require(path.join(__dirname, '..', 'lib', 'gateChecks', 'overlap.js'));

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

check('no overlap when no other PR touches the same files', () => {
  const result = checkFileOverlap(['mobile-app/src/App.tsx'], { 12: ['functions/src/events/createEvent.ts'] });
  assert.equal(result.overlap, false);
  assert.deepEqual(result.withPrs, []);
});

check('overlap detected and names the colliding PR', () => {
  const result = checkFileOverlap(['mobile-app/src/App.tsx'], { 12: ['mobile-app/src/App.tsx'] });
  assert.equal(result.overlap, true);
  assert.deepEqual(result.withPrs, [12]);
});

check('overlap can name multiple colliding PRs', () => {
  const result = checkFileOverlap(['a.ts', 'b.ts'], { 1: ['a.ts'], 2: ['c.ts'], 3: ['b.ts'] });
  assert.equal(result.overlap, true);
  assert.deepEqual(result.withPrs.sort(), [1, 3]);
});

check('no other open PRs means no overlap', () => {
  const result = checkFileOverlap(['a.ts'], {});
  assert.equal(result.overlap, false);
});

console.log(`\n${passed} passed`);
