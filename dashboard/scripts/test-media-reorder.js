#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — SelectedMediaStrip drag/drop reorder test (issue #183)
//
// Plain-Node smoke test, same on-the-fly-transpile convention as
// test-media-selection.js (no test framework in this repo).
//
//   node scripts/test-media-reorder.js
//
// SelectedMediaStrip's HTML5 drag/drop (dragstart captures the source
// index, drop calls onMove(dragIndex, targetIndex)) and its arrow-button
// touch fallback both bottom out in the same pure reorderSelectedMedia(list,
// from, to) from lib/mediaSelection.ts — reorderSelectedMedia already has
// one check in test-media-selection.js; this file exercises the specific
// index-arithmetic edge cases a free-form drag (as opposed to a single-step
// arrow click) can produce: dragging across multiple positions in one drop,
// dragging into the hero slot, boundary clamps, and no-op drops.
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

const { reorderSelectedMedia } = require(path.join(ROOT, 'lib', 'mediaSelection.ts'))

const tests = []
function check(label, fn) {
  tests.push({ label, fn })
}

function media(id) {
  return { uri: `https://storage.googleapis.com/x/${id}.jpg`, type: 'image', path: id }
}

// ── dragging forward across multiple tiles in one drop ─────────────────

check('dragging the hero to the end shifts everything else up by one', () => {
  const items = [media('a'), media('b'), media('c'), media('d')]
  const moved = reorderSelectedMedia(items, 0, 3)
  assert.deepEqual(moved.map((m) => m.path), ['b', 'c', 'd', 'a'])
})

// ── dragging backward across multiple tiles — into the hero slot ───────

check('dragging the last tile onto the hero slot makes it the new hero', () => {
  const items = [media('a'), media('b'), media('c'), media('d')]
  const moved = reorderSelectedMedia(items, 3, 0)
  assert.deepEqual(moved.map((m) => m.path), ['d', 'a', 'b', 'c'])
  assert.equal(moved[0].path, 'd', 'index 0 is the hero — this is the only way to change it besides removing earlier items')
})

// ── adjacent single-step drag (same result as one arrow-button click) ──

check('an adjacent drag matches the arrow-button single-step move', () => {
  const items = [media('a'), media('b'), media('c')]
  assert.deepEqual(reorderSelectedMedia(items, 1, 2).map((m) => m.path), ['a', 'c', 'b'])
  assert.deepEqual(reorderSelectedMedia(items, 1, 0).map((m) => m.path), ['b', 'a', 'c'])
})

// ── dropping a tile on itself is a no-op ────────────────────────────────

check('dropping a tile back on its own slot leaves the order untouched', () => {
  const items = [media('a'), media('b'), media('c')]
  const moved = reorderSelectedMedia(items, 1, 1)
  assert.deepEqual(moved.map((m) => m.path), ['a', 'b', 'c'])
})

// ── out-of-range drop targets are clamped to a no-op ────────────────────
// (SelectedMediaStrip's arrow buttons already disable at the boundaries, but
// a drop event has no such guard — dragover fires for any tile in the strip)

check('a negative or overflowing target index is rejected, not clamped', () => {
  const items = [media('a'), media('b'), media('c')]
  assert.deepEqual(reorderSelectedMedia(items, 0, -1).map((m) => m.path), ['a', 'b', 'c'])
  assert.deepEqual(reorderSelectedMedia(items, 0, 3).map((m) => m.path), ['a', 'b', 'c'])
})

// ── source and input arrays are never mutated ───────────────────────────

check('reordering never mutates the input array or its items', () => {
  const a = media('a')
  const items = [a, media('b'), media('c')]
  const snapshot = items.slice()
  reorderSelectedMedia(items, 0, 2)
  assert.deepEqual(items, snapshot, 'input array reference is untouched')
  assert.equal(items[0], a, 'item objects are not cloned or replaced in the source array')
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
