#!/usr/bin/env node
// Plain-Node smoke test — see test-sha-check.js header for the pattern.
// npm run build && node test/test-baseline-check.js

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const { countTscErrors, checkBaselineRegression } = require(
  path.join(__dirname, '..', 'lib', 'gateChecks', 'baseline.js')
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

check('countTscErrors counts only error lines', () => {
  const output = [
    'src/foo.ts(3,5): error TS2322: Type mismatch.',
    'src/bar.ts(10,1): error TS2304: Cannot find name.',
    'Found 2 errors.',
    '',
  ].join('\n');
  assert.equal(countTscErrors(output), 2);
});

check('countTscErrors returns 0 on clean output', () => {
  assert.equal(countTscErrors('Compilation complete. Watching for file changes.'), 0);
});

check('at-or-below baseline passes', () => {
  const result = checkBaselineRegression({ functions: 0, mobileApp: 38 }, { functions: 0, mobileApp: 38 });
  assert.equal(result.pass, true);
});

check('below baseline passes', () => {
  const result = checkBaselineRegression({ functions: 0, mobileApp: 20 }, { functions: 0, mobileApp: 38 });
  assert.equal(result.pass, true);
});

check('regression above baseline fails, naming the package', () => {
  const result = checkBaselineRegression({ functions: 1, mobileApp: 38 }, { functions: 0, mobileApp: 38 });
  assert.equal(result.pass, false);
  assert.match(result.reason, /functions\//);
});

check('null count (package not touched) is skipped, not compared', () => {
  const result = checkBaselineRegression({ functions: null, mobileApp: 999 }, { functions: 0, mobileApp: 38 });
  assert.equal(result.pass, false); // mobileApp still regressed
  assert.doesNotMatch(result.reason, /functions\//);
});

console.log(`\n${passed} passed`);
