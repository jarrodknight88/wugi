/**
 * Wugi Venue Migration Script
 * - Deletes test records
 * - Removes duplicate venue docs (keeps richest version)
 * - Adds slug, market, previousSlugs to all approved venues
 *
 * Run: node scripts/migrateVenues.js --dry-run
 * Run: node scripts/migrateVenues.js --execute
 */

const admin = require('firebase-admin');
const sa = require('./serviceAccount.json');

admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db = admin.firestore();

const DRY_RUN = !process.argv.includes('--execute');
console.log(DRY_RUN ? '🔍 DRY RUN — no changes will be made\n' : '🚀 EXECUTE MODE — writing to Firestore\n');

// ── Slug generator ────────────────────────────────────────────────────
function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Docs to delete outright ───────────────────────────────────────────
const DELETE_IDS = [
  'test-venue-1',
  'test-venue-2',
  // old thin seed duplicates — richer gp_ or named doc kept instead
  'venue_niteowl',
  'venue_tonguegroove',
  'venue_ponce',
  'venue_skylounge',
  'venue_stats',
  'venue_ivybuckhead',
];

// ── Duplicate pairs: [keep, delete] ──────────────────────────────────
// For each pair, we keep the first ID and delete the second
const DUPLICATE_PAIRS = [
  // Revel Atlanta — keep named doc, remove gp_ duplicate
  ['revel-atl', 'gp_ChIJc7LA4xoF9YgRrNXbZsbkg18'],
  // St Regis — keep named doc, remove gp_ duplicate
  ['st-regis-bar', 'gp_ChIJAfVQ7o4F9YgRolwTesSpqSE'],
  // Red Phone Booth — two gp_ docs, keep one
  ['gp_ChIJNwyAIM4F9YgR5AaUs0gmrdg', 'gp_ChIJxXZfE3gE9YgR1RyIwQQbJsc'],
  // Tongue & Groove — keep named doc, remove gp_ duplicate
  ['tongue-groove', 'gp_ChIJl4B7SMIF9YgRSufqHZaNuCQ'],
  // Vision Hookah — keep named doc, remove gp_ duplicate
  ['vision-atl', 'gp_ChIJC8eKfMIF9YgR2r5dwzbFNl8'],
];

// ── Fields to strip from all docs (noisy/internal fields) ────────────
const FIELDS_TO_REMOVE = [
  'neighborhoodBounds',  // large geo object, not needed on web
  'instagramInferred',   // internal scraper flag
  'instagramSource',     // internal scraper metadata
  'logoSource',          // internal scraper metadata
  'confidence',          // internal scraper score
  'closedReason',        // only relevant for closed venues
  'closedAt',            // only relevant for closed venues
  'replacedBy',          // only relevant for closed venues
  'previousVenue',       // internal reference
  'previousVenueName',   // internal reference
];


async function main() {
  const snap = await db.collection('venues').get();
  const allDocs = snap.docs;

  const toDelete = new Set([
    ...DELETE_IDS,
    ...DUPLICATE_PAIRS.map(([, del]) => del),
  ]);

  let deleted = 0, updated = 0, skipped = 0;

  for (const docSnap of allDocs) {
    const id = docSnap.id;
    const data = docSnap.data();

    // ── Delete ──────────────────────────────────────────────────────
    if (toDelete.has(id)) {
      console.log(`🗑️  DELETE: ${id} (${data.name})`);
      if (!DRY_RUN) await db.collection('venues').doc(id).delete();
      deleted++;
      continue;
    }

    // ── Skip closed/unclaimed venues (don't add slugs yet) ──────────
    const status = data.status;
    if (!status || status === 'closed') {
      console.log(`⏭️  SKIP (closed/no status): ${id} (${data.name})`);
      skipped++;
      continue;
    }

    // ── Build update payload ─────────────────────────────────────────
    const update = {};

    // Add slug if missing
    if (!data.slug) {
      update.slug = toSlug(data.name || id);
    }

    // Add market if missing
    if (!data.market) {
      update.market = 'atlanta';
    }

    // Add previousSlugs if missing
    if (!data.previousSlugs) {
      update.previousSlugs = [];
    }

    // Strip noisy internal fields
    for (const field of FIELDS_TO_REMOVE) {
      if (field in data) {
        update[field] = admin.firestore.FieldValue.delete();
      }
    }

    if (Object.keys(update).length === 0) {
      console.log(`✅  NO CHANGE: ${id} (${data.name})`);
      skipped++;
      continue;
    }

    const slug = update.slug || data.slug;
    console.log(`✏️  UPDATE: ${id} → slug: "${slug}", market: "atlanta", removed fields: ${FIELDS_TO_REMOVE.filter(f => f in data).join(', ') || 'none'}`);
    if (!DRY_RUN) await db.collection('venues').doc(id).update(update);
    updated++;
  }

  console.log(`\n── Summary ──`);
  console.log(`Deleted:  ${deleted}`);
  console.log(`Updated:  ${updated}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(DRY_RUN ? '\n✅ Dry run complete. Run with --execute to apply changes.' : '\n✅ Migration complete.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
