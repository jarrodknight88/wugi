// ─────────────────────────────────────────────────────────────────────
// Wugi — seed-photos.ts   (firebase-admin → wugi-prod)
//
// Seeds placeholder photo docs into the TOP-LEVEL `photos` collection,
// derived from the existing top-level `galleries` docs.
//
// ARCHITECTURE NOTE (for future Dashboard/Lens build sessions):
//   `galleries` + `photos` are TOP-LEVEL source-of-truth collections.
//     • Wugi Dashboard is the authoritative manager (CRUD + config /
//       moderation) for both collections.
//     • Wugi Lens writes through the Dashboard as the engine — it pushes
//       images / settings into these collections.
//     • The consumer app is READ-ONLY against both.
//   These docs are written with source:'seed' and are INTENTIONALLY
//   replaceable placeholders — the imageUrls are picsum/gallery-image
//   stand-ins meant to be swapped once real Lens photos land.
//
// Money convention: `price` is in CENTS (matches the ticketing convention,
// where ticket amounts are stored in cents).
//
// Run:  npx tsx scripts/seed-photos.ts
// Idempotent: deterministic doc ids (`${galleryId}-p${n}`) + merge, so
// re-running updates in place without creating duplicates.
// ─────────────────────────────────────────────────────────────────────
import admin from 'firebase-admin';
import serviceAccount from './serviceAccount.json';

admin.initializeApp({ credential: admin.credential.cert(serviceAccount as admin.ServiceAccount) });
const db = admin.firestore();

// How many photos to create per gallery (5–7, varied per gallery so the
// placeholder data doesn't look uniform).
const PHOTOS_PER_GALLERY = [7, 6, 5, 6];

// Deterministic pseudo-random in [min, max] from a string seed, so re-runs
// produce identical likes/price values (keeps the seed truly idempotent).
function seededInt(seed: string, min: number, max: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = (h >>> 0) / 0xffffffff; // 0..1
  return min + Math.floor(n * (max - min + 1));
}

async function main() {
  const gallerySnap = await db.collection('galleries').get();
  if (gallerySnap.empty) {
    console.error('No galleries found — run seed-galleries.ts first. Aborting.');
    process.exit(1);
  }

  // Stable order so PHOTOS_PER_GALLERY maps predictably (newest first by createdAt).
  const galleries = gallerySnap.docs
    .map(d => ({ id: d.id, data: d.data() }))
    .sort((a, b) => (b.data.createdAt?.toMillis?.() ?? 0) - (a.data.createdAt?.toMillis?.() ?? 0));

  const batch = db.batch();
  let totalPhotos = 0;

  galleries.forEach((g, gi) => {
    const data = g.data;
    const images: string[] = (data.images || []).filter((m: unknown) => typeof m === 'string');
    const count = PHOTOS_PER_GALLERY[gi % PHOTOS_PER_GALLERY.length];

    for (let n = 1; n <= count; n++) {
      const id = `${g.id}-p${n}`;
      // imageUrl: cycle the gallery's own images when available, else a
      // deterministic picsum seed. Both are swappable placeholders.
      const imageUrl =
        images.length > 0
          ? images[(n - 1) % images.length]
          : `https://picsum.photos/seed/${id}/800/1000`;

      batch.set(db.collection('photos').doc(id), {
        id,
        galleryId: g.id,
        venueId: data.venueId,
        eventId: data.eventId ?? null,
        imageUrl,
        photographerName: data.photographerName ?? null,
        photographerId: data.photographerId ?? null,
        likes: seededInt(`likes-${id}`, 3, 240),
        price: seededInt(`price-${id}`, 500, 1500), // CENTS ($5–$15)
        createdAt: data.createdAt ?? admin.firestore.Timestamp.now(),
        source: 'seed',
      }, { merge: true });
      totalPhotos++;
    }
  });

  await batch.commit();
  console.log(`✓ Seeded ${totalPhotos} photos across ${galleries.length} galleries`);

  // Verify per-gallery counts via the same query shape the consumer app would use.
  for (const g of galleries) {
    const check = await db.collection('photos').where('galleryId', '==', g.id).get();
    console.log(`   - ${g.id}: ${check.size} photos`);
  }
  const all = await db.collection('photos').get();
  console.log(`✓ total photos collection size: ${all.size}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
