#!/usr/bin/env node
// Backfill: convert legacy venues.media string[] entries to typed
// {uri,type,rightsStatus} objects (issue #238 — dashboard/app/api/venues/
// [venueId]/media/route.ts PATCH now writes typed objects going forward,
// mirroring events; this catches docs saved before that fix, where a video
// uri saved as a bare string normalizes to {type:'image'} on read and
// renders blank in the app). Type is inferred from the uri's file extension
// (video: .mp4/.mov/.m4v/.webm, else image) — the same heuristic scraped
// mediaAssets docs use at ingest. rightsStatus defaults to 'wugi_partner'
// (already-published venue media, not a staged/scraped-unverified asset —
// same convention DraftEventsPanel.tsx uses for a venue's existing hero).
// DRY-RUN by default. --apply to write. Backs up each changed doc to
// scripts/backups/ first, same as backfill-published-media.js.
'use strict'

const fs = require('fs')
const admin = require('../functions/node_modules/firebase-admin')
admin.initializeApp({
  credential: admin.credential.cert(require('../mobile-app/scripts/serviceAccount.json')),
  storageBucket: 'wugi-prod.firebasestorage.app',
})
const db = admin.firestore()

const APPLY = process.argv.includes('--apply')
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm']

function inferType(uri) {
  const clean = uri.split('?')[0].split('#')[0].toLowerCase()
  return VIDEO_EXTENSIONS.some((ext) => clean.endsWith(ext)) ? 'video' : 'image'
}

async function main() {
  console.log(APPLY ? '*** APPLY MODE — writing to Firestore ***\n' : '*** DRY RUN (no writes) — pass --apply to write ***\n')

  const snap = await db.collection('venues').get()
  let venuesChanged = 0
  let entriesConverted = 0
  let videosFound = 0

  for (const doc of snap.docs) {
    const data = doc.data()
    const media = Array.isArray(data.media) ? data.media : []
    if (!media.length) continue

    const legacyIndices = []
    const newMedia = media.map((m, i) => {
      if (typeof m !== 'string' || !m) return m
      const type = inferType(m)
      legacyIndices.push(i)
      if (type === 'video') videosFound++
      return { uri: m, type, rightsStatus: 'wugi_partner' }
    })

    if (!legacyIndices.length) continue
    venuesChanged++
    entriesConverted += legacyIndices.length

    const summary = legacyIndices.map((i) => `slot ${i}: ${newMedia[i].type}`).join(', ')
    console.log(`${doc.id} (${data.name || 'unnamed'}): ${legacyIndices.length} legacy string entr${legacyIndices.length === 1 ? 'y' : 'ies'} — ${summary}`)

    if (APPLY) {
      fs.mkdirSync('scripts/backups', { recursive: true })
      fs.writeFileSync(`scripts/backups/venues-${doc.id}-${Date.now()}.json`, JSON.stringify(data, null, 2))
      await doc.ref.update({ media: newMedia })
    }
  }

  console.log('')
  console.log(`${venuesChanged} venue(s) with legacy string media, ${entriesConverted} entries converted (${videosFound} video, ${entriesConverted - videosFound} image).`)
  console.log(APPLY ? 'DONE — writes applied.' : 'DRY RUN complete — no writes. Re-run with --apply to write these.')
  process.exit(0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
