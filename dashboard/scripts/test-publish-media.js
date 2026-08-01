#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// Wugi — publishMedia.ts test
//
// Plain-Node smoke test (no test framework in this repo — see
// functions/scripts/test-intel-media.js for the same convention there).
// dashboard/ has no tsc-to-lib/ build step (Next.js compiles via its own
// bundler), so this compiles the two .ts files it needs on the fly with
// the TypeScript compiler API (already a devDependency) and resolves the
// repo's "@/..." path alias by hand — a hand-rolled equivalent of what
// Next.js's webpack config does at bundle time.
//
//   node scripts/test-publish-media.js
//
// Exercises materializePublishedMedia against an in-memory fake bucket
// (PublishMediaBucket) — no real Storage/network involved, same
// dependency-injection split as intelMedia.ts's IntelMediaBucket.
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

const { materializePublishedMedia } = require(path.join(ROOT, 'lib', 'publishMedia.ts'))
const { STORAGE_BUCKET } = require(path.join(ROOT, 'lib', 'firebase-admin.ts'))

const tests = []
function check(label, fn) {
  tests.push({ label, fn })
}

// ── Fake bucket ─────────────────────────────────────────────────────

class FakeFile {
  constructor(store, filePath, copyCounts) {
    this.store = store
    this.filePath = filePath
    this.copyCounts = copyCounts
  }
  async exists() {
    return [this.store.has(this.filePath)]
  }
  async getMetadata() {
    const obj = this.store.get(this.filePath)
    if (!obj) throw new Error(`FakeFile: no object at ${this.filePath}`)
    return [{ contentType: obj.contentType, metadata: obj.metadata }]
  }
  async copy(destination, options) {
    this.copyCounts.set(this.filePath, (this.copyCounts.get(this.filePath) || 0) + 1)
    const src = this.store.get(this.filePath)
    if (!src) throw new Error(`FakeFile: copy source missing at ${this.filePath}`)
    destination.store.set(destination.filePath, {
      contentType: options.contentType ?? src.contentType,
      metadata: options.metadata ?? {},
    })
  }
}

class FakeBucket {
  constructor() {
    this.store = new Map()
    this.copyCounts = new Map()
  }
  file(filePath) {
    return new FakeFile(this.store, filePath, this.copyCounts)
  }
  seed(filePath, obj) {
    this.store.set(filePath, obj)
  }
  copyCountFor(filePath) {
    return this.copyCounts.get(filePath) || 0
  }
}

function signedIntelMediaUrl(objectPath) {
  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/')
  return `https://storage.googleapis.com/${STORAGE_BUCKET}/${encodedPath}?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=svc%40wugi-prod.iam.gserviceaccount.com&X-Goog-Date=20260731T220000Z&X-Goog-Expires=3600&X-Goog-SignedHeaders=host&X-Goog-Signature=deadbeef`
}

// ── (a) signed intel-media URL is copied + rewritten ──────────────────

check('copies and rewrites a signed intel-media URL', async () => {
  const bucket = new FakeBucket()
  bucket.seed('intel-media/doc1/0.jpg', { contentType: 'image/jpeg', metadata: {} })

  const [out] = await materializePublishedMedia(
    [{ uri: signedIntelMediaUrl('intel-media/doc1/0.jpg'), type: 'image' }],
    bucket
  )

  assert.match(out.uri, /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\//)
  assert.match(out.uri, new RegExp(`o\\/${encodeURIComponent('published-media/doc1/0.jpg')}\\?alt=media&token=`))
  assert.equal(out.type, 'image')

  const destMeta = bucket.store.get('published-media/doc1/0.jpg')
  assert.ok(destMeta, 'destination object should exist')
  assert.equal(destMeta.contentType, 'image/jpeg')
  assert.ok(destMeta.metadata.firebaseStorageDownloadTokens, 'destination should carry a download token')
})

// ── (b) stable URL passes through byte-identical ──────────────────────

check('passes a stable (non-signed) URL through unchanged', async () => {
  const bucket = new FakeBucket()
  const stableUri = 'https://picsum.photos/seed/wugi42/800/600'

  const [out] = await materializePublishedMedia([{ uri: stableUri, type: 'image' }], bucket)

  assert.equal(out.uri, stableUri)
  assert.equal(out.type, 'image')
  assert.equal(bucket.store.size, 0, 'no storage object should have been touched')
})

// Also make sure a signed URL over some OTHER prefix (not intel-media/) is
// left alone — only the deny-all intel-media/** prefix is copy-on-publish.
check('passes a signed URL outside intel-media/ through unchanged', async () => {
  const bucket = new FakeBucket()
  const venuesSignedUri = `https://storage.googleapis.com/${STORAGE_BUCKET}/venues%2Fvenue1%2Fhero.jpg?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=3600&X-Goog-Signature=deadbeef`

  const [out] = await materializePublishedMedia([{ uri: venuesSignedUri, type: 'image' }], bucket)

  assert.equal(out.uri, venuesSignedUri)
  assert.equal(bucket.store.size, 0)
})

// ── (c) idempotent — second call reuses the same url, no re-copy ──────

check('second call with the same source is idempotent (same url, no re-copy)', async () => {
  const bucket = new FakeBucket()
  bucket.seed('intel-media/doc2/0.jpg', { contentType: 'image/jpeg', metadata: {} })
  const uri = signedIntelMediaUrl('intel-media/doc2/0.jpg')

  const [first] = await materializePublishedMedia([{ uri, type: 'image' }], bucket)
  const [second] = await materializePublishedMedia([{ uri, type: 'image' }], bucket)

  assert.equal(second.uri, first.uri)
  assert.equal(bucket.copyCountFor('intel-media/doc2/0.jpg'), 1, 'source should only be copied once')
})

// ── (d) per-asset failure degrades gracefully ──────────────────────────

check('a failed copy leaves the original uri and does not throw', async () => {
  const bucket = new FakeBucket()
  // Deliberately NOT seeded — source object "missing" simulates a copy
  // failure (expired/garbage-collected staged asset).
  const missingUri = signedIntelMediaUrl('intel-media/doc3/0.jpg')
  bucket.seed('intel-media/doc4/0.jpg', { contentType: 'image/jpeg', metadata: {} })
  const okUri = signedIntelMediaUrl('intel-media/doc4/0.jpg')

  const results = await materializePublishedMedia(
    [
      { uri: missingUri, type: 'image' },
      { uri: okUri, type: 'image' },
    ],
    bucket
  )

  assert.equal(results[0].uri, missingUri, 'failed copy keeps the original uri')
  assert.notEqual(results[1].uri, okUri, 'the other item in the batch still materializes')
})

// ── video: poster is copied alongside the primary asset ───────────────

check('copies a video asset and its poster', async () => {
  const bucket = new FakeBucket()
  bucket.seed('intel-media/doc5/video0.mp4', { contentType: 'video/mp4', metadata: {} })
  bucket.seed('intel-media/doc5/0.jpg', { contentType: 'image/jpeg', metadata: {} })

  const [out] = await materializePublishedMedia(
    [{ uri: signedIntelMediaUrl('intel-media/doc5/video0.mp4'), type: 'video' }],
    bucket
  )

  assert.equal(out.type, 'video')
  assert.ok(bucket.store.has('published-media/doc5/video0.mp4'))
  assert.ok(bucket.store.has('published-media/doc5/0.jpg'), 'poster should be copied alongside the video')
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
