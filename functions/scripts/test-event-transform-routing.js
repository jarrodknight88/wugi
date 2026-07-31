#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — eventTransformRouting (classifyIntelPost) unit tests
//
// Plain-Node smoke test (no test framework in this repo — see
// package.json). Exercises the pure venueIntel routing classifier in
// src/intel/eventTransformRouting.ts against the compiled lib/ output:
//
//   npm run build && node scripts/test-event-transform-routing.js
//
// or just: npm test
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const core = require(path.join(__dirname, '..', 'lib', 'intel', 'eventTransformCore.js'));
const { classifyIntelPost } = require(path.join(__dirname, '..', 'lib', 'intel', 'eventTransformRouting.js'));

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

const VENUES = [
  { id: 'v1', name: 'The Test Room', aliases: ['Test Room ATL'], instagram: '@thetestroom' },
  { id: 'v2', name: 'Promoted Lounge', instagram: 'promotedloungeatl' },
];
const INDEX = core.buildVenueIndex(VENUES);
const TODAY = '2026-07-31'; // fixed "today" so future/past assertions are deterministic
const ANCHOR = '2026-07-20T12:00:00.000Z'; // postedAt, well before TODAY

// ── future vs past ────────────────────────────────────────────────────

check('future date + venue account matched by handle -> draft_event', () => {
  const result = classifyIntelPost(
    { sourceAccount: 'thetestroom', caption: 'Big night Aug 1, doors at 10', postedAt: ANCHOR, accountType: 'venue' },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'draft_event');
  assert.equal(result.venue.id, 'v1');
  assert.equal(result.dateISO, '2026-08-01');
  assert.equal(result.title, 'Big night Aug 1, doors at 10');
});

check('past date + venue matched -> night_observation with ET day-of-week', () => {
  const result = classifyIntelPost(
    { sourceAccount: 'thetestroom', caption: 'Thanks for coming out Jul 25!', postedAt: ANCHOR, accountType: 'venue' },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'night_observation');
  assert.equal(result.venue.id, 'v1');
  assert.equal(result.dateISO, '2026-07-25');
  assert.equal(result.dayOfWeek, core.dayOfWeekET('2026-07-25'));
});

check('date exactly today counts as future (>=)', () => {
  const result = classifyIntelPost(
    { sourceAccount: 'thetestroom', caption: 'Tonight! Jul 31', postedAt: ANCHOR, accountType: 'venue' },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'draft_event');
});

// ── unparseable / no venue ───────────────────────────────────────────

check('no parseable date -> needs_classification', () => {
  const result = classifyIntelPost(
    { sourceAccount: 'thetestroom', caption: 'Thanks for an amazing night everyone!', postedAt: ANCHOR, accountType: 'venue' },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'needs_classification');
  assert.equal(result.reason, 'no-parseable-date');
});

check('no venue match -> needs_classification', () => {
  const result = classifyIntelPost(
    { sourceAccount: 'unknownaccount', caption: 'Huge night Aug 1 at some random spot', postedAt: ANCHOR, accountType: 'promoter' },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'needs_classification');
  assert.equal(result.reason, 'no-venue-match');
});

check('neither date nor venue -> combined needs_classification reason', () => {
  const result = classifyIntelPost(
    { sourceAccount: 'unknownaccount', caption: 'no info here', postedAt: ANCHOR, accountType: 'promoter' },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'needs_classification');
  assert.equal(result.reason, 'no-parseable-date-and-no-venue-match');
});

check('ambiguous venue -> needs_classification', () => {
  // Two distinct venue docs sharing a name — a genuine real-world collision
  // (never auto-picked; matchVenueInCaption requires the full word set).
  const ambiguousIndex = core.buildVenueIndex([
    { id: 'a', name: 'The Yard House' },
    { id: 'b', name: 'The Yard House' },
  ]);
  const result = classifyIntelPost(
    { sourceAccount: 'promoacct', caption: 'The Yard House this Aug 1', postedAt: ANCHOR, accountType: 'promoter' },
    ambiguousIndex,
    TODAY
  );
  assert.equal(result.outcome, 'needs_classification');
  assert.equal(result.reason, 'venue-ambiguous');
});

// ── accountType-driven venue resolution ─────────────────────────────

check('promoter account: venue resolved from caption text, not the account handle', () => {
  const result = classifyIntelPost(
    { sourceAccount: 'some_promoter', caption: 'Pulling up to Promoted Lounge Aug 1', postedAt: ANCHOR, accountType: 'promoter' },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'draft_event');
  assert.equal(result.venue.id, 'v2');
});

check('unknown accountType still tries handle match first (defaults like venue)', () => {
  const result = classifyIntelPost(
    { sourceAccount: 'thetestroom', caption: 'Aug 1 doors 10pm', postedAt: ANCHOR, accountType: undefined },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'draft_event');
  assert.equal(result.venue.id, 'v1');
});

console.log(`\n${passed} check(s) passed`);
if (process.exitCode) {
  console.error('\nSome checks FAILED — see above.');
  process.exit(process.exitCode);
}
