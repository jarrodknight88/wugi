// ─────────────────────────────────────────────────────────────────────
// Wugi — seed-featured.ts   (firebase-admin → wugi-prod)
//
// Sets the editorial featured flags consumed by HomeScreen's featured slot:
//   • events: eventFeatured = true
//   • venues: venueFeatured = true
//
// HomeScreen prefers these flags, then falls back to the legacy isFeatured,
// then to soonest / first-N — so Home is NEVER empty regardless of flags.
//
// Picks (verified against wugi-prod, all approved docs):
//   Events — the Teranga FIFA opener + two recurring anchors.
//   Venues — Teranga + two other approved venues.
//
// Run:  npx tsx scripts/seed-featured.ts
// Idempotent: merge:true sets the single flag without touching other fields;
// re-running is a no-op beyond a touch of updatedAt.
// ─────────────────────────────────────────────────────────────────────
import admin from 'firebase-admin';
import serviceAccount from './serviceAccount.json';

admin.initializeApp({ credential: admin.credential.cert(serviceAccount as admin.ServiceAccount) });
const db = admin.firestore();

// Approved + series-anchor events (verified present in prod).
const FEATURED_EVENT_IDS = [
  'fifa-world-cup-opening-watch-party-teranga',
  'friday-happy-hour-teranga-2026-05-29',
  'friday-night-vibes-teranga-2026-05-29',
];

// Approved venues (verified present in prod).
const FEATURED_VENUE_IDS = [
  'teranga-city-brookhaven',
  'gp_ChIJ07TVp0ME9YgRmzH4SKordbc', // STK Steakhouse
  'gp_ChIJ1Q3ZVn8E9YgRxZ015hv_l-w', // Tabernacle
];

async function setFlag(coll: string, ids: string[], field: string): Promise<number> {
  let count = 0;
  for (const id of ids) {
    const ref = db.collection(coll).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.warn(`   ! ${coll}/${id} not found — skipping`);
      continue;
    }
    await ref.set(
      { [field]: true, updatedAt: admin.firestore.Timestamp.now() },
      { merge: true }
    );
    console.log(`   ✓ ${coll}/${id}  →  ${field}=true  ("${snap.data()?.title ?? snap.data()?.name ?? id}")`);
    count++;
  }
  return count;
}

async function main() {
  console.log('Setting eventFeatured on events…');
  const eventCount = await setFlag('events', FEATURED_EVENT_IDS, 'eventFeatured');
  console.log('Setting venueFeatured on venues…');
  const venueCount = await setFlag('venues', FEATURED_VENUE_IDS, 'venueFeatured');

  console.log(`\n✓ eventFeatured set on ${eventCount}/${FEATURED_EVENT_IDS.length} events`);
  console.log(`✓ venueFeatured set on ${venueCount}/${FEATURED_VENUE_IDS.length} venues`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
