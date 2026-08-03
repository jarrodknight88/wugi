#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — Bridge v1.4 dispatch queue test
//
// Plain-Node smoke test (no test framework in this repo — see
// package.json). Exercises the pure functions in src/bridge/dispatchQueue.ts
// against the compiled lib/ output, so it needs a build first:
//
//   npm run build && node scripts/test-dispatch-queue.js
//
// or just: npm run test:dispatch-queue
//
// getInFlightCap/findEligibleEntryIndex/selectQueueAction are pure (no
// Firestore/Asana/GitHub I/O), which is what makes them testable here.
// The transaction wrapper, Asana assignee flip, and lane-attach polling
// in dispatchQueue.ts are thin glue over these and are not covered by
// this script — same precedent as asanaWebhook.ts's claimDispatch, which
// also isn't unit tested at that layer.
// ─────────────────────────────────────────────────────────────────────
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  getInFlightCap,
  findEligibleEntryIndex,
  selectQueueAction,
} = require(path.join(__dirname, '..', 'lib', 'bridge', 'dispatchQueue.js'));

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

function entry(asanaTaskGid, lane, note) {
  return note ? { asanaTaskGid, lane, note } : { asanaTaskGid, lane };
}

// ── getInFlightCap: ET boundary ───────────────────────────────────────

check('cap is 4 just after 08:00 ET and just before 22:00 ET (EST, winter)', () => {
  // 2026-01-15 is EST (UTC-5): 08:00 ET = 13:00 UTC, 21:59 ET = 02:59 UTC next day.
  assert.equal(getInFlightCap(new Date('2026-01-15T13:00:00Z')), 4);
  assert.equal(getInFlightCap(new Date('2026-01-16T02:59:00Z')), 4);
});

check('cap is 8 just before 08:00 ET and at/after 22:00 ET (EST, winter)', () => {
  assert.equal(getInFlightCap(new Date('2026-01-15T12:59:00Z')), 8);
  assert.equal(getInFlightCap(new Date('2026-01-16T03:00:00Z')), 8);
});

check('cap is 4 just after 08:00 ET and just before 22:00 ET (EDT, summer)', () => {
  // 2026-07-15 is EDT (UTC-4): 08:00 ET = 12:00 UTC, 21:59 ET = 01:59 UTC next day.
  assert.equal(getInFlightCap(new Date('2026-07-15T12:00:00Z')), 4);
  assert.equal(getInFlightCap(new Date('2026-07-16T01:59:00Z')), 4);
});

check('cap is 8 just before 08:00 ET and at/after 22:00 ET (EDT, summer)', () => {
  assert.equal(getInFlightCap(new Date('2026-07-15T11:59:00Z')), 8);
  assert.equal(getInFlightCap(new Date('2026-07-16T02:00:00Z')), 8);
});

check('cap math survives the spring-forward DST transition (2026-03-08)', () => {
  // Clocks jump 2:00 AM EST -> 3:00 AM EDT at 07:00 UTC. A naive fixed
  // UTC-5 offset would put 12:00 UTC at 07:00 ET (cap 8); the correct,
  // DST-aware EDT offset puts it at 08:00 ET (cap 4) — this is the check
  // that actually distinguishes the two implementations.
  assert.equal(getInFlightCap(new Date('2026-03-08T11:59:00Z')), 8); // 07:59 EDT
  assert.equal(getInFlightCap(new Date('2026-03-08T12:00:00Z')), 4); // 08:00 EDT
});

check('cap math survives the fall-back DST transition (2026-11-01)', () => {
  // Clocks fall 2:00 AM EDT -> 1:00 AM EST at 06:00 UTC.
  assert.equal(getInFlightCap(new Date('2026-11-01T11:59:00Z')), 8); // 06:59 EST
  assert.equal(getInFlightCap(new Date('2026-11-01T13:00:00Z')), 4); // 08:00 EST
});

// ── findEligibleEntryIndex / lane collision ───────────────────────────

check('picks the head entry when no lanes are in flight', () => {
  const entries = [entry('1', 'mobile-app'), entry('2', 'dashboard')];
  assert.equal(findEligibleEntryIndex(entries, []), 0);
});

check('skips past a queue entry whose lane is already in flight', () => {
  const entries = [entry('1', 'mobile-app'), entry('2', 'dashboard')];
  assert.equal(findEligibleEntryIndex(entries, ['mobile-app']), 1);
});

check("an in-flight 'unknown' lane blocks every queue entry", () => {
  const entries = [entry('1', 'mobile-app'), entry('2', 'dashboard'), entry('3', 'lens')];
  assert.equal(findEligibleEntryIndex(entries, ['unknown']), -1);
});

check("a queue entry with lane 'unknown' is only eligible when nothing is in flight", () => {
  // Queue entries are typed to real lanes only, but defend the collision
  // rule symmetrically in case a doc is hand-edited with a stray 'unknown'.
  const entries = [{ asanaTaskGid: '1', lane: 'unknown' }, entry('2', 'dashboard')];
  assert.equal(findEligibleEntryIndex(entries, []), 0);
  assert.equal(findEligibleEntryIndex(entries, ['dashboard']), -1);
});

check('returns -1 when every queue entry collides', () => {
  const entries = [entry('1', 'mobile-app'), entry('2', 'mobile-app')];
  assert.equal(findEligibleEntryIndex(entries, ['mobile-app']), -1);
});

// ── selectQueueAction: paused / empty / cap / pop ─────────────────────

check('paused queue always skips, regardless of entries or cap', () => {
  const action = selectQueueAction({ paused: true, entries: [entry('1', 'mobile-app')] }, [], 4);
  assert.deepEqual(action, { type: 'skip', reason: 'paused' });
});

check('empty queue is a no-op', () => {
  const action = selectQueueAction({ paused: false, entries: [] }, [], 4);
  assert.deepEqual(action, { type: 'skip', reason: 'empty' });
});

check('at or above cap skips even with an eligible lane', () => {
  const action = selectQueueAction(
    { paused: false, entries: [entry('1', 'mobile-app')] },
    ['dashboard', 'dashboard', 'functions', 'lens'],
    4
  );
  assert.deepEqual(action, { type: 'skip', reason: 'at-cap' });
});

check('no-eligible-lane skip when every entry collides but cap has room', () => {
  const action = selectQueueAction(
    { paused: false, entries: [entry('1', 'mobile-app')] },
    ['mobile-app'],
    4
  );
  assert.deepEqual(action, { type: 'skip', reason: 'no-eligible-lane' });
});

check('pop removes exactly the eligible entry and preserves the order of the rest', () => {
  const entries = [entry('1', 'mobile-app'), entry('2', 'dashboard'), entry('3', 'lens')];
  const action = selectQueueAction({ paused: false, entries }, ['mobile-app'], 4);
  assert.equal(action.type, 'pop');
  assert.equal(action.index, 1);
  assert.equal(action.position, 2);
  assert.deepEqual(action.entry, entry('2', 'dashboard'));
  assert.deepEqual(action.remainingEntries, [entry('1', 'mobile-app'), entry('3', 'lens')]);
  assert.equal(action.remainingEntries.length, entries.length - 1);
});

check('idempotency: a second selection over the already-popped queue does not re-pop the same entry', () => {
  const entries = [entry('1', 'mobile-app'), entry('2', 'dashboard')];
  const first = selectQueueAction({ paused: false, entries }, [], 4);
  assert.equal(first.type, 'pop');
  assert.equal(first.entry.asanaTaskGid, '1');

  // Simulate the queue doc as it would read after the transaction that
  // popped `first` committed — a second terminal-report event for the
  // same issue firing the chain step again must operate on this new
  // state, not the stale `entries` array, so it can never dispatch '1' twice.
  const second = selectQueueAction({ paused: false, entries: first.remainingEntries }, [], 4);
  assert.equal(second.type, 'pop');
  assert.equal(second.entry.asanaTaskGid, '2');
  assert.notEqual(second.entry.asanaTaskGid, first.entry.asanaTaskGid);
});

console.log(`\n${passed} check(s) passed`);
if (process.exitCode) {
  console.error('\nSome checks FAILED — see above.');
  process.exit(process.exitCode);
}
