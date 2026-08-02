#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — eventWriteAuth.ts canWriteEventForRole test (issue #187)
//
// Plain-Node smoke test, same on-the-fly-transpile convention as
// test-media-selection.js (no test framework in this repo).
//
//   node scripts/test-event-write-auth.js
//
// canWriteEventForRole is a pure mirror of firestore.rules' canWriteEvent
// (eventId, venueId): isStaff() || (isVenueAdmin() && venueId in venueIds())
// || (isEventAdmin() && eventId in eventIds()). It's split out from
// requireEventWrite (which needs the Admin SDK to verify a bearer token and
// load the caller's user doc) specifically so this policy can be exercised
// directly, without mocking Firebase Auth/Firestore — the same reason
// mediaSelection.ts's pure functions get their own test files instead of
// being covered only through the routes that call them.
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

// eventWriteAuth.ts also imports firebase-admin.ts at module scope (for
// requireEventWrite/loadEventVenueId), but — same as test-publish-media.js
// requiring publishMedia.ts directly — that import is side-effect-free
// until something actually calls ensureApp() (getAdminAuth/getAdminDb do,
// canWriteEventForRole doesn't), so no credentials or stubbing are needed
// just to exercise the pure policy function.
const { canWriteEventForRole } = require(path.join(ROOT, 'lib', 'eventWriteAuth.ts'))

const tests = []
function check(label, fn) {
  tests.push({ label, fn })
}

// ── (a) staff roles can write any event, regardless of scoping ─────────

check('super_admin/moderator/support can write any event with no venueIds/eventIds', () => {
  for (const role of ['super_admin', 'moderator', 'support']) {
    assert.equal(canWriteEventForRole({ role }, 'event1', 'venue1'), true, `${role} should be able to write`)
  }
})

// ── (b) venue_admin is scoped to venueIds ───────────────────────────────

check('venue_admin can write an event whose venueId is in their venueIds', () => {
  assert.equal(canWriteEventForRole({ role: 'venue_admin', venueIds: ['venue1'] }, 'event1', 'venue1'), true)
})

check('venue_admin cannot write an event whose venueId is NOT in their venueIds', () => {
  assert.equal(canWriteEventForRole({ role: 'venue_admin', venueIds: ['venue2'] }, 'event1', 'venue1'), false)
})

check('venue_admin cannot write an event with no venueId at all (orphan event)', () => {
  assert.equal(canWriteEventForRole({ role: 'venue_admin', venueIds: ['venue1'] }, 'event1', ''), false)
})

// ── (c) event_admin is scoped to eventIds, independent of venueId ──────

check('event_admin can write an event whose id is in their eventIds, even with a mismatched venueId', () => {
  assert.equal(canWriteEventForRole({ role: 'event_admin', eventIds: ['event1'] }, 'event1', 'venue-they-cannot-access'), true)
})

check('event_admin cannot write an event whose id is NOT in their eventIds', () => {
  assert.equal(canWriteEventForRole({ role: 'event_admin', eventIds: ['event2'] }, 'event1', 'venue1'), false)
})

// ── (d) everyone else (venue_staff, event_staff, no role, unknown role) is denied ──

check('venue_staff/event_staff/undefined/unknown roles cannot write events', () => {
  for (const role of ['venue_staff', 'event_staff', undefined, 'made_up_role']) {
    assert.equal(canWriteEventForRole({ role, venueIds: ['venue1'], eventIds: ['event1'] }, 'event1', 'venue1'), false, `${role} should be denied`)
  }
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
