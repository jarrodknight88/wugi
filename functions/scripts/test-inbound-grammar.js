#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — Bridge v1.3 inbound SMS grammar test
//
// Plain-Node smoke test (no test framework in this repo — see
// package.json). Exercises the pure parsing functions in
// src/bridge/commandGrammar.ts against the compiled lib/ output, so it
// needs a build first:
//
//   npm run build && node scripts/test-inbound-grammar.js
//
// or just: npm run test:grammar
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  parseInboundCommand,
  isPmCodeReviewComment,
  parsePmVerdict,
  composeVerdictSms,
} = require(path.join(__dirname, '..', 'lib', 'bridge', 'commandGrammar.js'));

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

// ── parseInboundCommand ───────────────────────────────────────────────

check('MERGE <n>', () => {
  assert.deepEqual(parseInboundCommand('MERGE 42'), { kind: 'MERGE', prNumber: 42 });
});

check('merge <n> lowercase + hash + extra whitespace', () => {
  assert.deepEqual(parseInboundCommand('  merge   #42  '), { kind: 'MERGE', prNumber: 42 });
});

check('MERGE ALL', () => {
  assert.deepEqual(parseInboundCommand('MERGE ALL'), { kind: 'MERGE_ALL' });
  assert.deepEqual(parseInboundCommand('merge all'), { kind: 'MERGE_ALL' });
});

check('HOLD <n>', () => {
  assert.deepEqual(parseInboundCommand('HOLD 7'), { kind: 'HOLD', prNumber: 7 });
});

check('STATUS', () => {
  assert.deepEqual(parseInboundCommand('STATUS'), { kind: 'STATUS' });
  assert.deepEqual(parseInboundCommand('status'), { kind: 'STATUS' });
});

check('YES confirmation', () => {
  assert.deepEqual(parseInboundCommand('YES'), { kind: 'CONFIRM_YES' });
  assert.deepEqual(parseInboundCommand('yes'), { kind: 'CONFIRM_YES' });
});

check('REWORK <n> <notes>', () => {
  assert.deepEqual(parseInboundCommand('REWORK 12 fix the null check on line 40'), {
    kind: 'REWORK',
    prNumber: 12,
    notes: 'fix the null check on line 40',
  });
});

check('REWORK is case-insensitive on the verb only', () => {
  const result = parseInboundCommand('rework 12 Fix The Null Check');
  assert.equal(result.kind, 'REWORK');
  assert.equal(result.prNumber, 12);
  assert.equal(result.notes, 'Fix The Null Check');
});

check('REWORK with no notes is UNKNOWN (not a silent no-op)', () => {
  assert.deepEqual(parseInboundCommand('REWORK 12'), { kind: 'UNKNOWN', raw: 'REWORK 12' });
  assert.equal(parseInboundCommand('REWORK 12    ').kind, 'UNKNOWN');
});

check('MERGE with no number is UNKNOWN', () => {
  assert.equal(parseInboundCommand('MERGE').kind, 'UNKNOWN');
  assert.equal(parseInboundCommand('MERGE abc').kind, 'UNKNOWN');
});

check('gibberish is UNKNOWN', () => {
  assert.deepEqual(parseInboundCommand('lol what'), { kind: 'UNKNOWN', raw: 'lol what' });
});

check('empty body is UNKNOWN', () => {
  assert.equal(parseInboundCommand('').kind, 'UNKNOWN');
});

// ── isPmCodeReviewComment ──────────────────────────────────────────────

check('PM CODE REVIEW header detected (exact case)', () => {
  assert.equal(isPmCodeReviewComment('PM CODE REVIEW — PR #123\nVERDICT: APPROVE'), true);
});

check('PM CODE REVIEW header detected (any case, leading whitespace)', () => {
  assert.equal(isPmCodeReviewComment('  pm code review for PR #123'), true);
});

check('regular comment is not a PM CODE REVIEW', () => {
  assert.equal(isPmCodeReviewComment('Looks good, one nit on line 12.'), false);
  assert.equal(isPmCodeReviewComment('Please pm code review this later'), false); // not at start
});

// ── parsePmVerdict ──────────────────────────────────────────────────────

check('parses PR#, VERDICT, and tsc line from a full verdict comment', () => {
  const text = [
    'PM CODE REVIEW — PR #123',
    'VERDICT: APPROVE',
    'tsc: 0 new errors (39 pre-existing, baseline unchanged)',
    '',
    'Nice work on the edge cases.',
  ].join('\n');
  const verdict = parsePmVerdict(text);
  assert.equal(verdict.prNumber, 123);
  assert.equal(verdict.verdict, 'APPROVE');
  assert.equal(verdict.tscLine, 'tsc: 0 new errors (39 pre-existing, baseline unchanged)');
});

check('parses REWORK verdict, tolerates "PR#123" with no space/hash', () => {
  const verdict = parsePmVerdict('PM CODE REVIEW\nPR#123\nVERDICT REWORK\nsee comments below');
  assert.equal(verdict.prNumber, 123);
  assert.equal(verdict.verdict, 'REWORK');
});

check('missing fields degrade to null instead of throwing', () => {
  const verdict = parsePmVerdict('PM CODE REVIEW — just some notes, no structured fields');
  assert.equal(verdict.prNumber, null);
  assert.equal(verdict.verdict, null);
  assert.equal(verdict.tscLine, null);
});

// ── composeVerdictSms ────────────────────────────────────────────────

check('composes the reply-command hint with the real PR number', () => {
  const sms = composeVerdictSms({ prNumber: 123, verdict: 'APPROVE', tscLine: 'tsc: 0 new errors' });
  assert.match(sms, /PR #123/);
  assert.match(sms, /APPROVE/);
  assert.match(sms, /MERGE 123 \/ HOLD 123 \/ REWORK 123 <notes>/);
});

check('falls back gracefully when PR# is missing', () => {
  const sms = composeVerdictSms({ prNumber: null, verdict: 'APPROVE', tscLine: null });
  assert.match(sms, /PR \(number not found\)/);
  assert.match(sms, /MERGE <n> \/ HOLD <n> \/ REWORK <n> <notes>/);
});

console.log(`\n${passed} check(s) passed`);
if (process.exitCode) {
  console.error('\nSome checks FAILED — see above.');
  process.exit(process.exitCode);
}
