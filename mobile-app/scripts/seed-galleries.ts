// ─────────────────────────────────────────────────────────────────────
// Wugi — seed-galleries.ts   (firebase-admin → wugi-prod)
//
// Seeds placeholder gallery docs into the TOP-LEVEL `galleries` collection
// for Teranga City Brookhaven, using the venue's real photo URLs.
//
// ARCHITECTURE NOTE (for future Dashboard/Lens build sessions):
//   `galleries` is a TOP-LEVEL collection serving as the single source of
//   truth — queryable independently of the venue path.
//     • Wugi Dashboard is the authoritative management surface
//       (CRUD + config / moderation).
//     • Wugi Lens pushes images and settings into this collection,
//       conceptually through the Dashboard as the engine.
//     • The consumer app is READ-ONLY against this collection.
//   These docs are written with source:'seed' and are INTENTIONALLY
//   replaceable placeholders — the Dashboard/Lens will own real galleries.
//
// Run:  npx tsx scripts/seed-galleries.ts
// Idempotent: deterministic doc ids + merge, so re-running updates in place.
// ─────────────────────────────────────────────────────────────────────
import admin from 'firebase-admin';
import serviceAccount from './serviceAccount.json';

admin.initializeApp({ credential: admin.credential.cert(serviceAccount as admin.ServiceAccount) });
const db = admin.firestore();

const VENUE_ID = 'teranga-city-brookhaven';

// Recent, plausible past nights (newest first). `date` is the display
// string; `day` drives createdAt so date-desc ordering is stable.
const SEEDS = [
  { key: 'weekend-brunch',       title: 'Weekend Brunch',        date: 'SUN MAY 18', photoCount: 22, day: '2026-05-18' },
  { key: 'saturday-night',       title: 'Saturday Night',        date: 'SAT MAY 17', photoCount: 34, day: '2026-05-17' },
  { key: 'fifa-watch-party',     title: 'FIFA Watch Party',      date: 'SAT MAY 10', photoCount: 41, day: '2026-05-10' },
  { key: 'hookah-lounge-nights', title: 'Hookah Lounge Nights',  date: 'SAT MAY 3',  photoCount: 18, day: '2026-05-03' },
];

async function main() {
  const venueSnap = await db.collection('venues').doc(VENUE_ID).get();
  if (!venueSnap.exists) {
    console.error(`Venue ${VENUE_ID} not found — aborting.`);
    process.exit(1);
  }
  const media: string[] = (venueSnap.data()?.media || []).filter((m: unknown) => typeof m === 'string');
  if (media.length === 0) {
    console.error('Venue has no image URLs to seed galleries from — aborting.');
    process.exit(1);
  }
  const pick = (i: number) => media[i % media.length];

  const batch = db.batch();
  SEEDS.forEach((s, i) => {
    const id = `${VENUE_ID}-${s.key}`;
    batch.set(db.collection('galleries').doc(id), {
      id,
      venueId: VENUE_ID,
      eventId: null,
      title: s.title,
      coverImage: pick(i),
      images: media,                  // placeholder image set = venue's real photos
      photoCount: s.photoCount,
      date: s.date,
      photographerName: '@teranga.bh',
      photographerId: null,
      createdAt: admin.firestore.Timestamp.fromDate(new Date(`${s.day}T20:00:00-04:00`)),
      source: 'seed',
    }, { merge: true });
  });
  await batch.commit();
  console.log(`✓ Seeded ${SEEDS.length} galleries for ${VENUE_ID}`);

  // Verify via the same query the consumer app uses.
  const check = await db.collection('galleries').where('venueId', '==', VENUE_ID).get();
  console.log(`✓ galleries where venueId == ${VENUE_ID}: ${check.size}`);
  check.docs
    .map(d => d.data())
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
    .forEach(g => console.log(`   - "${g.title}" · ${g.photoCount} photos · ${g.date} · source=${g.source}`));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
