/**
 * Populate teranga-fifa-watch-party.images — Build #76.
 *
 * The FIFA gallery resolves but has images:[] (renders nothing). This copies
 * 6–8 existing placeholder image URLs from a POPULATED Teranga gallery into
 * teranga-fifa-watch-party.images so the EventScreen photo strip renders.
 *
 * DATA-DRIVEN: the source gallery is chosen at runtime (the Teranga gallery with
 * the most images, excluding the FIFA gallery itself). No URLs are hardcoded.
 * Writes ONLY the `images` field (coverImage and everything else untouched).
 *
 * DRY RUN by default — prints the intended write and makes ZERO writes.
 * Pass --execute to actually write.
 *
 *   node scripts/seed-fifa-gallery-images.js            # dry run
 *   node scripts/seed-fifa-gallery-images.js --execute  # write
 */
const admin = require('firebase-admin');
const sa = require('./serviceAccount.json');

admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db = admin.firestore();

const DRY_RUN = !process.argv.includes('--execute');
const TARGET_ID = 'teranga-fifa-watch-party';
const VENUE_ID = 'teranga-city-brookhaven';
const COPY_COUNT = 8; // 6–8; take up to 8

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no writes\n' : '🚀 EXECUTE — writing images\n');

  const target = await db.collection('galleries').doc(TARGET_ID).get();
  if (!target.exists) { console.log(`❌ ${TARGET_ID} missing — abort`); process.exit(1); }
  const existing = Array.isArray(target.data().images) ? target.data().images.filter(Boolean) : [];
  console.log(`Target ${TARGET_ID}: current images.length = ${existing.length}`);

  // Choose the most-populated Teranga gallery (excluding the target) as source.
  const snap = await db.collection('galleries').where('venueId', '==', VENUE_ID).get();
  const candidates = snap.docs
    .filter(d => d.id !== TARGET_ID)
    .map(d => ({ id: d.id, images: (d.data().images || []).filter(Boolean) }))
    .filter(c => c.images.length > 0)
    .sort((a, b) => b.images.length - a.images.length);

  if (candidates.length === 0) { console.log('❌ no populated Teranga source gallery — abort'); process.exit(1); }
  const source = candidates[0];
  const images = source.images.slice(0, COPY_COUNT);

  console.log(`Source gallery   : ${source.id} (${source.images.length} images)`);
  console.log(`Copying ${images.length} URLs → ${TARGET_ID}.images`);
  images.forEach((u, i) => console.log(`  [${i}] ${u}`));
  console.log(`\nWOULD WRITE galleries/${TARGET_ID}: { images: <${images.length} urls> }  (coverImage & other fields untouched)`);

  if (!DRY_RUN) {
    await db.collection('galleries').doc(TARGET_ID).update({ images });
    console.log('✅ written');
  }
  console.log(DRY_RUN ? '\nDRY RUN complete — 0 writes.' : '\nDone.');
  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
