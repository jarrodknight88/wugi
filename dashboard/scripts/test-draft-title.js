#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — generated draft title post-processing test (#163)
//
// Plain-Node smoke test (no test framework in this repo — see
// scripts/test-publish-media.js for the same convention). Compiles
// app/api/draft-events/generate/route.ts on the fly with the TypeScript
// compiler API and resolves the repo's "@/..." path alias by hand, same
// trick test-publish-media.js uses to reach into a route/lib file without
// a bundler.
//
//   node scripts/test-draft-title.js
//
// Exercises stripVenueFromTitle, applyFormatFirstOrdering, and the
// combined postProcessGeneratedTitle directly — no network, no Firestore.
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

const { stripVenueFromTitle, applyFormatFirstOrdering, postProcessGeneratedTitle } = require(
  path.join(ROOT, 'app', 'api', 'draft-events', 'generate', 'route.ts')
)

const tests = []
function check(label, fn) {
  tests.push({ label, fn })
}

// ── venue stripping ────────────────────────────────────────────────

check('strips a trailing "at {venue}" using the venue\'s short name', () => {
  assert.equal(stripVenueFromTitle('Seductive Saturday at Bamboo', 'Bamboo Atlanta'), 'Seductive Saturday')
})

check('strips a trailing "at {venue}" using the venue\'s full name', () => {
  assert.equal(stripVenueFromTitle('Seductive Saturday at Bamboo Atlanta', 'Bamboo Atlanta'), 'Seductive Saturday')
})

check('strips a trailing "@ {venue}" (case-insensitive)', () => {
  assert.equal(stripVenueFromTitle('Seductive Saturday @ BAMBOO', 'Bamboo Atlanta'), 'Seductive Saturday')
})

check('strips a leading "{venue} presents"', () => {
  assert.equal(stripVenueFromTitle('Bamboo Presents Seductive Saturday', 'Bamboo Atlanta'), 'Seductive Saturday')
})

check('leaves a title with no venue mention unchanged', () => {
  assert.equal(stripVenueFromTitle('Seductive Saturday', 'Bamboo Atlanta'), 'Seductive Saturday')
})

check('no-op when venueName is blank', () => {
  assert.equal(stripVenueFromTitle('Seductive Saturday at Bamboo', ''), 'Seductive Saturday at Bamboo')
})

// ── format-first ordering ──────────────────────────────────────────

check('reorders "{Theme} {Format}" to "{Format}: {Theme}"', () => {
  assert.equal(applyFormatFirstOrdering('Old Kanye Dinner Party'), 'Dinner Party: Old Kanye')
})

check('prefers the longest matching format ("Bottomless Brunch" over "Brunch")', () => {
  assert.equal(applyFormatFirstOrdering('Sunday Bottomless Brunch'), 'Bottomless Brunch: Sunday')
})

check('leaves a bare format (no theme) unchanged', () => {
  assert.equal(applyFormatFirstOrdering('Dinner Party'), 'Dinner Party')
})

check('leaves a title with no known format unchanged', () => {
  assert.equal(applyFormatFirstOrdering('Freaknik Reunion'), 'Freaknik Reunion')
})

check('leaves a title unchanged when the format also appears inside the theme', () => {
  assert.equal(applyFormatFirstOrdering('Dinner Party Vol 2 Dinner Party'), 'Dinner Party Vol 2 Dinner Party')
})

// ── combined (venue-strip runs before format-first ordering) ──────

check('combined: strips venue, then applies format-first ordering', () => {
  assert.equal(
    postProcessGeneratedTitle('Old Kanye Dinner Party at Midtown Social', 'Midtown Social'),
    'Dinner Party: Old Kanye'
  )
})

check('combined: pass-through title is untouched end to end', () => {
  assert.equal(postProcessGeneratedTitle('Freaknik Reunion', 'Bamboo Atlanta'), 'Freaknik Reunion')
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
