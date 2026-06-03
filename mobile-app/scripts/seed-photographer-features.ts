// ─────────────────────────────────────────────────────────────────────
// Wugi — seed-photographer-features.ts   (firebase-admin → wugi-prod)
//
// Seeds placeholder docs into the TOP-LEVEL `photographerFeatures` collection
// — a spotlight on one Wugi Lens photographer's recent galleries, rendered as
// an editorial shelf on the (new) default Discover screen.
//
// ARCHITECTURE NOTE (for future Dashboard/Lens build sessions):
//   `photographerFeatures` is a TOP-LEVEL collection serving as the single
//   source of truth — queryable independently of any gallery path.
//     • Wugi Dashboard is the authoritative management surface (CRUD +
//       feature curation / publish).
//     • Wugi Lens supplies the galleries/photos this features; it writes
//       through the Dashboard as the engine.
//     • The consumer app is READ-ONLY against this collection.
//   These docs are written with source:'seed' and are INTENTIONALLY
//   replaceable placeholders. Each feature references REAL gallery IDs
//   (pulled live from the `galleries` collection) so card taps deep-link.
//
// REAL-DATA-ONLY: gallery count + total photos are computed from the REAL
// referenced galleries. The kit's "180+ photos from the past month" framing
// and follower counts are DROPPED — those need time-window aggregation /
// social-graph data we don't have.
//
// Run:  npx tsx scripts/seed-photographer-features.ts
// Idempotent: deterministic doc ids + merge, so re-running updates in place.
// ─────────────────────────────────────────────────────────────────────
import admin from 'firebase-admin';
import serviceAccount from './serviceAccount.json';

admin.initializeApp({ credential: admin.credential.cert(serviceAccount as admin.ServiceAccount) });
const db = admin.firestore();

const GALLERY_TAG_COLOR = '#9b59b6';               // plum (galleries / photos)

// Photographers to feature. galleries are matched live by photographerName.
const FEATURES = [
  { id: 'teranga-bh-atlanta', handle: '@teranga.bh', title: "@teranga.bh's Atlanta", order: 2 },
];

async function main() {
  const batch = db.batch();
  let total = 0;

  const gsnap = await db.collection('galleries').get();
  const allGalleries = gsnap.docs.map(d => ({ id: d.id, ...d.data() } as FirebaseFirestore.DocumentData & { id: string }));

  // Pre-load all referenced venues so we can denormalize venue NAME onto each
  // gallery-kind card. The card sits inside a TOP-LEVEL editorial doc that
  // never re-joins on read, so the consumer app can render three lines
  // (venue / date / title — matching the PhotoViewer overlay) without a
  // per-card lookup at render time. Item 4.1.
  const referencedVenueIds = Array.from(new Set(allGalleries.map(g => g.venueId).filter(Boolean)));
  const venueNameById: Record<string, string> = {};
  await Promise.all(referencedVenueIds.map(async (vid: string) => {
    try {
      const vsnap = await db.collection('venues').doc(vid).get();
      if (vsnap.exists) {
        const vname = (vsnap.data() as any)?.name;
        if (typeof vname === 'string' && vname.length > 0) venueNameById[vid] = vname;
      }
    } catch (e) {
      console.warn(`  ! venue lookup failed for ${vid}:`, (e as Error).message);
    }
  }));

  for (const f of FEATURES) {
    const galleries = allGalleries
      .filter(g => g.photographerName === f.handle && !!g.coverImage)
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

    if (galleries.length === 0) {
      console.warn(`! No galleries found for ${f.handle} — skipping ${f.id}`);
      continue;
    }

    const totalPhotos = galleries.reduce((n, g) => n + (g.photoCount || 0), 0);
    const cards = galleries.map(g => {
      const vname = g.venueId ? venueNameById[g.venueId] : '';
      // sub is kept as the legacy "N photos" line for back-compat with any
      // older clients that haven't shipped the 3-line card render yet; new
      // clients prefer venueName + date.
      return {
        kind: 'gallery', galleryId: g.id,
        venueId: g.venueId || '',
        venueName: vname || '',
        date: g.date || '',
        title: g.title, sub: `${g.photoCount || 0} photos`, image: g.coverImage,
        tag: 'GALLERY', tagColor: GALLERY_TAG_COLOR,
      };
    });

    batch.set(db.collection('photographerFeatures').doc(f.id), {
      id: f.id,
      kicker: 'PHOTOGRAPHER FEATURE',
      photographerHandle: f.handle,
      title: f.title,
      subtitle: `${galleries.length} galleries · ${totalPhotos} photos`,
      coverImage: cards[0].image,
      galleryIds: galleries.map(g => g.id),
      cards,
      order: f.order,
      status: 'live',
      source: 'seed',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`  ${f.id}: "${f.title}" → ${galleries.length} galleries · ${totalPhotos} photos`);
    total++;
  }

  await batch.commit();
  console.log(`\n✓ Seeded ${total} photographer features`);

  const check = await db.collection('photographerFeatures').where('status', '==', 'live').get();
  console.log(`✓ photographerFeatures where status==live: ${check.size}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
