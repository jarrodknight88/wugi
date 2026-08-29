#!/usr/bin/env node
// Plain-Node smoke test — see test-sha-check.js header for the pattern.
// npm run build && node test/test-denylist.js

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const { scanDenylist } = require(path.join(__dirname, '..', 'lib', 'gateChecks', 'denylist.js'));

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

check('firestore.rules trips the denylist', () => {
  const result = scanDenylist(['firestore.rules']);
  assert.equal(result.hit, true);
  assert.deepEqual(result.matches, ['firestore.rules']);
});

check('storage.rules trips the denylist', () => {
  assert.equal(scanDenylist(['storage.rules']).hit, true);
});

check('bridge functions trip the denylist', () => {
  assert.equal(scanDenylist(['functions/src/bridge/twilioInbound.ts']).hit, true);
});

check('payment-shaped functions trip the denylist', () => {
  assert.equal(scanDenylist(['functions/src/stripe/createPaymentIntent.ts']).hit, true);
  assert.equal(scanDenylist(['functions/src/terminal/terminalFunctions.ts']).hit, true);
});

check('any package.json trips the denylist', () => {
  assert.equal(scanDenylist(['mobile-app/package.json']).hit, true);
  assert.equal(scanDenylist(['package.json']).hit, true);
});

check('ordinary source files do not trip the denylist', () => {
  const result = scanDenylist(['mobile-app/src/screens/HomeScreen.tsx', 'functions/src/events/createEvent.ts']);
  assert.equal(result.hit, false);
  assert.deepEqual(result.matches, []);
});

check('one denylisted file among many still reports the specific match', () => {
  const result = scanDenylist(['mobile-app/src/App.tsx', 'firestore.rules']);
  assert.equal(result.hit, true);
  assert.deepEqual(result.matches, ['firestore.rules']);
});

console.log(`\n${passed} passed`);
