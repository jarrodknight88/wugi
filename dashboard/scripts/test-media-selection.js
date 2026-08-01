#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — mediaSelection.ts test
//
// Plain-Node smoke test, same on-the-fly-transpile convention as
// test-publish-media.js and test-draft-title.js (no test framework in this
// repo).
//
//   node scripts/test-media-selection.js
//
// Exercises the path-keyed selection/dedupe fix (issue #171 Bug 1):
// DraftEventsPanel used to key selection by the picker option's `url`, but
// staged mediaAssets get a fresh 60-minute v4 signature on every fetch — the
// same underlying asset shows up with a DIFFERENT url across refetches.
// mediaOptionKey/selectedMediaKey/toggleSelectedMedia now key on `path` when
// present (falling back to `url`/`uri` for stable external URLs, which have
// no path), so a re-signed option is still recognized as "the same item".
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
  mediaOptionKey,
  selectedMediaKey,
  toggleSelectedMedia,
  reorderSelectedMedia,
} = require(path.join(ROOT, 'lib', 'mediaSelection.ts'))

const tests = []
function check(label, fn) {
  tests.push({ label, fn })
}

function signedOpt(assetPath, sig) {
  return {
    url: `https://storage.googleapis.com/wugi-prod.firebasestorage.app/${assetPath}?X-Goog-Signature=${sig}`,
    thumbUrl: `https://storage.googleapis.com/wugi-prod.firebasestorage.app/${assetPath}?X-Goog-Signature=${sig}`,
    type: 'image',
    rightsStatus: 'unverified',
    path: assetPath,
  }
}

// ── (a) same path, different signature => same item ───────────────────

check('two fetches of the same staged asset (different signed url) are the same key', () => {
  const first = signedOpt('intel-media/doc1/0.jpg', 'aaa')
  const second = signedOpt('intel-media/doc1/0.jpg', 'zzz')

  assert.notEqual(first.url, second.url, 'sanity: the signed urls actually differ')
  assert.equal(mediaOptionKey(first), mediaOptionKey(second), 'same path => same key regardless of signature')
})

// ── (b) selecting, then re-toggling after a refetch, deselects it ──────

check('toggling the same asset after a signature refresh deselects it (no duplicate)', () => {
  const stale = signedOpt('intel-media/doc2/0.jpg', 'aaa')
  const refreshed = signedOpt('intel-media/doc2/0.jpg', 'bbb')

  const selected = toggleSelectedMedia([], stale)
  assert.equal(selected.length, 1)
  assert.equal(selected[0].path, 'intel-media/doc2/0.jpg')

  // Simulates a venue-assets refetch minting a new signature for the same
  // underlying object, then the user clicking the (now differently-signed)
  // thumb again — pre-#171 this appended a duplicate keyed by the new url.
  const afterSecondClick = toggleSelectedMedia(selected, refreshed)
  assert.equal(afterSecondClick.length, 0, 'clicking the same asset again removes it, not duplicates it')
})

// ── (c) previously-saved media re-shows as selected after reload ───────

check('a persisted item with only a path (no matching live url) still matches a freshly-signed option', () => {
  // Mirrors CurrentMediaItem after publish: the persisted uri is the
  // permanent published-media/** copy (never matches a freshly-signed
  // staged option's url), but `path` — the original intel-media/** source —
  // survived the round trip (see publish/route.ts's withPath()).
  const persisted = { uri: 'https://firebasestorage.googleapis.com/v0/b/x/o/published-media%2Fdoc3%2F0.jpg?alt=media&token=t', type: 'image', path: 'intel-media/doc3/0.jpg' }
  const freshlySignedOption = signedOpt('intel-media/doc3/0.jpg', 'ccc')

  assert.notEqual(persisted.uri, freshlySignedOption.url)
  assert.equal(selectedMediaKey(persisted), mediaOptionKey(freshlySignedOption), 'path survives the publish round trip and re-matches')
})

// ── (d) stable (non-staged) URLs still dedupe correctly with no path ───

check('a stable url with no path falls back to url-keyed dedupe', () => {
  const heroOpt = { url: 'https://storage.googleapis.com/x/venues/venue1/hero.jpg', thumbUrl: '', type: 'image' }
  const selected = toggleSelectedMedia([], heroOpt)
  assert.equal(selected.length, 1)
  assert.equal(selected[0].path, undefined)
  const afterSecondClick = toggleSelectedMedia(selected, heroOpt)
  assert.equal(afterSecondClick.length, 0)
})

// ── (e) unverified rights still gate on confirm ─────────────────────────

check('an unverified asset is only added when confirmUnverified() returns true', () => {
  const opt = signedOpt('intel-media/doc4/0.jpg', 'aaa')
  const declined = toggleSelectedMedia([], opt, () => false)
  assert.equal(declined.length, 0, 'declined confirm — not added')

  const accepted = toggleSelectedMedia([], opt, () => true)
  assert.equal(accepted.length, 1, 'accepted confirm — added')
})

// ── (f) reorder is a pure index move, independent of keys ──────────────

check('reorderSelectedMedia moves an item to a new index without touching others', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const moved = reorderSelectedMedia(items, 0, 2)
  assert.deepEqual(moved.map((i) => i.id), ['b', 'c', 'a'])
  assert.deepEqual(items.map((i) => i.id), ['a', 'b', 'c'], 'input array is not mutated')
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
