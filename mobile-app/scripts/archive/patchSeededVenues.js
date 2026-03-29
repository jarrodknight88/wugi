/**
 * Wugi — patchSeededVenues.js
 *
 * One-time script that patches manually seeded venues with:
 *   - googlePlaceId  (enables refresh mode)
 *   - neighborhoodSlug (enables neighborhood filter)
 *   - neighborhood
 *   - confidence score
 *   - hours, parking (from Google Places)
 *
 * Safe to re-run — skips venues that already have a googlePlaceId.
 *
 * Usage:
 *   cd ~/Documents/GitHub/wugi/mobile-app/scripts
 *   node patchSeededVenues.js
 */

require('dotenv').config({ path: __dirname + '/.env' });
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'wugi-prod',
});

const db   = admin.firestore();
const GKEY = process.env.GOOGLE_PLACES_API_KEY;

if (!GKEY) {
  console.error('❌ GOOGLE_PLACES_API_KEY not found in scripts/.env');
  process.exit(1);
}

// ── Venue lookup table ────────────────────────────────────────────────
// Maps Firestore doc ID → search query + neighborhood
// Search queries are precise to find the right venue
const VENUE_PATCHES = [
  {
    docId:            'nite-owl',
    searchQuery:      'Nite Owl Kitchen Cocktails Avondale Estates Atlanta',
    neighborhood:     'East Atlanta Village',
    neighborhoodSlug: 'east-atlanta-village',
  },
  {
    docId:            'skylounge-atl',
    searchQuery:      'SkyLounge ATL Peachtree Road Atlanta',
    neighborhood:     'Buckhead',
    neighborhoodSlug: 'buckhead',
  },
  {
    docId:            'tongue-groove',
    searchQuery:      'Tongue and Groove nightclub Atlanta',
    neighborhood:     'Buckhead',
    neighborhoodSlug: 'buckhead',
  },
  {
    docId:            'stats-brewpub',
    searchQuery:      'Stats Brewpub Marietta Street Atlanta',
    neighborhood:     'Downtown',
    neighborhoodSlug: 'downtown',
  },
  {
    docId:            'ivy-buckhead',
    searchQuery:      'Ivy Buckhead cocktail bar Atlanta',
    neighborhood:     'Buckhead',
    neighborhoodSlug: 'buckhead',
  },
  {
    docId:            'opera-atlanta',
    searchQuery:      'Opera Atlanta nightclub Crescent Avenue',
    neighborhood:     'Midtown',
    neighborhoodSlug: 'midtown',
  },
  {
    docId:            'ponce-city-market',
    searchQuery:      'Ponce City Market Atlanta',
    neighborhood:     'Old Fourth Ward',
    neighborhoodSlug: 'old-fourth-ward',
  },
  {
    docId:            'elleven45-lounge',
    searchQuery:      'Elleven45 Lounge Atlanta Crescent Avenue',
    neighborhood:     'Midtown',
    neighborhoodSlug: 'midtown',
  },
  {
    docId:            'clermont-lounge',
    searchQuery:      'Clermont Lounge Atlanta Ponce de Leon',
    neighborhood:     'Midtown',
    neighborhoodSlug: 'midtown',
  },
  {
    docId:            'st-regis-bar',
    searchQuery:      'St Regis Atlanta bar Buckhead',
    neighborhood:     'Buckhead',
    neighborhoodSlug: 'buckhead',
  },
  {
    docId:            'darwin-cocktails',
    searchQuery:      "Darwin's on Spring Atlanta cocktail bar",
    neighborhood:     'Downtown',
    neighborhoodSlug: 'downtown',
  },
  {
    docId:            'teranga-city',
    searchQuery:      'Teranga City Atlanta restaurant',
    neighborhood:     'Downtown',
    neighborhoodSlug: 'downtown',
  },
  {
    docId:            'revel-atl',
    searchQuery:      'Revel entertainment venue Buford Georgia Atlanta',
    neighborhood:     'Sandy Springs',
    neighborhoodSlug: 'sandy-springs',
  },
  {
    docId:            'vision-atl',
    searchQuery:      'Vision nightclub Atlanta Chamblee Tucker',
    neighborhood:     'Buckhead',
    neighborhoodSlug: 'buckhead',
  },
  {
    docId:            'gold-room-atl',
    searchQuery:      'Gold Room Atlanta nightclub Piedmont Road',
    neighborhood:     'Buckhead',
    neighborhoodSlug: 'buckhead',
  },
  {
    docId:            'v12-atl',
    searchQuery:      'V12 lounge Atlanta Peachtree Street',
    neighborhood:     'Midtown',
    neighborhoodSlug: 'midtown',
  },
  {
    docId:            'sovereign-sweets',
    searchQuery:      'Sovereign Sweets Atlanta dessert bar',
    neighborhood:     'Old Fourth Ward',
    neighborhoodSlug: 'old-fourth-ward',
  },
];

// ── Google Places Text Search ─────────────────────────────────────────
async function searchPlace(query) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GKEY,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.nationalPhoneNumber',
        'places.websiteUri',
        'places.rating',
        'places.priceLevel',
        'places.currentOpeningHours',
        'places.regularOpeningHours',
        'places.photos',
        'places.businessStatus',
        'places.parkingOptions',
        'places.location',
      ].join(','),
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: {
        circle: {
          center: { latitude: 33.749, longitude: -84.388 },
          radius: 50000, // 50km — wide net for initial lookup
        },
      },
      maxResultCount: 3, // Only need the top match
    }),
  });

  if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.places?.[0] || null;
}

function getPhotoUrl(photoName) {
  return `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=800&maxWidthPx=800&key=${GKEY}&skipHttpRedirect=false`;
}

function mapPriceLevel(level) {
  return ['', '$', '$$', '$$$', '$$$$'][level] || '$$';
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('🔧 Wugi — Patch Seeded Venues\n');
  console.log('Adds googlePlaceId, neighborhoodSlug, hours, parking to manually seeded venues.\n');

  const { default: fetch } = await import('node-fetch');
  global.fetch = fetch;

  let patched   = 0;
  let skipped   = 0;
  let notFound  = 0;
  let errors    = 0;

  for (const patch of VENUE_PATCHES) {
    process.stdout.write(`  ${patch.docId}... `);

    try {
      // Check if already patched
      const doc = await db.collection('venues').doc(patch.docId).get();
      if (!doc.exists) {
        console.log('⚠️  doc not found in Firestore');
        notFound++;
        continue;
      }

      const existing = doc.data();
      if (existing.googlePlaceId) {
        console.log(`✓ already has Place ID (${existing.googlePlaceId.slice(0, 20)}...)`);
        skipped++;
        continue;
      }

      // Search Google Places
      const place = await searchPlace(patch.searchQuery);

      if (!place) {
        console.log('❌ not found on Google Places');
        notFound++;
        await new Promise(r => setTimeout(r, 300));
        continue;
      }

      // Build patch payload — only add missing fields, don't overwrite existing data
      const hours   = place.currentOpeningHours?.weekdayDescriptions
                    || place.regularOpeningHours?.weekdayDescriptions
                    || [];
      const parking = place.parkingOptions ? {
        freeParking:   place.parkingOptions.freeParkingLot    ?? false,
        paidParking:   place.parkingOptions.paidParkingLot    ?? false,
        valetParking:  place.parkingOptions.valetParking      ?? false,
        streetParking: place.parkingOptions.freeStreetParking ?? false,
        garageParking: (place.parkingOptions.freeGarageParking || place.parkingOptions.paidGarageParking) ?? false,
      } : {};

      const photos = (place.photos || []).slice(0, 5).map(p => getPhotoUrl(p.name));

      const payload = {
        googlePlaceId:    place.id,
        neighborhood:     patch.neighborhood,
        neighborhoodSlug: patch.neighborhoodSlug,
        updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
      };

      // Only update fields if not already set by hand
      if (!existing.phone    && place.nationalPhoneNumber) payload.phone    = place.nationalPhoneNumber;
      if (!existing.website  && place.websiteUri)          payload.website  = place.websiteUri;
      if (!existing.rating   && place.rating)              payload.rating   = place.rating;
      if (!existing.hours    || existing.hours.length === 0) payload.hours  = hours;
      if (!existing.parking  || Object.keys(existing.parking || {}).length === 0) payload.parking = parking;
      if (!existing.priceLevel && place.priceLevel)        payload.priceLevel = mapPriceLevel(place.priceLevel);

      // Only add Google photos if venue doesn't already have real photos
      const currentMedia = existing.media || [];
      const hasMockMedia = currentMedia.every(m => m.includes('picsum'));
      if (hasMockMedia && photos.length > 0)               payload.media    = photos;

      // Location
      if (place.location) {
        payload.location = {
          latitude:  place.location.latitude  || 0,
          longitude: place.location.longitude || 0,
        };
      }

      // Hours visibility
      if (payload.hours === undefined) {} // don't add hoursVisible if hours weren't updated
      else payload.hoursVisible = true;

      if (!existing.specialHours) payload.specialHours = [];

      await db.collection('venues').doc(patch.docId).update(payload);
      patched++;

      const icons = [
        hours.length > 0 ? '🕐' : '',
        Object.values(parking).some(v => v) ? '🅿️' : '',
        photos.length > 0 && hasMockMedia ? '📸' : '',
      ].filter(Boolean).join('');

      console.log(`✅ patched ${icons} → ${place.displayName?.text} (${place.id.slice(0, 15)}...)`);

      // Rate limit
      await new Promise(r => setTimeout(r, 400));

    } catch (e) {
      console.log(`❌ error: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n${'─'.repeat(55)}`);
  console.log('🔧 Patch complete:');
  console.log(`   ✅ ${patched} venues patched`);
  console.log(`   ✓  ${skipped} already had Place ID (skipped)`);
  console.log(`   ❌ ${notFound} not found on Google Places`);
  console.log(`   ❌ ${errors} errors`);
  console.log('\nNow run: node importPlaces.js --refresh');
  console.log('to pull full data for all patched venues.');
  process.exit(0);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
