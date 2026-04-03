#!/usr/bin/env node
/**
 * Wugi — add-venue-coordinates.js
 *
 * One-time script to add latitude/longitude to venue docs in Firestore.
 * Required for the check-in app geofence to work.
 *
 * Run from monorepo root:
 *   node scripts/add-venue-coordinates.js
 */

const admin = require('firebase-admin');
const serviceAccount = require(require('path').join(__dirname, '../firebase/service-account.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'wugi-prod',
});

const db = admin.firestore();

// Atlanta venue coordinates
const venueCoordinates = {
  venue_niteowl:      { latitude: 33.7756, longitude: -84.2760 },
  venue_skylounge:    { latitude: 33.8488, longitude: -84.3651 },
  venue_tonguegroove: { latitude: 33.7996, longitude: -84.3652 },
  venue_stats:        { latitude: 33.7588, longitude: -84.3879 },
  venue_ivy:          { latitude: 33.8476, longitude: -84.3627 },
  venue_opera:        { latitude: 33.7715, longitude: -84.3864 },
  venue_ponce:        { latitude: 33.7721, longitude: -84.3659 },
  venue_elleven45:    { latitude: 33.7550, longitude: -84.3900 },
  venue_clermont:     { latitude: 33.7731, longitude: -84.3581 },
  venue_roofstregis:  { latitude: 33.8354, longitude: -84.3799 },
  venue_darwins:      { latitude: 33.7648, longitude: -84.3895 },
  venue_whiskeybird:  { latitude: 33.7703, longitude: -84.3493 },
  venue_herbanfix:    { latitude: 33.7568, longitude: -84.3851 },
  venue_mbar:         { latitude: 33.7707, longitude: -84.3857 },
  venue_agebar:       { latitude: 33.8488, longitude: -84.3640 },
};

async function main() {
  console.log('\n📍 Adding coordinates to venue docs...\n');

  const batch = db.batch();
  let count = 0;

  for (const [venueId, coords] of Object.entries(venueCoordinates)) {
    const ref = db.collection('venues').doc(venueId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`  ⚠️  Skipping ${venueId} — doc not found`);
      continue;
    }
    batch.update(ref, {
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
    console.log(`  ✅ ${snap.data().name} → (${coords.latitude}, ${coords.longitude})`);
    count++;
  }

  await batch.commit();
  console.log(`\n🎉 Updated ${count} venues with coordinates.\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
