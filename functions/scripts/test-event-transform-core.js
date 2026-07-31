#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — eventTransformCore unit tests
//
// Plain-Node smoke test (no test framework in this repo — see
// package.json). Exercises the pure transform logic in
// src/intel/eventTransformCore.ts against the compiled lib/ output, so it
// needs a build first:
//
//   npm run build && node scripts/test-event-transform-core.js
//
// or just: npm test
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const core = require(path.join(__dirname, '..', 'lib', 'intel', 'eventTransformCore.js'));

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

// ── normalizeText / significantWords ────────────────────────────────

check('normalizeText lowercases, expands &, strips punctuation', () => {
  assert.equal(core.normalizeText("Rock & Roll Night!"), 'rock and roll night');
  assert.equal(core.normalizeText("The Venue's Rooftop"), 'the venues rooftop');
  assert.equal(core.normalizeText('  multi   space  '), 'multi space');
  assert.equal(core.normalizeText(null), '');
});

check('significantWords drops stopwords', () => {
  assert.deepEqual(core.significantWords(core.normalizeText('The Venue at Downtown')), ['venue', 'downtown']);
});

// ── parseDateISO (year inference) ───────────────────────────────────

check('parseDateISO resolves same-year date near the anchor', () => {
  assert.equal(core.parseDateISO('Aug 1', '2026-07-20T12:00:00.000Z'), '2026-08-01');
});

check('parseDateISO rolls to next year when candidate is >30 days before anchor', () => {
  // Captured in December; "Jan 4" must mean next year, not a month ago.
  assert.equal(core.parseDateISO('Jan 4', '2026-12-15T12:00:00.000Z'), '2027-01-04');
});

check('parseDateISO returns null for garbage input', () => {
  assert.equal(core.parseDateISO('not a date', '2026-07-20T12:00:00.000Z'), null);
  assert.equal(core.parseDateISO(null, '2026-07-20T12:00:00.000Z'), null);
  assert.equal(core.parseDateISO('Feb 30', '2026-07-20T12:00:00.000Z'), null); // invalid day-for-month
});

check('parseDateISO returns null when anchor is unparseable', () => {
  assert.equal(core.parseDateISO('Aug 1', 'not-a-date'), null);
});

// ── extractDateFromText ──────────────────────────────────────────────

check('extractDateFromText finds a month/day mention anywhere in free text', () => {
  assert.equal(
    core.extractDateFromText('Pulling up this Saturday, Aug 1st. Doors at 10.', '2026-07-20T12:00:00.000Z'),
    '2026-08-01'
  );
});

check('extractDateFromText applies the same year-inference as parseDateISO', () => {
  assert.equal(core.extractDateFromText('See you Jan 4', '2026-12-15T12:00:00.000Z'), '2027-01-04');
});

check('extractDateFromText returns null with no date mention', () => {
  assert.equal(core.extractDateFromText('Thanks for coming out last night!', '2026-07-20T12:00:00.000Z'), null);
  assert.equal(core.extractDateFromText('', '2026-07-20T12:00:00.000Z'), null);
  assert.equal(core.extractDateFromText(null, '2026-07-20T12:00:00.000Z'), null);
});

check('extractDateFromText skips an invalid candidate and keeps scanning', () => {
  // "Zzz 40" isn't a month; "Aug 1" later in the string should still resolve.
  assert.equal(core.extractDateFromText('Zzz 40 but really Aug 1', '2026-07-20T12:00:00.000Z'), '2026-08-01');
});

// ── parseTimes / computeNightOf / dayOfWeekET ───────────────────────

check('parseTimes extracts start/end from a when string', () => {
  assert.deepEqual(core.parseTimes('Sat, 11 AM – 9 PM'), { startTime: '11:00', endTime: '21:00' });
});

check('parseTimes handles a single time and missing input', () => {
  const result = core.parseTimes('Doors at 10 PM');
  assert.equal(result.startTime, '22:00');
  assert.equal(result.endTime, undefined);
  assert.deepEqual(core.parseTimes(null), {});
});

check('computeNightOf rolls a post-midnight start back to the prior night', () => {
  assert.equal(core.computeNightOf('2026-08-02', '01:30'), '2026-08-01');
  assert.equal(core.computeNightOf('2026-08-02', '22:00'), '2026-08-02');
  assert.equal(core.computeNightOf('2026-08-02'), '2026-08-02');
});

check('dayOfWeekET returns 0-6 for a calendar date', () => {
  assert.equal(core.dayOfWeekET('2026-08-01'), 6); // Saturday
  assert.equal(core.dayOfWeekET('2026-08-02'), 0); // Sunday
});

// ── Relevance gate ────────────────────────────────────────────────────

check('looksLikePlaceName matches "City, ST" and known neighborhoods', () => {
  assert.ok(core.looksLikePlaceName('Atlanta, GA'));
  assert.ok(core.looksLikePlaceName('Buckhead'));
  assert.ok(!core.looksLikePlaceName('Saturday Night Live Set'));
});

check('nonNightlifeReason flags word-bounded non-nightlife keywords', () => {
  assert.ok(core.nonNightlifeReason('Kids Yoga Workshop'));
  assert.ok(!core.nonNightlifeReason('Classic Saturdays')); // "class" must not hit "classic"
  assert.ok(core.nonNightlifeReason('Fun Run Club Meetup')); // "fun run" should hit
});

// ── Venue matching ────────────────────────────────────────────────────

const VENUES = [
  { id: 'v1', name: 'The Test Room', aliases: ['Test Room ATL'], instagram: '@thetestroom' },
  { id: 'v2', name: 'Test Room Rooftop', instagram: 'testroomrooftop' },
  { id: 'v3', name: 'Unrelated Lounge', instagram: null },
];

check('buildVenueIndex + matchVenue: exact name match', () => {
  const index = core.buildVenueIndex(VENUES);
  const result = core.matchVenue('The Test Room', index);
  assert.equal(result.status, 'matched');
  assert.equal(result.venue.id, 'v1');
  assert.equal(result.via, 'exact');
});

check('matchVenue: alias match is exact', () => {
  const index = core.buildVenueIndex(VENUES);
  const result = core.matchVenue('Test Room ATL', index);
  assert.equal(result.status, 'matched');
  assert.equal(result.venue.id, 'v1');
});

check('matchVenue: word-subset contains match', () => {
  const index = core.buildVenueIndex([{ id: 'v4', name: 'The Grand Ballroom Atlanta' }]);
  const result = core.matchVenue('Grand Ballroom', index);
  assert.equal(result.status, 'matched');
  assert.equal(result.via, 'contains');
});

check('matchVenue: ambiguous when multiple candidates share words', () => {
  const index = core.buildVenueIndex([
    { id: 'a', name: 'Test Room North' },
    { id: 'b', name: 'Test Room South' },
  ]);
  const result = core.matchVenue('Test Room', index);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.candidates.length, 2);
});

check('matchVenue: unmatched for unknown venue / empty input', () => {
  const index = core.buildVenueIndex(VENUES);
  assert.equal(core.matchVenue('Nowhere Bar', index).status, 'unmatched');
  assert.equal(core.matchVenue('', index).status, 'unmatched');
  assert.equal(core.matchVenue('X', index).status, 'unmatched'); // single generic word, too short to fuzzy match
});

check('matchVenueByHandle: normalizes @ prefix, case, trailing slash', () => {
  const index = core.buildVenueIndex(VENUES);
  assert.equal(core.matchVenueByHandle('TheTestRoom', index).venue.id, 'v1');
  assert.equal(core.matchVenueByHandle('@thetestroom/', index).venue.id, 'v1');
  assert.equal(core.matchVenueByHandle('unknownhandle', index).status, 'unmatched');
  assert.equal(core.matchVenueByHandle(null, index).status, 'unmatched');
});

check('matchVenueInCaption: finds a venue named inside free text', () => {
  const index = core.buildVenueIndex(VENUES);
  const result = core.matchVenueInCaption('Huge night coming up at The Test Room this weekend!', index);
  assert.equal(result.status, 'matched');
  assert.equal(result.venue.id, 'v1');
});

check('matchVenueInCaption: ambiguous when two venue names both appear', () => {
  const index = core.buildVenueIndex(VENUES);
  const result = core.matchVenueInCaption('The Test Room and Test Room Rooftop are both open tonight', index);
  assert.equal(result.status, 'ambiguous');
});

check('matchVenueInCaption: unmatched with no venue mention', () => {
  const index = core.buildVenueIndex(VENUES);
  assert.equal(core.matchVenueInCaption('Just a normal Friday night out', index).status, 'unmatched');
  assert.equal(core.matchVenueInCaption('', index).status, 'unmatched');
});

// ── deriveEventTitle ──────────────────────────────────────────────────

check('deriveEventTitle takes the first non-empty caption line', () => {
  assert.equal(core.deriveEventTitle('Saturday Night Live\n\nDoors at 10'), 'Saturday Night Live');
});

check('deriveEventTitle truncates long lines and falls back when empty', () => {
  const long = 'x'.repeat(150);
  const title = core.deriveEventTitle(long);
  assert.equal(title.length, 120);
  assert.ok(title.endsWith('...'));
  assert.equal(core.deriveEventTitle(''), 'Untitled event');
  assert.equal(core.deriveEventTitle(null), 'Untitled event');
});

console.log(`\n${passed} check(s) passed`);
if (process.exitCode) {
  console.error('\nSome checks FAILED — see above.');
  process.exit(process.exitCode);
}
