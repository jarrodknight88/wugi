#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────
 * Wugi — one-shot cleanup, 2026-05-06
 *
 * Deletes 3 rejected test-debris event docs identified by the
 * --list pass of backfill-missing-fields.js. All three have:
 *   - status: 'rejected'
 *   - venueId: 'placeholder-00X'
 *   - missing core metadata (name, dateISO, scrapedAt)
 *   - same updatedAt timestamp (touched together in some manual run)
 *
 * For each ID:
 *   1. List sub-collections (Firestore doesn't cascade on delete)
 *   2. Delete all docs in each sub-collection
 *   3. Delete the event doc
 *
 * One-shot — do NOT generalize this. Real cleanup belongs in
 * backfill-missing-fields.js with proper flags, not hardcoded IDs.
 * ───────────────────────────────────────────────────────────────────── */
'use strict';

const path = require('path');
const admin = require('firebase-admin');
const sa = require(path.resolve(__dirname, 'serviceAccount.json'));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db = admin.firestore();

const TARGETS = [
  'vz7fn4XY9mv7cXJNMFIL',  // "Friday Night Live" / placeholder-003
  'wEhF43HT74RCQDzVPTuS',  // "ATL Rooftop Sessions" / placeholder-002
  'woR8IBYYfB3JK1McFumc',  // "Ladies Night at Compound" / placeholder-001
];

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function deleteSubCollectionDocs(collRef) {
  // Page through; delete in batches of 500.
  let totalDeleted = 0;
  while (true) {
    const snap = await collRef.limit(500).get();
    if (snap.empty) break;
    if (DRY_RUN) {
      totalDeleted += snap.docs.length;
      if (snap.docs.length < 500) break;
      // Can't actually advance without deleting in dry-run; cap at one page.
      break;
    }
    const batch = db.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    totalDeleted += snap.docs.length;
    if (snap.docs.length < 500) break;
  }
  return totalDeleted;
}

(async function main() {
  console.log(`Junk-event cleanup — wugi-prod — ${new Date().toISOString()}`);
  if (DRY_RUN) console.log(`** DRY RUN — nothing will be deleted **`);
  console.log(`Targets: ${TARGETS.length}`);

  let docsDeleted = 0;
  let subDocsDeleted = 0;

  for (const id of TARGETS) {
    const ref = db.collection('events').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`\n[skip] ${id} — already absent`);
      continue;
    }
    const data = snap.data();
    console.log(`\n[target] ${id}`);
    console.log(`    title:   ${data.title ?? '<missing>'}`);
    console.log(`    status:  ${data.status ?? '<missing>'}`);
    console.log(`    venueId: ${data.venueId ?? '<missing>'}`);

    // Sub-collection sweep
    const subColls = await ref.listCollections();
    if (subColls.length === 0) {
      console.log(`    sub-collections: (none)`);
    } else {
      for (const sc of subColls) {
        const n = await deleteSubCollectionDocs(sc);
        subDocsDeleted += n;
        console.log(`    sub-collection ${sc.id}: ${DRY_RUN ? `would delete ${n} docs` : `deleted ${n} docs`}`);
      }
    }

    // Parent doc delete
    if (DRY_RUN) {
      console.log(`    [dry-run] would delete parent doc`);
    } else {
      await ref.delete();
      docsDeleted += 1;
      console.log(`    ✓ deleted parent doc`);
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`  parent event docs ${DRY_RUN ? 'would-delete' : 'deleted'}: ${DRY_RUN ? TARGETS.length : docsDeleted}`);
  console.log(`  sub-collection docs ${DRY_RUN ? 'would-delete' : 'deleted'}: ${subDocsDeleted}`);

  process.exit(0);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
