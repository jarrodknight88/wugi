#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — editorial calendar placement engine test (issue #270)
//
// Plain-Node smoke test (no test framework in this repo — see
// scripts/test-draft-title.js for the same convention). Compiles
// lib/placement.ts on the fly with the TypeScript compiler API.
//
//   node scripts/test-placement.js
//
// Exercises computePlacements/computeDealOccurrences directly — no
// network, no Firestore. This is the "observe whether the ranking
// heuristic behaves" check called out in the issue: it pins down the
// tonight-first / cap / under-filled behavior so a future tweak to the
// scoring can't silently change it.
// ─────────────────────────────────────────────────────────────────────
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')

require.extensions['.ts'] = function (mod, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  mod._compile(outputText, filename)
}

const origResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) {
    request = path.join(ROOT, request.slice(2))
  }
  return origResolveFilename.call(this, request, ...rest)
}

const {
  computePlacements, computeDealOccurrences, bucketByDay, isDayUnderfilled,
  parseDashboardDate, addDays, PLACEMENT_CONFIG, filterForSegment,
} = require(path.join(ROOT, 'lib', 'placement.ts'))

const tests = []
function check(label, fn) {
  tests.push({ label, fn })
}

const TODAY = '2026-09-02' // Wednesday
const venues = [
  { id: 'v-premium', tier: 'premium' },
  { id: 'v-standard', tier: 'standard' },
  { id: 'v-unclaimed', tier: 'unclaimed' },
]

function ev(overrides) {
  return {
    id: 'e', title: 'Event', venueId: 'v-standard', venueName: 'Venue',
    dateISO: TODAY, status: 'approved', ...overrides,
  }
}

// ── date parsing ────────────────────────────────────────────────────

check('parses dashboard "MMM DD YYYY" display date to ISO', () => {
  assert.equal(parseDashboardDate('SEP 02 2026'), '2026-09-02')
})

check('returns null for an empty/unparseable date', () => {
  assert.equal(parseDashboardDate(''), null)
  assert.equal(parseDashboardDate('not a date'), null)
})

check('addDays rolls over month/year boundaries', () => {
  assert.equal(addDays('2026-09-02', 7), '2026-09-09')
  assert.equal(addDays('2026-12-30', 3), '2027-01-02')
})

// ── eligibility ─────────────────────────────────────────────────────

check('excludes non-approved events', () => {
  const placed = computePlacements([ev({ id: 'a', status: 'pending' })], venues, { today: TODAY })
  assert.equal(placed.length, 0)
})

check('treats a missing isActive as active (dashboard docs omit it)', () => {
  const placed = computePlacements([ev({ id: 'a' })], venues, { today: TODAY })
  assert.equal(placed.length, 1)
})

check('excludes isActive === false', () => {
  const placed = computePlacements([ev({ id: 'a', isActive: false })], venues, { today: TODAY })
  assert.equal(placed.length, 0)
})

// ── tonight-first + horizon ─────────────────────────────────────────

check("tonight's events outrank a higher-scoring event later in the horizon for homepage slots", () => {
  const events = [
    ev({ id: 'tonight-standard', dateISO: TODAY, venueId: 'v-standard' }),
    ev({ id: 'later-premium', dateISO: addDays(TODAY, 3), venueId: 'v-premium' }),
  ]
  const placed = computePlacements(events, venues, { today: TODAY })
  const tonight = placed.find(p => p.id === 'tonight-standard')
  assert.equal(tonight.tier, 'homepage-featured')
  assert.equal(tonight.isTonight, true)
})

check('events outside the 7-day horizon never get homepage/in-app tiers', () => {
  const events = [ev({ id: 'far', dateISO: addDays(TODAY, 30), venueId: 'v-premium', hasTickets: true })]
  const placed = computePlacements(events, venues, { today: TODAY })
  assert.equal(placed[0].tier, 'standard-listing')
})

check('backfills remaining homepage slots from the rest of the horizon, ranked by score', () => {
  const events = [
    ev({ id: 'weeknight-low', dateISO: addDays(TODAY, 1), venueId: 'v-unclaimed' }),
    ev({ id: 'weekend-high', dateISO: addDays(TODAY, 3), venueId: 'v-premium', hasTickets: true }),
  ]
  const placed = computePlacements(events, venues, { today: TODAY })
  const high = placed.find(p => p.id === 'weekend-high')
  const low = placed.find(p => p.id === 'weeknight-low')
  assert.equal(high.tier, 'homepage-featured')
  assert.equal(low.tier, 'homepage-featured') // cap of 6 easily covers 2 events
  assert.ok(high.score > low.score)
})

check('homepage-featured cap is enforced across the whole rolling window, not per day', () => {
  const events = Array.from({ length: PLACEMENT_CONFIG.homepageFeaturedCap + 3 }, (_, i) =>
    ev({ id: `e${i}`, dateISO: TODAY, venueId: 'v-premium' })
  )
  const placed = computePlacements(events, venues, { today: TODAY })
  const featured = placed.filter(p => p.tier === 'homepage-featured')
  assert.equal(featured.length, PLACEMENT_CONFIG.homepageFeaturedCap)
})

check('venue tier outranks a ticket-momentum stand-in for an otherwise-tied event', () => {
  const events = [
    ev({ id: 'premium-no-tickets', dateISO: TODAY, venueId: 'v-premium', hasTickets: false }),
    ev({ id: 'unclaimed-with-tickets', dateISO: TODAY, venueId: 'v-unclaimed', hasTickets: true }),
  ]
  const placed = computePlacements(events, venues, { today: TODAY })
  const a = placed.find(p => p.id === 'premium-no-tickets')
  const b = placed.find(p => p.id === 'unclaimed-with-tickets')
  assert.ok(a.score > b.score)
})

// ── segments ────────────────────────────────────────────────────────

check('default segment passes every event through unchanged', () => {
  const events = [ev({ id: 'a' }), ev({ id: 'b' })]
  assert.equal(filterForSegment(events, 'default').length, 2)
})

check('an unknown segment id falls back to the default (no-op) filter', () => {
  const events = [ev({ id: 'a' })]
  assert.equal(filterForSegment(events, 'nonexistent-cohort').length, 1)
})

// ── deals ───────────────────────────────────────────────────────────

check('expands a recurring deal to every matching weekday in range', () => {
  const deal = { id: 'd1', title: 'Happy Hour', venueId: 'v1', venueName: 'V', daysOfWeek: [3] } // Wednesdays
  const occ = computeDealOccurrences([deal], TODAY, addDays(TODAY, 13))
  assert.equal(occ.length, 2) // 2026-09-02 and 2026-09-09
  assert.ok(occ.every(o => o.tier === 'deal'))
})

check('honors validFrom/validUntil bounds on a recurring deal', () => {
  const deal = {
    id: 'd1', title: 'Happy Hour', venueId: 'v1', venueName: 'V', daysOfWeek: [3],
    validFrom: addDays(TODAY, 3), validUntil: addDays(TODAY, 20),
  }
  // Wednesdays in [TODAY, TODAY+13] are TODAY (09-02) and 09-09; validFrom
  // (09-05) rules out TODAY's occurrence, leaving only 09-09.
  const occ = computeDealOccurrences([deal], TODAY, addDays(TODAY, 13))
  assert.equal(occ.length, 1)
  assert.equal(occ[0].dateISO, addDays(TODAY, 7))
})

check('resolves a one-off flash deal to its single display date', () => {
  const deal = { id: 'd2', title: 'Flash Deal', venueId: 'v1', venueName: 'V', date: 'SEP 05 2026' }
  const occ = computeDealOccurrences([deal], TODAY, addDays(TODAY, 13))
  assert.equal(occ.length, 1)
  assert.equal(occ[0].dateISO, '2026-09-05')
})

check('excludes a paused/inactive deal entirely', () => {
  const deal = { id: 'd3', title: 'Paused', venueId: 'v1', venueName: 'V', daysOfWeek: [3], status: 'paused' }
  const occ = computeDealOccurrences([deal], TODAY, addDays(TODAY, 13))
  assert.equal(occ.length, 0)
})

// ── day bucketing / under-filled ───────────────────────────────────

check('bucketByDay groups mixed events and deals by dateISO', () => {
  const items = [
    ev({ id: 'a', dateISO: TODAY, tier: 'standard-listing', score: 0, isTonight: true }),
    { id: 'd:1', title: 'Deal', venueId: 'v1', venueName: 'V', dateISO: TODAY, tier: 'deal' },
  ]
  const buckets = bucketByDay(items)
  assert.equal(buckets.get(TODAY).length, 2)
})

check('a day under the threshold is flagged under-filled', () => {
  assert.equal(isDayUnderfilled([]), true)
  const items = Array.from({ length: PLACEMENT_CONFIG.underfilledThreshold }, (_, i) => ({ dateISO: TODAY, id: `${i}` }))
  assert.equal(isDayUnderfilled(items), false)
})

async function main() {
  let passed = 0
  for (const { label, fn } of tests) {
    try {
      await fn()
      passed++
      console.log(`ok   - ${label}`)
    } catch (err) {
      console.error(`FAIL - ${label}`)
      console.error(err)
      process.exitCode = 1
    }
  }
  if (process.exitCode) {
    console.error(`\n${passed}/${tests.length} passed, some FAILED`)
  } else {
    console.log(`\n${passed}/${tests.length} passed`)
  }
}

main()
