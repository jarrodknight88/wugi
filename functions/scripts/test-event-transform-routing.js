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

// ── recap inference (venue matched, no date at all) ────────────────

check('recap inference: venue matched + no parseable date (explicit or relative) -> night_observation', () => {
  const result = classifyIntelPost(
    { sourceAccount: 'thetestroom', caption: 'Thanks for an amazing night everyone!', postedAt: ANCHOR, accountType: 'venue' },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'night_observation');
  assert.equal(result.venue.id, 'v1');
  // ANCHOR (2026-07-20T12:00:00Z) is a Monday in ET.
  assert.equal(result.dateISO, '2026-07-20');
  assert.equal(result.dayOfWeek, core.dayOfWeekET('2026-07-20'));
});

check('recap inference via relative vocabulary: "tonight" with venue matched resolves through the classifier', () => {
  const result = classifyIntelPost(
    { sourceAccount: 'thetestroom', caption: 'Tonight only, doors at 10', postedAt: ANCHOR, accountType: 'venue' },
    INDEX,
    TODAY
  );
  // "tonight" resolves to the anchor's ET date, which is in the past
  // relative to TODAY -> falls into the ordinary past-date branch, not
  // recap inference (this is date-resolved, not dateless).
  assert.equal(result.outcome, 'night_observation');
  assert.equal(result.dateISO, '2026-07-20');
});

check('recap inference does not apply when the venue is unmatched or ambiguous', () => {
  const unmatched = classifyIntelPost(
    { sourceAccount: 'unknownaccount', caption: 'Thanks for an amazing night everyone!', postedAt: ANCHOR, accountType: 'promoter' },
    INDEX,
    TODAY
  );
  assert.equal(unmatched.outcome, 'needs_classification');

  const ambiguousIndex = core.buildVenueIndex([
    { id: 'a', name: 'The Yard House' },
    { id: 'b', name: 'The Yard House' },
  ]);
  const ambiguous = classifyIntelPost(
    { sourceAccount: 'promoacct', caption: 'The Yard House thanks everyone for an amazing night!', postedAt: ANCHOR, accountType: 'promoter' },
    ambiguousIndex,
    TODAY
  );
  assert.equal(ambiguous.outcome, 'needs_classification');
});

// ── unparseable / no venue ───────────────────────────────────────────

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

check('staff account: resolves venue from caption, not handle (non-venue type)', () => {
  const result = classifyIntelPost(
    { sourceAccount: 'bartender_kay', caption: 'Come see me at Promoted Lounge Aug 1', postedAt: ANCHOR, accountType: 'staff' },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'draft_event');
  assert.equal(result.venue.id, 'v2');
});

check('influencer account: resolves venue from caption, not handle (non-venue type)', () => {
  const result = classifyIntelPost(
    { sourceAccount: 'atl_influencer', caption: 'Promoted Lounge Aug 1 pull up', postedAt: ANCHOR, accountType: 'influencer' },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'draft_event');
  assert.equal(result.venue.id, 'v2');
});

// ── mention-match fallback (issue #236) ─────────────────────────────
// Neither the sourceAccount handle nor the caption text names a venue in
// these cases — only a caption @-mention or structured tag resolves it.

check('caption @-mention resolves the venue when handle and name-in-caption both miss', () => {
  const result = classifyIntelPost(
    {
      sourceAccount: 'chuckyfoto',
      caption: 'Huge set last night at @thetestroom, Aug 1 next time',
      postedAt: ANCHOR,
      accountType: 'photographer',
    },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'draft_event');
  assert.equal(result.venue.id, 'v1');
});

check('structured taggedUsers/mentions resolve the venue when the caption names nothing', () => {
  const result = classifyIntelPost(
    {
      sourceAccount: 'chuckyfoto',
      caption: 'Huge set last night, Aug 1 next time',
      postedAt: ANCHOR,
      accountType: 'photographer',
      structuredMentions: ['thetestroom'],
    },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'draft_event');
  assert.equal(result.venue.id, 'v1');
});

check('mentioning two distinct known venues -> needs_classification (venue-ambiguous), never auto-picked', () => {
  const result = classifyIntelPost(
    {
      sourceAccount: 'chuckyfoto',
      caption: 'Aug 1: @thetestroom or @promotedloungeatl, come thru',
      postedAt: ANCHOR,
      accountType: 'photographer',
    },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'needs_classification');
  assert.equal(result.reason, 'venue-ambiguous');
});

check('a post mentioning only its own sourceAccount does not self-match', () => {
  const result = classifyIntelPost(
    {
      sourceAccount: 'thetestroom',
      caption: 'Aug 1 @thetestroom is going off tonight',
      postedAt: ANCHOR,
      accountType: 'promoter',
    },
    INDEX,
    TODAY
  );
  // Handle-match is skipped (accountType isn't 'venue'/undefined), caption
  // has no venue NAME, and the only mention is the post's own account —
  // excluded, so this must still fall through to needs_classification.
  assert.equal(result.outcome, 'needs_classification');
  assert.equal(result.reason, 'no-venue-match');
});

check('mentioning an unknown account only -> needs_classification (no-venue-match)', () => {
  const result = classifyIntelPost(
    { sourceAccount: 'chuckyfoto', caption: 'Aug 1 @randomfriend is coming out', postedAt: ANCHOR, accountType: 'photographer' },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'needs_classification');
  assert.equal(result.reason, 'no-venue-match');
});

// ── regression guard: mention-match must never override an existing
// handle-match or name-in-caption resolution (precedence unchanged) ────

check('regression: handle-match still wins outright even when the caption mentions a different venue', () => {
  const result = classifyIntelPost(
    {
      sourceAccount: 'thetestroom',
      caption: 'Aug 1, co-hosted with @promotedloungeatl tonight',
      postedAt: ANCHOR,
      accountType: 'venue',
    },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'draft_event');
  assert.equal(result.venue.id, 'v1'); // the account's own venue, not the mentioned one
});

check('regression: name-in-caption match still wins outright even when a different venue is also @-mentioned', () => {
  const result = classifyIntelPost(
    {
      sourceAccount: 'some_promoter',
      caption: 'Pulling up to Promoted Lounge Aug 1, shoutout @thetestroom',
      postedAt: ANCHOR,
      accountType: 'promoter',
    },
    INDEX,
    TODAY
  );
  assert.equal(result.outcome, 'draft_event');
  assert.equal(result.venue.id, 'v2'); // matched by name in caption, not the mention
});

check('regression: ambiguous name-in-caption match is not "rescued" into a single mention match', () => {
  const ambiguousIndex = core.buildVenueIndex([
    { id: 'a', name: 'The Yard House', instagram: 'yardhousea' },
    { id: 'b', name: 'The Yard House', instagram: 'yardhouseb' },
  ]);
  const result = classifyIntelPost(
    {
      sourceAccount: 'promoacct',
      caption: 'The Yard House this Aug 1, tag @yardhousea',
      postedAt: ANCHOR,
      accountType: 'promoter',
    },
    ambiguousIndex,
    TODAY
  );
  assert.equal(result.outcome, 'needs_classification');
  assert.equal(result.reason, 'venue-ambiguous');
});

console.log(`\n${passed} check(s) passed`);
if (process.exitCode) {
  console.error('\nSome checks FAILED — see above.');
  process.exit(process.exitCode);
}
