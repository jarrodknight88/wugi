#!/usr/bin/env node
/**
 * Wugi — Backfill scraped media for existing venueIntel posts
 *
 * Media persistence (issue #141) only downloads a post's mediaUrls to
 * Storage on NEW ingest going forward (see functions/src/bridge/
 * apifyWebhook.ts). This script runs the exact same download+store logic
 * (functions/src/intel/intelMedia.ts, compiled to functions/lib/) over the
 * existing venueIntel backlog — every doc that predates this feature.
 * Build the functions package first:
 *
 *   (cd functions && npm run build)
 *
 * --dry-run is the DEFAULT: for every venueIntel doc without an existing
 * mediaAssets/{docId}, prints how many image URLs would be downloaded
 * (via the same pure selectCandidateMediaUrls cap/filter apifyWebhook
 * uses) — no network fetch, no Storage writes, no Firestore writes.
 *
 * --execute actually downloads and writes: Storage objects at
 * intel-media/{docId}/{index}.jpg + a mediaAssets/{docId} doc, identical
 * shape to what apifyWebhook produces for new scrapes.
 *
 * Idempotent by docId: a venueIntel doc whose mediaAssets/{docId} already
 * exists is skipped entirely (both modes), so re-running this script (for
 * docs that failed, or after a fresh scrape adds more) never re-downloads
 * or duplicates work.
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS, scripts/serviceAccount.json,
 * or mobile-app/scripts/serviceAccount.json (SessionStart hook location).
 *
 * Usage:
 *   node scripts/backfill-intel-media.js                # dry run (default)
 *   node scripts/backfill-intel-media.js --dry-run        # same, explicit
 *   node scripts/backfill-intel-media.js --execute         # downloads + writes
 */
'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const ROOT = path.resolve(__dirname, '..');

const {
  selectCandidateMediaUrls,
  downloadAndStoreIntelMedia,
  buildMediaAssetDoc,
} = require(path.join(ROOT, 'functions', 'lib', 'intel', 'intelMedia.js'));

const EXECUTE = process.argv.includes('--execute');
const DRY_RUN = !EXECUTE;
console.log(DRY_RUN ? 'DRY RUN — no downloads or writes (pass --execute to write)\n' : 'EXECUTE MODE — downloading media and writing to Storage/Firestore\n');

function loadCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return null; // ADC
  const candidates = [
    path.join(__dirname, 'serviceAccount.json'),
    path.join(ROOT, 'mobile-app', 'scripts', 'serviceAccount.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return require(p);
  }
  console.error('ERR  No serviceAccount.json found (looked in scripts/ and mobile-app/scripts/) and GOOGLE_APPLICATION_CREDENTIALS is unset.');
  process.exit(1);
}

async function main() {
  const sa = loadCredentials();
  admin.initializeApp({
    ...(sa ? { credential: admin.credential.cert(sa) } : {}),
    projectId: 'wugi-prod',
    storageBucket: 'wugi-prod.appspot.com',
  });
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  console.log('Loading venueIntel + existing mediaAssets docs...');
  const [intelSnap, assetsSnap] = await Promise.all([
    db.collection('venueIntel').get(),
    db.collection('mediaAssets').get(),
  ]);
  const alreadyProcessed = new Set(assetsSnap.docs.map((d) => d.id));
  const pending = intelSnap.docs.filter((d) => !alreadyProcessed.has(d.id));

  console.log(`venueIntel docs:        ${intelSnap.size}`);
  console.log(`Already backfilled:     ${alreadyProcessed.size}`);
  console.log(`Pending:                ${pending.length}\n`);

  let attempted = 0;
  let stored = 0;
  let skippedNoMedia = 0;
  let failed = 0;

  for (const doc of pending) {
    const after = doc.data();
    const candidateUrls = selectCandidateMediaUrls(after.mediaUrls);
    if (candidateUrls.length === 0) {
      skippedNoMedia++;
      continue;
    }
    attempted++;

    if (DRY_RUN) {
      console.log(`  [would download] ${doc.id}  ${candidateUrls.length} image(s)`);
      continue;
    }

    try {
      const { storagePaths, failed: perPostFailed } = await downloadAndStoreIntelMedia(bucket, doc.id, candidateUrls);
      if (perPostFailed > 0) {
        console.log(`  [partial]  ${doc.id}  ${storagePaths.length}/${candidateUrls.length} stored (${perPostFailed} failed)`);
      }
      if (storagePaths.length === 0) {
        failed++;
        continue;
      }
      await db
        .collection('mediaAssets')
        .doc(doc.id)
        .set(
          buildMediaAssetDoc(
            {
              venueIntelId: doc.id,
              sourceAccount: after.sourceAccount || '',
              seedAccount: after.seedAccount || '',
              postUrl: after.postUrl || '',
              storagePaths,
            },
            admin.firestore.FieldValue.serverTimestamp()
          )
        );
      stored++;
      console.log(`  [stored]   ${doc.id}  ${storagePaths.length} image(s)`);
    } catch (err) {
      failed++;
      console.error(`  [FAILED]   ${doc.id}  ${String(err)}`);
    }
  }

  console.log('\n── Summary ─────────────────────────────────────────────');
  console.log(`  Pending docs with media to process: ${attempted}`);
  console.log(`  Pending docs with no image media:   ${skippedNoMedia}`);
  if (!DRY_RUN) {
    console.log(`  mediaAssets docs written:            ${stored}`);
    console.log(`  Failed (no image stored):            ${failed}`);
  }
  if (DRY_RUN) console.log('\nDry run only — re-run with --execute to download and write these.');
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
