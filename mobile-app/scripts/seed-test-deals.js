// ─────────────────────────────────────────────────────────────────────
// Wugi — seed-test-deals.js   (firebase-admin → wugi-prod)   ⚠️ DEV ONLY
//
// Seeds a handful of TEST deals into the top-level `deals` collection so
// every consumer surface (Home, Venue, Discover, For You) and search can be
// exercised end-to-end. These are NOT launch data.
//
// Every doc is marked isTest:true + note:'…' and uses a deterministic
// `test-deal-*` id, so they are trivially purgeable and never mistaken for
// real deals. VALUES ARE PLACEHOLDER — replace venueId / venueName / times /
// offers with Jarrod's confirmed info (and flip isTest off / re-id) before
// these ever count as real.
//
// Requires (same pattern as scripts/seedAtlanta.js / seedTestTickets.js):
//   - npm i firebase-admin
//   - service account key at: scripts/serviceAccount.json
//   - (optional) scripts/.env
//
// Run (seed):   node scripts/seed-test-deals.js
// Run (PURGE):  node scripts/seed-test-deals.js --purge
//   Purge deletes the deterministic test-deal-* ids below AND sweeps any
//   deals where isTest == true.
//
// Schema mirrors src/types/firestore-v2.ts → DealV2. Defaults are written
// explicitly (status:'active', isFeatured, isActive, requiresPurchase:false)
// so a deal never silently drops from a feed (the events isFeatured/createdAt
// lesson). Consumer queries do NOT hard-filter on status; eligibility +
// "active now" are computed client-side in src/utils/deals.ts.
// ─────────────────────────────────────────────────────────────────────
try { require('dotenv').config({ path: __dirname + '/.env' }); } catch (_) { /* .env optional */ }

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'wugi-prod',
});

const db = admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();
const img = (seed) => `https://picsum.photos/seed/${seed}/800/600`;

// daysOfWeek: 0=Sun .. 6=Sat. Times are "HH:MM" 24h. A window where
// endTime < startTime crosses midnight (nightlife).
const TEST_DEALS = [
  {
    id: 'test-deal-teranga-happyhour',
    venueId: 'teranga-city-brookhaven',          // PLACEHOLDER — match real venue doc id
    venueName: 'Teranga City Brookhaven',         // PLACEHOLDER
    title: 'Happy Hour',
    description: 'Discounted food + drink specials during happy hour. (Placeholder copy — confirm with venue.)',
    detail: 'Half-off small plates + $7 cocktails',  // PLACEHOLDER offer
    dealType: 'happyHour',
    image: img('teranga-happyhour'),
    daysOfWeek: [2, 3, 4, 5, 6, 0],               // Tue–Sun (PLACEHOLDER)
    startTime: '16:00',                            // afternoon–evening (PLACEHOLDER)
    endTime: '20:00',
    vibes: ['Boujee', 'Late Night'],
    status: 'active',
    isFeatured: true,                             // featured-first ordering testable
    isActive: true,
    requiresPurchase: false,
  },
  {
    id: 'test-deal-afrodistrict-luckyhour',
    venueId: 'afro-district',                      // PLACEHOLDER — match real venue doc id
    venueName: 'Afro District',                    // PLACEHOLDER
    title: 'Lucky Hour',                           // their branded term
    description: 'Afro District’s branded happy-hour window. (Placeholder copy — confirm with venue.)',
    detail: '$5 beers + $8 signature pours',       // PLACEHOLDER offer
    dealType: 'luckyHour',
    image: img('afrodistrict-luckyhour'),
    daysOfWeek: [4, 5, 6],                         // Thu–Sat (PLACEHOLDER)
    startTime: '17:00',
    endTime: '21:00',
    vibes: ['High Energy', 'Late Night'],
    status: 'active',
    isFeatured: false,
    isActive: true,
    requiresPurchase: false,
  },
  {
    id: 'test-deal-flash-rooftop',
    venueId: 'teranga-city-brookhaven',           // PLACEHOLDER
    venueName: 'Teranga City Brookhaven',          // PLACEHOLDER
    title: 'Flash: Rooftop Bottle Special',
    description: 'One-night flash special so flash timing renders. (Placeholder.)',
    detail: 'Tonight only — $50 off bottles',
    dealType: 'flash',
    image: img('flash-rooftop'),
    date: 'FRI JUN 19',                           // PLACEHOLDER single date (yearless display string)
    startTime: '21:00',
    endTime: '02:00',                             // crosses midnight
    vibes: ['Rooftop', 'Boujee'],
    status: 'active',
    isFeatured: false,
    isActive: true,
    requiresPurchase: false,
  },
];

async function seed() {
  console.log('\n💰 Seeding ' + TEST_DEALS.length + ' TEST deals → deals (wugi-prod)…\n');
  const seededIds = [];
  for (const deal of TEST_DEALS) {
    const { id, ...data } = deal;
    await db.collection('deals').doc(id).set({
      ...data,
      isTest: true,
      note: 'DEV TEST DEAL — placeholder, replace with confirmed info. Purge: node scripts/seed-test-deals.js --purge',
      createdAt: ts(),
      updatedAt: ts(),
    }, { merge: true });
    seededIds.push(id);
    console.log('  ✅ ' + deal.title + '  (' + id + ')');
  }
  console.log('\nSeeded doc ids:\n  ' + seededIds.join('\n  '));
  console.log('\n🧹 Purge command:\n  node scripts/seed-test-deals.js --purge\n');
}

async function purge() {
  console.log('\n🧹 Purging TEST deals from deals (wugi-prod)…\n');
  let deleted = 0;
  // 1. Deterministic ids (safe even if the isTest sweep finds nothing).
  for (const deal of TEST_DEALS) {
    await db.collection('deals').doc(deal.id).delete();
    console.log('  🗑️  ' + deal.id);
    deleted++;
  }
  // 2. Sweep any other docs explicitly flagged isTest:true.
  const snap = await db.collection('deals').where('isTest', '==', true).get();
  for (const doc of snap.docs) {
    await doc.ref.delete();
    console.log('  🗑️  ' + doc.id + ' (isTest sweep)');
    deleted++;
  }
  console.log('\nDeleted ' + deleted + ' test deal doc(s).\n');
}

const run = process.argv.includes('--purge') ? purge : seed;
run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('seed-test-deals failed:', e); process.exit(1); });
