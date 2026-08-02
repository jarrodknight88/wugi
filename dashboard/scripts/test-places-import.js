#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — placesImport.ts test
//
// Plain-Node smoke test, same on-the-fly-transpile convention as
// test-media-selection.js (no test framework in this repo).
//
//   node scripts/test-places-import.js
//
// Exercises two issue #179 UAT-reported bugs:
//   1. buildVenueDoc() must write the 4-key location superset
//      { lat, lng, latitude, longitude } — modal-created venues that only
//      wrote { latitude, longitude } failed the venue edit form's lat/lng
//      read (see scripts/upsert-flagged-venues.js's location comment for
//      why all four keys are canon: three shapes coexist live).
//   2. titleCaseAddress() must title-case a raw Google address
//      ('1086 alco st ne' -> '1086 Alco St NE') while keeping US state
//      postal codes and directional/ordinal street suffixes ALL-CAPS.
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

const { buildVenueDoc, titleCaseAddress } = require(path.join(ROOT, 'lib', 'placesImport.ts'))

const tests = []
function check(label, fn) {
  tests.push({ label, fn })
}

function place(overrides) {
  return {
    id: 'ChIJtest',
    displayName: { text: 'Test Bar' },
    formattedAddress: '1086 alco st ne, atlanta, ga 30307',
    location: { latitude: 33.75, longitude: -84.35 },
    types: ['bar'],
    primaryType: 'bar',
    ...overrides,
  }
}

// ── (1) location shape ─────────────────────────────────────────────────

check('buildVenueDoc writes the 4-key location shape (lat/lng + latitude/longitude)', () => {
  const venue = buildVenueDoc(place({}), '', 'fake-key')
  assert.deepEqual(venue.location, { lat: 33.75, lng: -84.35, latitude: 33.75, longitude: -84.35 })
})

check('buildVenueDoc still writes all four keys when Google omits coordinates', () => {
  const venue = buildVenueDoc(place({ location: undefined }), '', 'fake-key')
  assert.deepEqual(venue.location, { lat: 0, lng: 0, latitude: 0, longitude: 0 })
})

// ── (2) address casing ───────────────────────────────────────────────

check('buildVenueDoc title-cases the address, preserving NE and GA', () => {
  const venue = buildVenueDoc(place({}), '', 'fake-key')
  assert.equal(venue.address, '1086 Alco St NE, Atlanta, GA 30307')
})

check('titleCaseAddress: lowercase directional suffix stays ALL-CAPS', () => {
  assert.equal(titleCaseAddress('1086 alco st ne'), '1086 Alco St NE')
})

check('titleCaseAddress: lowercase state abbreviation stays ALL-CAPS', () => {
  assert.equal(titleCaseAddress('atlanta, ga'), 'Atlanta, GA')
})

check('titleCaseAddress: all four directional/ordinal suffixes', () => {
  assert.equal(titleCaseAddress('100 main st ne'), '100 Main St NE')
  assert.equal(titleCaseAddress('100 main st nw'), '100 Main St NW')
  assert.equal(titleCaseAddress('100 main st se'), '100 Main St SE')
  assert.equal(titleCaseAddress('100 main st sw'), '100 Main St SW')
})

check('titleCaseAddress: already-mixed-case input is not double-mangled', () => {
  assert.equal(titleCaseAddress('1086 ALCO ST NE'), '1086 Alco St NE')
})

check('titleCaseAddress: empty string passes through', () => {
  assert.equal(titleCaseAddress(''), '')
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
