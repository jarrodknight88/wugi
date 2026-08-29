#!/usr/bin/env node
// Plain-Node smoke test (no test framework in this repo — see
// functions/scripts/test-inbound-grammar.js for the established pattern).
// Exercises the pure checkShaMatch function against the compiled lib/
// output, so it needs a build first: npm run build && node test/test-sha-check.js

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const { checkShaMatch } = require(path.join(__dirname, '..', 'lib', 'gateChecks', 'shaCheck.js'));

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

check('matching SHAs pass', () => {
  const result = checkShaMatch('abc123', 'abc123');
  assert.equal(result.pass, true);
});

check('mismatched SHAs fail with a reason mentioning both', () => {
  const result = checkShaMatch('abc123abc123', 'def456def456');
  assert.equal(result.pass, false);
  assert.match(result.reason, /SHA mismatch/);
  assert.match(result.reason, /abc123abc123/);
  assert.match(result.reason, /def456def456/);
});

check('missing reviewedSha fails closed', () => {
  const result = checkShaMatch(undefined, 'def456');
  assert.equal(result.pass, false);
  assert.match(result.reason, /no reviewedSha/);
});

console.log(`\n${passed} passed`);
