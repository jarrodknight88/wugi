// ─────────────────────────────────────────────────────────────────────
// Wugi — seed-neighborhood-guides.ts   (firebase-admin → wugi-prod)
//
// Seeds placeholder docs into the TOP-LEVEL `neighborhoodGuides` collection
// — curated sets of real venues in one neighborhood, rendered as an editorial
// shelf on the (new) default Discover screen.
//
// ARCHITECTURE NOTE (for future Dashboard/Lens build sessions):
//   `neighborhoodGuides` is a TOP-LEVEL collection serving as the single
//   source of truth — queryable independently of any venue path.
//     • Wugi Dashboard is the authoritative management surface (CRUD +
//       curation / ordering / publish).
//     • Wugi Lens may push features through the Dashboard as the engine.
//     • The consumer app is READ-ONLY against this collection.
//   These docs are written with source:'seed' and are INTENTIONALLY
//   replaceable placeholders. Each guide references REAL venue IDs (pulled
//   live from the `venues` collection) so card taps deep-link correctly.
//
// REAL-DATA-ONLY: the kit's "9 spots within 12 minutes of each other"
// subtitle is DROPPED — walking-time needs geo/distance data we don't have.
// Subtitle is the honest "{N} spots in {neighborhood}".
//
// Run:  npx tsx scripts/seed-neighborhood-guides.ts
// Idempotent: deterministic doc ids + merge, so re-running updates in place.
// ─────────────────────────────────────────────────────────────────────
import admin from 'firebase-admin';
import serviceAccount from './serviceAccount.json';

admin.initializeApp({ credential: admin.credential.cert(serviceAccount as admin.ServiceAccount) });
const db = admin.firestore();

const VENUE_TAG_COLOR = '#5ba8c4';                 // dusk cyan (venue chips)
const ALLOWED_STATUS = new Set(['approved', 'unclaimed', 'pending_review']);
const MAX_SPOTS = 5;

const GUIDES = [
  { id: 'o4w-night',       neighborhood: 'Old Fourth Ward', title: 'A night in Old Fourth Ward', order: 1 },
  { id: 'buckhead-night',  neighborhood: 'Buckhead',        title: 'A night in Buckhead',        order: 4 },
];

function firstImage(v: FirebaseFirestore.DocumentData): string {
  for (const m of (v.media || [])) {
    if (typeof m === 'string') return m;
    if (m && typeof m.uri === 'string') return m.uri;
  }
  return '';
}

function venueSub(v: FirebaseFirestore.DocumentData): string {
  const cat = v.category || 'Venue';
  return v.rating ? `${cat} · ★ ${v.rating}` : cat;
}

// Keep curated guides on-brand — exclude adult/strip venues.
const EXCLUDE = /strip club|gentlemen|adult|xxx|nude/i;
function isTasteful(v: FirebaseFirestore.DocumentData): boolean {
  return !EXCLUDE.test(`${v.name || ''} ${v.category || ''}`);
}

async function pickVenues(neighborhood: string) {
  const snap = await db.collection('venues').where('neighborhood', '==', neighborhood).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as FirebaseFirestore.DocumentData & { id: string }))
    .filter(v => ALLOWED_STATUS.has(v.status) && !!firstImage(v) && isTasteful(v))
    .slice(0, MAX_SPOTS);
}

async function main() {
  const batch = db.batch();
  let total = 0;

  for (const g of GUIDES) {
    const venues = await pickVenues(g.neighborhood);
    if (venues.length === 0) {
      console.warn(`! No imaged venues found for ${g.neighborhood} — skipping ${g.id}`);
      continue;
    }
    const cards = venues.map(v => ({
      kind: 'venue', venueId: v.id,
      title: v.name, sub: venueSub(v), image: firstImage(v),
      tag: 'VENUE', tagColor: VENUE_TAG_COLOR,
    }));

    batch.set(db.collection('neighborhoodGuides').doc(g.id), {
      id: g.id,
      kicker: 'NEIGHBORHOOD GUIDE',
      title: g.title,
      subtitle: `${venues.length} spots in ${g.neighborhood}`,
      neighborhood: g.neighborhood,
      coverImage: cards[0].image,
      venueIds: venues.map(v => v.id),
      cards,
      order: g.order,
      status: 'live',
      source: 'seed',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`  ${g.id}: "${g.title}" → ${venues.length} real venues (${venues.map(v => v.name).join(', ')})`);
    total++;
  }

  await batch.commit();
  console.log(`\n✓ Seeded ${total} neighborhood guides`);

  const check = await db.collection('neighborhoodGuides').where('status', '==', 'live').get();
  console.log(`✓ neighborhoodGuides where status==live: ${check.size}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
