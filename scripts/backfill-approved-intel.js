#!/usr/bin/env node
/**
 * Wugi — Backfill approved venueIntel posts through the transform routing
 *
 * Runs the exact same routing as the onVenueIntelApproved Cloud Function
 * (functions/src/intel/eventTransformRouting.ts, compiled to
 * functions/lib/) over every venueIntel/{id} doc where status == 'approved'
 * and transform.processedAt is missing — i.e. posts that were approved
 * before the trigger existed, or that the trigger never got to run for.
 * Build the functions package first:
 *
 *   (cd functions && npm run build)
 *
 * --dry-run is the DEFAULT: prints the intended outcome for every doc,
 * writes nothing. Pass --execute to actually write draftEvents /
 * nightObservations / needs_classification + the transform marker — same
 * idempotency guard as the trigger (transform.processedAt), so re-running
 * this script (or the trigger later re-firing) is always safe.
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS, scripts/serviceAccount.json,
 * or mobile-app/scripts/serviceAccount.json (SessionStart hook location).
 *
 * Usage:
 *   node scripts/backfill-approved-intel.js              # dry run (default)
 *   node scripts/backfill-approved-intel.js --dry-run     # same, explicit
 *   node scripts/backfill-approved-intel.js --execute      # writes to Firestore
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');

const ROOT = path.resolve(__dirname, '..');
const TIMEZONE = 'America/New_York';

const { buildVenueIndex, normalizeText } = require(
  path.join(ROOT, 'functions', 'lib', 'intel', 'eventTransformCore.js')
);
const { classifyIntelPost } = require(
  path.join(ROOT, 'functions', 'lib', 'intel', 'eventTransformRouting.js')
);

const EXECUTE = process.argv.includes('--execute');
const DRY_RUN = !EXECUTE;
console.log(DRY_RUN ? 'DRY RUN — no Firestore writes (pass --execute to write)\n' : 'EXECUTE MODE — writing to Firestore\n');

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

function todayISOInTimeZone(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function draftEventDocId(venueId, dateISO, normalizedTitle) {
  return crypto.createHash('sha256').update(`${venueId}|${dateISO}|${normalizedTitle}`).digest('hex').slice(0, 32);
}

async function main() {
  const sa = loadCredentials();
  admin.initializeApp({ ...(sa ? { credential: admin.credential.cert(sa) } : {}), projectId: 'wugi-prod' });
  const db = admin.firestore();

  console.log('Loading venues + venueIntelAccounts + pending approved intel...');
  const [venuesSnap, accountsSnap, intelSnap] = await Promise.all([
    db.collection('venues').select('name', 'aliases', 'instagram').get(),
    db.collection('venueIntelAccounts').get(),
    db.collection('venueIntel').where('status', '==', 'approved').get(),
  ]);

  const venues = venuesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const venueIndex = buildVenueIndex(venues);
  const accountTypeByHandle = new Map(accountsSnap.docs.map((d) => [d.id, d.data().accountType]));
  const todayISO = todayISOInTimeZone(TIMEZONE);

  const pending = intelSnap.docs.filter((d) => !d.data().transform?.processedAt);
  console.log(`Venues:        ${venues.length}`);
  console.log(`Approved:      ${intelSnap.size}`);
  console.log(`Unprocessed:   ${pending.length}\n`);

  const counts = { draft_event: 0, night_observation: 0, needs_classification: 0 };
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (const doc of pending) {
    const after = doc.data();
    const sourceAccount = after.sourceAccount || '';
    const caption = after.caption || '';
    const postedAt = after.postedAt?.toDate?.() ?? null;
    const accountType = accountTypeByHandle.get(sourceAccount);

    const result = classifyIntelPost({ sourceAccount, caption, postedAt, accountType }, venueIndex, todayISO);
    counts[result.outcome] += 1;

    if (result.outcome === 'draft_event') {
      const docId = draftEventDocId(result.venue.id, result.dateISO, normalizeText(result.title));
      console.log(`  [draft_event]         ${doc.id} -> draftEvents/${docId}  "${result.title}" @ ${result.venue.name} (${result.dateISO})`);
      if (EXECUTE) {
        const draftRef = db.collection('draftEvents').doc(docId);
        const existing = await draftRef.get();
        await draftRef.set(
          {
            venueId: result.venue.id,
            venueName: result.venue.name,
            date: admin.firestore.Timestamp.fromDate(new Date(`${result.dateISO}T00:00:00Z`)),
            title: result.title,
            caption,
            likesCount: after.likesCount ?? 0,
            commentsCount: after.commentsCount ?? 0,
            sourceAttribution: { account: sourceAccount, postUrl: after.postUrl || '', seedAccount: after.seedAccount || '' },
            sourceIntelId: doc.id,
            status: 'draft',
            updatedAt: now,
            ...(existing.exists ? {} : { createdAt: now }),
          },
          { merge: true }
        );
        await doc.ref.set({ transform: { processedAt: now, outcome: 'draft_event', refId: docId } }, { merge: true });
      }
    } else if (result.outcome === 'night_observation') {
      console.log(`  [night_observation]   ${doc.id} -> nightObservations/*  @ ${result.venue.name} (${result.dateISO}, day ${result.dayOfWeek})`);
      if (EXECUTE) {
        const obsRef = db.collection('nightObservations').doc();
        await obsRef.set({
          venueId: result.venue.id,
          dayOfWeek: result.dayOfWeek,
          date: admin.firestore.Timestamp.fromDate(new Date(`${result.dateISO}T00:00:00Z`)),
          sourceIntelId: doc.id,
          likesCount: after.likesCount ?? 0,
          commentsCount: after.commentsCount ?? 0,
          sourceAccount,
          createdAt: now,
        });
        await db.collection('venues').doc(result.venue.id).collection('intel').add({
          type: 'recap',
          postUrl: after.postUrl || '',
          caption: caption.slice(0, 300),
          engagement: { likesCount: after.likesCount ?? 0, commentsCount: after.commentsCount ?? 0 },
          at: now,
        });
        await doc.ref.set({ transform: { processedAt: now, outcome: 'night_observation', refId: obsRef.id } }, { merge: true });
      }
    } else {
      console.log(`  [needs_classification] ${doc.id} -> ${result.reason}`);
      if (EXECUTE) {
        await doc.ref.set(
          {
            status: 'needs_classification',
            classificationReason: result.reason,
            transform: { processedAt: now, outcome: 'needs_classification' },
          },
          { merge: true }
        );
      }
    }
  }

  console.log('\n── Summary ─────────────────────────────────────────────');
  console.log(`  draft_event:          ${counts.draft_event}`);
  console.log(`  night_observation:    ${counts.night_observation}`);
  console.log(`  needs_classification: ${counts.needs_classification}`);
  if (DRY_RUN) console.log('\nDry run only — re-run with --execute to write these.');
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
