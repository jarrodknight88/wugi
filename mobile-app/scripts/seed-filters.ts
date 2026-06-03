// ─────────────────────────────────────────────────────────────────────
// Wugi — seed-filters.ts   (firebase-admin → wugi-prod)
//
// Seeds the filter-taxonomy docs DiscoverEditorialScreen reads on first
// search-bar tap:
//   • filters/vibes      = { values: [...], updatedAt }
//   • filters/amenities  = { values: [...], updatedAt }
//
// Source of truth:
//   • VIBES — must match scripts/scrape/03-transform-and-write.js VIBES
//     (16 canonical values). Venues in prod already carry the wider set
//     post-scrape, so the old hardcoded 6-value Discover list was
//     silently under-matching (e.g. picking 'Hookah' returned nothing
//     even though many venues carry it). No data migration needed —
//     this only widens the filter SHEET's options.
//   • AMENITIES — union of VenueScreen AMENITY_ICON keys + the prior
//     hardcoded Discover amenities list, deduped. "Outdoor Patio" is
//     replaced by "Patio" so the icon map matches (VenueScreen's
//     AMENITY_ICON keys 'Patio', not 'Outdoor Patio'). 'Brunch',
//     'Happy Hour', 'Pet Friendly' fall through to CIRCLE_FALLBACK in
//     the icon map today; a follow-up batch can add SVG entries.
//
// Rules posture: filters/{name} reads are covered by the firestore.rules
// catch-all (`allow read: if isAuth()`); writes are blocked
// (`allow write: if false`). This script uses firebase-admin which
// bypasses rules — only Jarrod can re-seed.
//
// Run:  npx tsx scripts/seed-filters.ts
// Idempotent: merge:true on each doc; re-running just touches updatedAt.
//
// DO NOT execute as part of an automated workflow — Jarrod runs this
// manually after confirming the canonical label set.
// ─────────────────────────────────────────────────────────────────────
import admin from 'firebase-admin';
import serviceAccount from './serviceAccount.json';

admin.initializeApp({ credential: admin.credential.cert(serviceAccount as admin.ServiceAccount) });
const db = admin.firestore();

// Mirror of scripts/scrape/03-transform-and-write.js VIBES (lines 67-71).
// Keep in sync — that file canonicalizes values written onto venue docs.
const VIBES: string[] = [
  'Boujee', 'Divey', 'Speakeasy', 'High Energy', 'Rooftop', 'Late Night',
  'Chill', 'Dance', 'Live Music', 'Date Night', 'Sports', 'Brunch',
  'Cultural', 'Hookah', 'Lounge', 'Adult',
];

// Union of VenueScreen AMENITY_ICON keys (src/screens/VenueScreen.tsx) +
// the prior Discover hardcoded amenities. 'Patio' chosen over 'Outdoor
// Patio' so the icon map renders the patio glyph.
const AMENITIES: string[] = [
  'Rooftop', 'Bottle Service', 'Dress Code', 'Open Late', 'Reservations',
  'Patio', 'Live Music', 'Hookah', 'Brunch', 'Happy Hour', 'Pet Friendly',
];

async function seedDoc(id: 'vibes' | 'amenities', values: string[]): Promise<void> {
  const ref = db.collection('filters').doc(id);
  await ref.set(
    { values, updatedAt: admin.firestore.Timestamp.now() },
    { merge: true }
  );
  console.log(`   ✓ filters/${id}  →  ${values.length} values`);
}

async function main() {
  console.log('Seeding filters/vibes…');
  await seedDoc('vibes', VIBES);
  console.log('Seeding filters/amenities…');
  await seedDoc('amenities', AMENITIES);
  console.log('\n✓ Filter taxonomies seeded');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
