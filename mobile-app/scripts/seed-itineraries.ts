// ─────────────────────────────────────────────────────────────────────
// Wugi — seed-itineraries.ts   (firebase-admin → wugi-prod)
//
// Seeds placeholder docs into the TOP-LEVEL `itineraries` collection —
// multi-stop routes (a curated ordered crawl through one neighborhood),
// rendered as an editorial shelf on the (new) default Discover screen.
//
// ARCHITECTURE NOTE (for future Dashboard/Lens build sessions):
//   `itineraries` is a TOP-LEVEL collection serving as the single source of
//   truth — queryable independently of any venue path.
//     • Wugi Dashboard is the authoritative management surface (CRUD +
//       stop ordering / publish).
//     • Wugi Lens may push features through the Dashboard as the engine.
//     • The consumer app is READ-ONLY against this collection.
//   These docs are written with source:'seed' and are INTENTIONALLY
//   replaceable placeholders. Each stop references a REAL venue ID (pulled
//   live from the `venues` collection) so stop taps deep-link correctly.
//
// REAL-DATA-ONLY: stop ORDER + labels are editorial curation (fine to seed).
// Precise clock times / "within X minutes" transit are DROPPED — they imply
// geo/scheduling data we don't have. A neutral "{N} stops" subtitle is used.
//
// Run:  npx tsx scripts/seed-itineraries.ts
// Idempotent: deterministic doc ids + merge, so re-running updates in place.
// ─────────────────────────────────────────────────────────────────────
import admin from 'firebase-admin';
import serviceAccount from './serviceAccount.json';

admin.initializeApp({ credential: admin.credential.cert(serviceAccount as admin.ServiceAccount) });
const db = admin.firestore();

const ITIN_HERO_COLOR = '#5fa080';                 // sage green (itinerary)
const STOP_COLORS = ['#d49a6a', '#5ba8c4', '#5fa080', '#95a5a6'];   // rotate per stop
const ALLOWED_STATUS = new Set(['approved', 'unclaimed', 'pending_review']);
const STOPS = 4;

const ITINERARIES = [
  { id: 'decatur-saturday', neighborhood: 'Decatur', title: 'Saturday in Decatur',  order: 3 },
  { id: 'midtown-night',    neighborhood: 'Midtown', title: 'A Midtown night out',  order: 5 },
];

function firstImage(v: FirebaseFirestore.DocumentData): string {
  for (const m of (v.media || [])) {
    if (typeof m === 'string') return m;
    if (m && typeof m.uri === 'string') return m.uri;
  }
  return '';
}

// Keep curated routes on-brand — exclude adult/strip venues.
const EXCLUDE = /strip club|gentlemen|adult|xxx|nude/i;
function isTasteful(v: FirebaseFirestore.DocumentData): boolean {
  return !EXCLUDE.test(`${v.name || ''} ${v.category || ''}`);
}

async function pickVenues(neighborhood: string) {
  const snap = await db.collection('venues').where('neighborhood', '==', neighborhood).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as FirebaseFirestore.DocumentData & { id: string }))
    .filter(v => ALLOWED_STATUS.has(v.status) && !!firstImage(v) && isTasteful(v))
    .slice(0, STOPS);
}

async function main() {
  const batch = db.batch();
  let total = 0;

  for (const it of ITINERARIES) {
    const venues = await pickVenues(it.neighborhood);
    if (venues.length === 0) {
      console.warn(`! No imaged venues found for ${it.neighborhood} — skipping ${it.id}`);
      continue;
    }

    // Hero summary card (non-navigating — there is no route-detail screen).
    const heroCard = {
      kind: 'itinerary',
      title: it.title,
      sub: `${venues.length} stops · ${it.neighborhood}`,
      image: firstImage(venues[0]),
      tag: 'ITINERARY', tagColor: ITIN_HERO_COLOR, ratio: 2,
    };
    // Stop cards — each deep-links to its real venue.
    const stopCards = venues.map((v, i) => ({
      kind: 'stop', venueId: v.id,
      title: v.name, sub: v.category || 'Venue', image: firstImage(v),
      tag: `STOP ${i + 1}`, tagColor: STOP_COLORS[i % STOP_COLORS.length],
    }));

    batch.set(db.collection('itineraries').doc(it.id), {
      id: it.id,
      kicker: 'WEEKEND ITINERARY',
      title: it.title,
      subtitle: `A curated route · ${venues.length} stops`,
      neighborhood: it.neighborhood,
      coverImage: heroCard.image,
      cards: [heroCard, ...stopCards],
      order: it.order,
      status: 'live',
      source: 'seed',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`  ${it.id}: "${it.title}" → ${venues.length} stops (${venues.map(v => v.name).join(' → ')})`);
    total++;
  }

  await batch.commit();
  console.log(`\n✓ Seeded ${total} itineraries`);

  const check = await db.collection('itineraries').where('status', '==', 'live').get();
  console.log(`✓ itineraries where status==live: ${check.size}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
