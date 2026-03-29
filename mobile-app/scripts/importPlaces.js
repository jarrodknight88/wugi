/**
 * Wugi — Google Places Atlanta Venue Importer v5
 *
 * New in v5:
 *   - --test flag: runs SerpAPI on 5 venues max before full run
 *   - --instagram-only: only looks up Instagram for venues missing it
 *   - --close flag: marks a venue as closed and optionally links replacement
 *   - 'closed' status: distinct from 'disabled' — shows closure banner
 *   - SerpAPI calls prioritized: featured/approved first, website required
 *
 * Usage:
 *   node importPlaces.js --neighborhood="Midtown"         (import new)
 *   node importPlaces.js --all                             (import all)
 *   node importPlaces.js --refresh                         (update existing)
 *   node importPlaces.js --refresh --neighborhood="Midtown"
 *   node importPlaces.js --instagram-only --test           (test 5 venues first)
 *   node importPlaces.js --instagram-only                  (run all missing)
 *   node importPlaces.js --close --docId="opera-atlanta" --replacedBy="gp_xyz"
 *
 * Status model:
 *   pending_review — confidence < 80, needs manual approval
 *   unclaimed      — confidence ≥ 80, live in app with claim CTA
 *   approved       — venue claimed and verified
 *   closed         — permanently closed, shows closure banner, not in discovery
 *   disabled       — hidden completely (duplicates, bad data)
 */

require('dotenv').config({ path: __dirname + '/.env' });
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'wugi-prod',
});

const db      = admin.firestore();
const GKEY    = process.env.GOOGLE_PLACES_API_KEY;
const SERPKEY = process.env.SERP_API_KEY;

if (!GKEY) {
  console.error('❌ GOOGLE_PLACES_API_KEY not found in scripts/.env');
  process.exit(1);
}

if (!SERPKEY) {
  console.log('ℹ️  SERP_API_KEY not set — Instagram lookup disabled');
  console.log('   Get a free key at serpapi.com (100 searches/month)\n');
}

// ── Parse CLI args ────────────────────────────────────────────────────
const args             = process.argv.slice(2);
const neighborhoodArg  = args.find(a => a.startsWith('--neighborhood='))?.split('=')[1];
const docIdArg         = args.find(a => a.startsWith('--docId='))?.split('=')[1];
const replacedByArg    = args.find(a => a.startsWith('--replacedBy='))?.split('=')[1];
const runAll           = args.includes('--all');
const refreshMode      = args.includes('--refresh');
const instagramOnly    = args.includes('--instagram-only');
const closeMode        = args.includes('--close');
const testMode         = args.includes('--test');
const TEST_LIMIT       = 5;

// ── Atlanta Neighborhoods ─────────────────────────────────────────────
const NEIGHBORHOODS = [
  {
    name: 'Midtown', slug: 'midtown',
    bounds: { north: 33.8050, south: 33.7850, east: -84.3650, west: -84.4050 },
    center: { latitude: 33.7950, longitude: -84.3850 },
    searchQueries: ['bars', 'nightclubs', 'lounges', 'rooftop bars', 'cocktail bars', 'restaurants'],
  },
  {
    name: 'Buckhead', slug: 'buckhead',
    bounds: { north: 33.8600, south: 33.8300, east: -84.3500, west: -84.4000 },
    center: { latitude: 33.8450, longitude: -84.3750 },
    searchQueries: ['bars', 'nightclubs', 'lounges', 'upscale restaurants', 'cocktail bars'],
  },
  {
    name: 'Old Fourth Ward', slug: 'old-fourth-ward',
    bounds: { north: 33.7800, south: 33.7550, east: -84.3600, west: -84.3900 },
    center: { latitude: 33.7675, longitude: -84.3750 },
    searchQueries: ['bars', 'nightclubs', 'restaurants', 'cocktail bars', 'lounges'],
  },
  {
    name: 'East Atlanta Village', slug: 'east-atlanta-village',
    bounds: { north: 33.7400, south: 33.7200, east: -84.3300, west: -84.3700 },
    center: { latitude: 33.7300, longitude: -84.3500 },
    searchQueries: ['bars', 'dive bars', 'live music venues', 'restaurants'],
  },
  {
    name: 'Westside', slug: 'westside',
    bounds: { north: 33.7900, south: 33.7600, east: -84.4000, west: -84.4400 },
    center: { latitude: 33.7750, longitude: -84.4200 },
    searchQueries: ['bars', 'restaurants', 'cocktail bars', 'breweries'],
  },
  {
    name: 'Downtown', slug: 'downtown',
    bounds: { north: 33.7700, south: 33.7400, east: -84.3700, west: -84.4100 },
    center: { latitude: 33.7550, longitude: -84.3900 },
    searchQueries: ['bars', 'nightclubs', 'restaurants', 'lounges', 'sports bars'],
  },
  {
    name: 'Inman Park', slug: 'inman-park',
    bounds: { north: 33.7650, south: 33.7450, east: -84.3500, west: -84.3800 },
    center: { latitude: 33.7550, longitude: -84.3650 },
    searchQueries: ['bars', 'restaurants', 'cocktail bars'],
  },
  {
    name: 'Virginia Highland', slug: 'virginia-highland',
    bounds: { north: 33.7900, south: 33.7700, east: -84.3500, west: -84.3800 },
    center: { latitude: 33.7800, longitude: -84.3650 },
    searchQueries: ['bars', 'restaurants', 'cocktail bars', 'wine bars'],
  },
  {
    name: 'Little Five Points', slug: 'little-five-points',
    bounds: { north: 33.7650, south: 33.7500, east: -84.3500, west: -84.3750 },
    center: { latitude: 33.7575, longitude: -84.3625 },
    searchQueries: ['bars', 'dive bars', 'live music', 'restaurants'],
  },
  {
    name: 'Summerhill', slug: 'summerhill',
    bounds: { north: 33.7450, south: 33.7250, east: -84.3700, west: -84.4000 },
    center: { latitude: 33.7350, longitude: -84.3850 },
    searchQueries: ['bars', 'restaurants', 'cocktail bars'],
  },
  {
    name: 'Decatur', slug: 'decatur',
    bounds: { north: 33.7800, south: 33.7600, east: -84.2800, west: -84.3200 },
    center: { latitude: 33.7700, longitude: -84.3000 },
    searchQueries: ['bars', 'restaurants', 'breweries', 'cocktail bars'],
  },
  {
    name: 'Sandy Springs', slug: 'sandy-springs',
    bounds: { north: 33.9400, south: 33.9000, east: -84.3400, west: -84.3900 },
    center: { latitude: 33.9200, longitude: -84.3650 },
    searchQueries: ['bars', 'restaurants', 'lounges', 'nightclubs'],
  },
  {
    name: 'Castleberry Hill', slug: 'castleberry-hill',
    bounds: { north: 33.7500, south: 33.7300, east: -84.3900, west: -84.4200 },
    center: { latitude: 33.7400, longitude: -84.4050 },
    searchQueries: ['bars', 'nightclubs', 'art bars', 'restaurants'],
  },
];

// ── Confidence scoring ────────────────────────────────────────────────
const FIELD_WEIGHTS = {
  name: 20, address: 20, phone: 15, website: 15,
  hours: 10, photos: 10, instagram: 5, parking: 5,
};
const VISIBILITY_THRESHOLD   = 60;
const AUTO_APPROVE_THRESHOLD = 80;

function scoreField(fieldName, value) {
  switch (fieldName) {
    case 'name':      return (!value || value === 'Unknown Venue') ? 0 : 95;
    case 'address':   return !value ? 0 : (value.includes('Atlanta') || value.includes('GA')) ? 95 : 70;
    case 'phone':     return value ? 90 : 0;
    case 'website':   return !value ? 0 : value.startsWith('https://') ? 85 : 70;
    case 'hours':     return (!value || value.length === 0) ? 0 : value.length >= 7 ? 80 : 50;
    case 'photos':    return (!value || value.length === 0) ? 0 : value.length >= 3 ? 75 : 40;
    case 'instagram':
      if (!value) return 0;
      if (value.confidence === 'high')             return 85;
      if (value.confidence === 'medium')           return 65;
      if (value.confidence === 'inferred-high')    return 45;
      if (value.confidence === 'inferred-medium')  return 30;
      return 20;
    case 'parking':
      if (!value || Object.keys(value).length === 0) return 0;
      return Object.values(value).some(v => v === true) ? 60 : 30;
    default: return 0;
  }
}

function calculateConfidence(fields) {
  const sources = {
    name: 'google_places', address: 'google_places', phone: 'google_places',
    website: 'google_places', hours: 'google_places', photos: 'google_places',
    instagram: fields.instagram?.source || 'inferred', parking: 'google_places',
  };
  let weightedSum = 0;
  const breakdown = {};
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const score   = scoreField(field, fields[field]);
    const visible = score >= VISIBILITY_THRESHOLD;
    breakdown[field] = { score, visible, source: sources[field] };
    weightedSum += (score * weight) / 100;
  }
  return { overall: Math.round(weightedSum), breakdown };
}

// ── SerpAPI Instagram lookup ──────────────────────────────────────────
// Strategy: Try multiple targeted queries in order of specificity.
// Query 1: "Venue Name" restaurant OR lounge OR bar ATL instagram
// Query 2: "Venue Name" ATL site:instagram.com (fallback)
// This matches your suggestion: "Nite Owl restaurant logo atl" style
async function lookupInstagramViaSerpAPI(venueName, category = '') {
  if (!SERPKEY) return null;

  // Determine venue type keywords from category or name
  const nameLower = venueName.toLowerCase();
  let typeKeyword = 'restaurant OR lounge OR bar OR nightclub';
  if (nameLower.includes('lounge'))     typeKeyword = 'lounge nightlife Atlanta';
  else if (nameLower.includes('bar'))   typeKeyword = 'bar Atlanta';
  else if (nameLower.includes('kitchen') || nameLower.includes('grill') || nameLower.includes('bistro')) typeKeyword = 'restaurant Atlanta';
  else if (nameLower.includes('club') || nameLower.includes('night')) typeKeyword = 'nightclub Atlanta';
  else if (nameLower.includes('rooftop')) typeKeyword = 'rooftop bar Atlanta';
  else if (category) typeKeyword = `${category} Atlanta`;

  // Two query strategies — try both, use first match
  const queries = [
    // Query 1: venue name + type + city + instagram (most specific)
    `"${venueName}" ${typeKeyword} instagram`,
    // Query 2: classic site: search (fallback)
    `${venueName} Atlanta site:instagram.com`,
  ];

  for (const queryRaw of queries) {
    try {
      const query = encodeURIComponent(queryRaw);
      const url   = `https://serpapi.com/search.json?q=${query}&api_key=${SERPKEY}&num=5&gl=us&hl=en`;
      const res   = await fetch(url);
      if (!res.ok) continue;

      const data    = await res.json();
      const results = data.organic_results || [];

      for (const result of results) {
        const link = result.link || '';
        const match = link.match(/instagram\.com\/([a-zA-Z0-9._]{2,30})\/?$/);
        if (!match) continue;

        const handle = match[1];
        // Skip Instagram UI pages
        if (['p','explore','accounts','stories','reels','tv','reel','direct'].includes(handle)) continue;

        const nameClean   = venueName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const handleClean = handle.toLowerCase().replace(/[^a-z0-9]/g, '');
        const nameFirst   = venueName.toLowerCase().split(' ')[0].replace(/[^a-z]/g, '');

        // Confidence: high if strong name match, medium if partial
        const isHighMatch = handleClean.includes(nameClean) || nameClean.includes(handleClean);
        const isMidMatch  = handleClean.includes(nameFirst) || (nameFirst.length > 3 && handleClean.includes(nameFirst.slice(0, 4)));
        const confidence  = isHighMatch ? 'high' : isMidMatch ? 'medium' : 'medium';

        return { handle: `@${handle}`, confidence, source: 'serpapi', inferred: false };
      }
    } catch (e) {
      console.log(`     ⚠️  SerpAPI error: ${e.message}`);
    }
  }
  return null;
}

// ── Name inference fallback ───────────────────────────────────────────
function inferInstagramFromName(venueName) {
  if (!venueName || venueName === 'Unknown Venue') return null;
  const clean   = venueName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const words   = clean.split(/\s+/).filter(Boolean);
  const noSpace = words.join('');
  const handle  = `@${noSpace}atl`;
  return {
    handle,
    confidence: noSpace.length >= 4 ? 'inferred-high' : 'inferred-medium',
    source: 'inferred',
    inferred: true,
  };
}

async function getInstagram(venueName, category = '') {
  const serpResult = await lookupInstagramViaSerpAPI(venueName, category);
  if (serpResult) return serpResult;
  return inferInstagramFromName(venueName);
}

// ── Helpers ───────────────────────────────────────────────────────────
function mapVibes(types = [], priceLevel = 2, name = '') {
  const vibes = [];
  const t = types.join(' ').toLowerCase();
  const n = name.toLowerCase();
  if (t.includes('night_club'))                                                   vibes.push('High Energy');
  if ((t.includes('bar') || t.includes('lounge')) && priceLevel >= 3)            vibes.push('Boujee');
  if (t.includes('bar') && priceLevel <= 2)                                       vibes.push('Divey');
  if (n.includes('rooftop') || n.includes('sky') || n.includes('roof'))          vibes.push('Rooftop');
  if (n.includes('speakeasy') || n.includes('hidden') || n.includes('secret'))   vibes.push('Speakeasy');
  if (t.includes('restaurant') && priceLevel >= 3)                               vibes.push('Boujee');
  if (n.includes('late') || n.includes('midnight') || n.includes('after'))       vibes.push('Late Night');
  if (vibes.length === 0) vibes.push(t.includes('night_club') ? 'High Energy' : t.includes('bar') ? 'Divey' : 'Boujee');
  return [...new Set(vibes)];
}

function mapCategory(types = [], name = '') {
  const t = types.join(' ').toLowerCase();
  const n = name.toLowerCase();
  if (t.includes('night_club'))                          return 'Nightclub';
  if (n.includes('rooftop') || n.includes('roof'))       return 'Rooftop Bar';
  if (t.includes('bar') && t.includes('restaurant'))     return 'Bar & Kitchen';
  if (t.includes('lounge'))                              return 'Lounge';
  if (t.includes('bar'))                                 return 'Bar';
  if (t.includes('restaurant'))                          return 'Restaurant';
  return 'Bar & Lounge';
}

function mapPriceLevel(level) {
  return ['', '$', '$$', '$$$', '$$$$'][level] || '$$';
}

function getPhotoUrl(photoName) {
  return `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=800&maxWidthPx=800&key=${GKEY}&skipHttpRedirect=false`;
}

// ── Google Places ─────────────────────────────────────────────────────
async function searchPlaces(query, center) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GKEY,
      'X-Goog-FieldMask': [
        'places.id','places.displayName','places.formattedAddress',
        'places.nationalPhoneNumber','places.websiteUri','places.rating',
        'places.priceLevel','places.types','places.location',
        'places.currentOpeningHours','places.regularOpeningHours',
        'places.photos','places.businessStatus','places.parkingOptions',
      ].join(','),
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: { circle: { center, radius: 1500 } },
      maxResultCount: 20,
    }),
  });
  if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getPlaceById(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': GKEY,
      'X-Goog-FieldMask': [
        'id','displayName','formattedAddress','nationalPhoneNumber',
        'websiteUri','rating','priceLevel','types','location',
        'currentOpeningHours','regularOpeningHours',
        'photos','businessStatus','parkingOptions',
      ].join(','),
    },
  });
  if (!res.ok) return null;
  return res.json();
}

// ── Build venue ───────────────────────────────────────────────────────
async function buildVenue(place, neighborhood, skipInstagram = false) {
  const name    = place.displayName?.text || 'Unknown Venue';
  const types   = place.types || [];
  const price   = place.priceLevel || 2;
  const photos  = (place.photos || []).slice(0, 5).map(p => getPhotoUrl(p.name));
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

  const instagramData = skipInstagram ? null : await getInstagram(name);

  const fields     = { name, address: place.formattedAddress, phone: place.nationalPhoneNumber, website: place.websiteUri, hours, photos, instagram: instagramData, parking };
  const confidence = calculateConfidence(fields);
  const status     = confidence.overall >= AUTO_APPROVE_THRESHOLD ? 'unclaimed' : 'pending_review';

  return {
    name,
    category:          mapCategory(types, name),
    address:           place.formattedAddress || '',
    phone:             place.nationalPhoneNumber || '',
    website:           place.websiteUri || '',
    instagram:         instagramData?.handle || '',
    instagramSource:   instagramData?.source || 'inferred',
    instagramInferred: instagramData?.inferred ?? true,
    attributes:        [],
    about:             '',
    media:             photos.length > 0 ? photos : [`https://picsum.photos/seed/${place.id}/800/600`],
    menuDescription:   '',
    location: { latitude: place.location?.latitude || 0, longitude: place.location?.longitude || 0 },
    neighborhood:       neighborhood.name,
    neighborhoodSlug:   neighborhood.slug,
    neighborhoodBounds: neighborhood.bounds,
    hours,
    hoursVisible:  true,
    specialHours:  [],
    parking,
    rating:        place.rating || null,
    priceLevel:    mapPriceLevel(price),
    googlePlaceId: place.id,
    vibes:         mapVibes(types, price, name),
    confidence,
    status,
    isClaimed:     false,
    claimedBy:     null,
    claimedAt:     null,
    isActive:      place.businessStatus === 'OPERATIONAL',
    isFeatured:    false,
    createdAt:     admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
  };
}

// ── CLOSE MODE ────────────────────────────────────────────────────────
async function closeVenue(docId, replacedByDocId) {
  console.log(`\n🔒 Closing venue: ${docId}\n`);

  const doc = await db.collection('venues').doc(docId).get();
  if (!doc.exists) {
    console.error(`❌ Venue "${docId}" not found in Firestore`);
    process.exit(1);
  }

  const venue = doc.data();
  console.log(`   Name: ${venue.name}`);
  console.log(`   Current status: ${venue.status}`);

  const payload = {
    status:           'closed',
    closedAt:         admin.firestore.FieldValue.serverTimestamp(),
    closedReason:     'venue_closed',
    isFeatured:       false,
    isActive:         false,
    updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
  };

  if (replacedByDocId) {
    payload.replacedBy = replacedByDocId;
    console.log(`   Linking replacement: ${replacedByDocId}`);

    // Also write backlink on the replacement venue
    const replacementRef = db.collection('venues').doc(replacedByDocId);
    const replacementDoc = await replacementRef.get();
    if (replacementDoc.exists) {
      await replacementRef.update({
        previousVenue:   docId,
        previousVenueName: venue.name,
        updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`   ✅ Backlink written to replacement venue`);
    } else {
      console.log(`   ⚠️  Replacement venue "${replacedByDocId}" not found — skipping backlink`);
    }
  }

  await db.collection('venues').doc(docId).update(payload);

  console.log(`\n✅ ${venue.name} marked as closed`);
  console.log(`   status: ${venue.status} → closed`);
  if (replacedByDocId) console.log(`   replacedBy: ${replacedByDocId}`);
  console.log('\nIn the app this venue will show a "Permanently Closed" banner');
  console.log('and will not appear in discovery searches.');
}

// ── INSTAGRAM ONLY MODE ───────────────────────────────────────────────
async function runInstagramOnly() {
  console.log(`\n📷 INSTAGRAM-ONLY MODE${testMode ? ' (TEST — max 5 venues)' : ''}\n`);

  if (!SERPKEY) {
    console.error('❌ SERP_API_KEY required for instagram lookup. Add to scripts/.env');
    process.exit(1);
  }

  // Load venues that need Instagram
  // Priority: approved first, then unclaimed with website, then rest
  const snap = await db.collection('venues').get();
  const venues = snap.docs
    .map(d => ({ docId: d.id, ...d.data() }))
    .filter(v => {
      // Skip if already has a confirmed (non-inferred) Instagram
      if (v.instagram && !v.instagramInferred) return false;
      // Skip closed and disabled
      if (['closed', 'disabled'].includes(v.status)) return false;
      return true;
    })
    .sort((a, b) => {
      // Approved first
      if (a.status === 'approved' && b.status !== 'approved') return -1;
      if (b.status === 'approved' && a.status !== 'approved') return 1;
      // Then venues with website (higher signal)
      if (a.website && !b.website) return -1;
      if (b.website && !a.website) return 1;
      return 0;
    });

  const toProcess = testMode ? venues.slice(0, TEST_LIMIT) : venues;

  console.log(`Found ${venues.length} venues needing Instagram`);
  if (testMode) console.log(`Test mode: processing first ${TEST_LIMIT} only\n`);
  else console.log(`Processing all ${toProcess.length} venues\n`);

  if (testMode) {
    console.log('Venues to be tested:');
    toProcess.forEach((v, i) => console.log(`  ${i + 1}. ${v.name} (${v.status})`));
    console.log('');
  }

  let found    = 0;
  let notFound = 0;
  let errors   = 0;
  let serpCalls = 0;

  for (const venue of toProcess) {
    process.stdout.write(`  ${venue.name}... `);

    try {
      serpCalls++;
      const result = await lookupInstagramViaSerpAPI(venue.name, venue.category || '');

      if (result) {
        await db.collection('venues').doc(venue.docId).update({
          instagram:         result.handle,
          instagramSource:   result.source,
          instagramInferred: result.inferred,
          updatedAt:         admin.firestore.FieldValue.serverTimestamp(),
        });
        found++;
        console.log(`✅ ${result.handle} (${result.confidence})`);
      } else {
        notFound++;
        console.log('— not found via SerpAPI');
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      errors++;
      console.log(`❌ ${e.message}`);
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📷 Instagram lookup complete:`);
  console.log(`   ✅ ${found} handles found`);
  console.log(`   — ${notFound} not found`);
  console.log(`   ❌ ${errors} errors`);
  console.log(`   🔢 ${serpCalls} SerpAPI calls used`);
  if (testMode && found + notFound > 0) {
    console.log(`\nTest complete. Run without --test to process all ${venues.length} venues.`);
    console.log(`Estimated SerpAPI calls needed: ${venues.length}`);
  }
}

// ── REFRESH MODE ──────────────────────────────────────────────────────
const OWNER_FIELDS = new Set([
  'instagram', 'about', 'attributes', 'menuDescription',
  'isFeatured', 'isClaimed', 'claimedBy', 'claimedAt',
  'status', 'vibes', 'specialHours', 'hoursVisible',
]);

function diff(existing, updated) {
  const changes = {};
  const checkFields = ['name', 'address', 'phone', 'website', 'hours', 'parking', 'rating', 'isActive', 'media'];
  for (const field of checkFields) {
    const oldVal = JSON.stringify(existing[field] ?? null);
    const newVal = JSON.stringify(updated[field] ?? null);
    if (oldVal !== newVal) changes[field] = { from: existing[field], to: updated[field] };
  }
  if (Object.keys(changes).length > 0) {
    changes.confidence = { from: existing.confidence?.overall, to: updated.confidence?.overall };
    changes.updatedAt  = { from: null, to: 'now' };
  }
  return changes;
}

async function refreshVenues(neighborhoodFilter) {
  console.log('\n🔄 REFRESH MODE — checking existing venues for updates\n');
  if (neighborhoodFilter) console.log(`   Neighborhood filter: ${neighborhoodFilter}\n`);

  let checked = 0, updated = 0, unchanged = 0, errors = 0, noPlaceId = 0;

  const snap   = await db.collection('venues').get();
  const venues = snap.docs
    .map(d => ({ docId: d.id, ...d.data() }))
    .filter(v => {
      if (!v.googlePlaceId) { noPlaceId++; return false; }
      if (['closed', 'disabled'].includes(v.status)) return false; // skip closed/disabled
      if (neighborhoodFilter) {
        const slug = neighborhoodFilter.toLowerCase().replace(/\s+/g, '-');
        return v.neighborhoodSlug === slug;
      }
      return true;
    });

  console.log(`Found ${venues.length} venues to check${noPlaceId > 0 ? ` (${noPlaceId} skipped — no googlePlaceId or closed)` : ''}\n`);

  for (const venue of venues) {
    process.stdout.write(`  Checking ${venue.name}... `);
    checked++;

    try {
      let place = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          place = await getPlaceById(venue.googlePlaceId);
          break;
        } catch (fetchErr) {
          if (attempt < 3) {
            process.stdout.write(` (timeout, retry ${attempt})... `);
            await new Promise(r => setTimeout(r, 1500 * attempt));
          } else throw fetchErr;
        }
      }

      if (!place) {
        console.log('⚠️  Not found in Google Places (may have closed)');
        errors++;
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      const hood = NEIGHBORHOODS.find(n => n.slug === venue.neighborhoodSlug)
        || { name: venue.neighborhood || '', slug: venue.neighborhoodSlug || '', bounds: {}, center: { latitude: 0, longitude: 0 } };

      // Skip instagram during refresh to preserve API calls
      const refreshed = await buildVenue(place, hood, true);
      const changes   = diff(venue, refreshed);

      if (Object.keys(changes).filter(k => k !== 'updatedAt' && k !== 'confidence').length === 0) {
        console.log('✓ no changes');
        unchanged++;
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      const updatePayload = {};
      for (const [field, change] of Object.entries(changes)) {
        if (OWNER_FIELDS.has(field) || field === 'confidence' || field === 'updatedAt') continue;
        updatePayload[field] = change.to;
      }

      if (Object.keys(updatePayload).length > 0) {
        updatePayload.confidence = refreshed.confidence;
        updatePayload.updatedAt  = admin.firestore.FieldValue.serverTimestamp();
        await db.collection('venues').doc(venue.docId).update(updatePayload);
        updated++;
        console.log('📝 updated');
        Object.entries(changes)
          .filter(([k]) => k !== 'confidence' && k !== 'updatedAt')
          .forEach(([field, c]) => {
            const from = JSON.stringify(c.from)?.slice(0, 50);
            const to   = JSON.stringify(c.to)?.slice(0, 50);
            console.log(`     ${field}: ${from} → ${to}`);
          });
      } else {
        console.log('✓ no updatable changes (owner fields protected)');
        unchanged++;
      }

      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.log(`❌ error: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log('🔄 Refresh complete:');
  console.log(`   ${checked} checked · ${updated} updated · ${unchanged} unchanged · ${errors} errors`);
  console.log(`\nNote: Instagram skipped during refresh to preserve SerpAPI calls.`);
  console.log(`Run: node importPlaces.js --instagram-only  to update Instagram handles.`);
}

// ── IMPORT MODE ───────────────────────────────────────────────────────
async function importNeighborhood(neighborhood, seenIds) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📍 ${neighborhood.name.toUpperCase()}`);
  console.log(`${'═'.repeat(60)}`);

  let added = 0, pendingReview = 0, errors = 0;
  const skipped = [];

  for (const venueType of neighborhood.searchQueries) {
    const query = `${venueType} in ${neighborhood.name} Atlanta Georgia`;
    console.log(`\n  🔍 ${query}`);

    try {
      const data   = await searchPlaces(query, neighborhood.center);
      const places = data.places || [];
      console.log(`     ${places.length} results`);

      for (const place of places) {
        const placeName = place.displayName?.text || place.id;

        if (seenIds.has(place.id)) {
          skipped.push({ name: placeName, reason: 'duplicate (already imported)' });
          continue;
        }
        if (['PERMANENTLY_CLOSED','CLOSED_PERMANENTLY'].includes(place.businessStatus)) {
          skipped.push({ name: placeName, reason: 'permanently closed' });
          continue;
        }

        try {
          // Skip Instagram during import to save SerpAPI calls
          // Run --instagram-only separately after import
          const venue = await buildVenue(place, neighborhood, true);
          await db.collection('venues').doc(`gp_${place.id}`).set(venue, { merge: true });
          seenIds.add(place.id);
          added++;
          if (venue.status === 'pending_review') pendingReview++;

          const statusIcon = venue.status === 'pending_review' ? '⚠️ ' : '✅';
          const hrIcon     = venue.hours.length > 0 ? '🕐' : '  ';
          const pkIcon     = Object.values(venue.parking || {}).some(v => v) ? '🅿️' : '  ';
          console.log(`     ${statusIcon} ${hrIcon}${pkIcon} [${venue.confidence.overall}] ${venue.name}`);

          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          errors++;
          console.log(`     ❌ ${placeName}: ${e.message}`);
        }
      }
    } catch (e) {
      console.log(`     ❌ Query failed: ${e.message}`);
      errors++;
    }

    await new Promise(r => setTimeout(r, 400));
  }

  // Skip report
  if (skipped.length > 0) {
    console.log(`\n  ⏭  SKIPPED (${skipped.length}):`);
    const byReason = {};
    skipped.forEach(s => { if (!byReason[s.reason]) byReason[s.reason] = []; byReason[s.reason].push(s.name); });
    for (const [reason, names] of Object.entries(byReason)) {
      console.log(`\n     ${reason} (${names.length}):`);
      names.slice(0, 20).forEach(n => console.log(`       • ${n}`));
      if (names.length > 20) console.log(`       ... and ${names.length - 20} more`);
    }
  }

  console.log(`\n  📊 ${neighborhood.name}: ${added} added · ${pendingReview} need review · ${skipped.length} skipped · ${errors} errors`);
  console.log(`  💡 Run --instagram-only to add Instagram handles for new venues`);
  return { added, skipped: skipped.length, pendingReview, errors };
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  if (!closeMode && !refreshMode && !instagramOnly && !neighborhoodArg && !runAll) {
    console.log('Usage:');
    console.log('  node importPlaces.js --neighborhood="Midtown"    (import new venues)');
    console.log('  node importPlaces.js --all                        (import all neighborhoods)');
    console.log('  node importPlaces.js --refresh                    (update all existing venues)');
    console.log('  node importPlaces.js --refresh --neighborhood="Midtown"');
    console.log('  node importPlaces.js --instagram-only --test      (test 5 venues first ← START HERE)');
    console.log('  node importPlaces.js --instagram-only             (run all missing handles)');
    console.log('  node importPlaces.js --close --docId="opera-atlanta"');
    console.log('  node importPlaces.js --close --docId="opera-atlanta" --replacedBy="gp_xyz"\n');
    console.log('Status model:');
    console.log('  pending_review — needs manual approval (confidence < 80)');
    console.log('  unclaimed      — live in app with claim CTA');
    console.log('  approved       — venue claimed and verified');
    console.log('  closed         — permanently closed, shows banner in app');
    console.log('  disabled       — hidden completely\n');
    console.log('Available neighborhoods:');
    NEIGHBORHOODS.forEach(n => console.log(`  ${n.name}`));
    process.exit(0);
  }

  const { default: fetch } = await import('node-fetch');
  global.fetch = fetch;

  // ── Close mode ──────────────────────────────────────────────────────
  if (closeMode) {
    if (!docIdArg) {
      console.error('❌ --docId required. Example: --docId="opera-atlanta"');
      process.exit(1);
    }
    await closeVenue(docIdArg, replacedByArg);
    process.exit(0);
  }

  // ── Instagram only mode ─────────────────────────────────────────────
  if (instagramOnly) {
    await runInstagramOnly();
    process.exit(0);
  }

  // ── Refresh mode ────────────────────────────────────────────────────
  if (refreshMode) {
    console.log('🌆 Wugi — Venue Refresh v5\n');
    console.log('Note: Instagram skipped during refresh to preserve SerpAPI quota.');
    console.log('      Run --instagram-only --test first to verify SerpAPI, then --instagram-only\n');
    await refreshVenues(neighborhoodArg);
    process.exit(0);
  }

  // ── Import mode ─────────────────────────────────────────────────────
  console.log('🌆 Wugi — Google Places Atlanta Import v5\n');
  console.log('Note: Instagram lookup skipped during import — run separately after:');
  console.log('      node importPlaces.js --instagram-only --test\n');
  console.log('Legend: ✅ unclaimed · ⚠️  needs review · 🕐 hours · 🅿️ parking · [##] confidence\n');

  const seenIds  = new Set();
  const existing = await db.collection('venues').get();
  existing.docs.forEach(d => { const pid = d.data().googlePlaceId; if (pid) seenIds.add(pid); });
  console.log(`${seenIds.size} venues already in Firestore\n`);

  const toRun = runAll ? NEIGHBORHOODS : (() => {
    const found = NEIGHBORHOODS.find(n => n.name.toLowerCase() === neighborhoodArg.toLowerCase());
    if (!found) {
      console.error(`❌ "${neighborhoodArg}" not found.\nAvailable: ${NEIGHBORHOODS.map(n => n.name).join(', ')}`);
      process.exit(1);
    }
    return [found];
  })();

  let totalAdded = 0, totalPending = 0, totalSkipped = 0, totalErrors = 0;

  for (const neighborhood of toRun) {
    const r = await importNeighborhood(neighborhood, seenIds);
    totalAdded   += r.added;
    totalPending += r.pendingReview;
    totalSkipped += r.skipped;
    totalErrors  += r.errors;
  }

  if (totalPending > 0) {
    await db.collection('config').doc('admin').set({
      pendingVenueReviewCount: admin.firestore.FieldValue.increment(totalPending),
      lastImportAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('🎊 DONE');
  console.log(`   ✅ ${totalAdded} venues imported`);
  console.log(`   ⚠️  ${totalPending} need review`);
  console.log(`   ⏭  ${totalSkipped} skipped`);
  console.log(`   ❌ ${totalErrors} errors`);
  console.log('\nNext steps:');
  console.log('   1. node importPlaces.js --instagram-only --test   (verify SerpAPI works)');
  console.log('   2. node importPlaces.js --instagram-only          (run all)');
  process.exit(0);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
