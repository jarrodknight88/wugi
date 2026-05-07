#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────
 * Wugi — INFRA-VENUE-01 — Phase 3 — transform + Firestore writes
 *
 * Reads the cached Phase 2 + 2b outputs and produces v2 venue and
 * event documents in `wugi-prod` Firestore. No paid API calls; all
 * data comes from the local cache.
 *
 * Per venue:
 *   - heuristic vibes (max 4) from editorialSummary + types + reviews
 *   - primaryCategory mapped from Google types + name keywords
 *   - subcategories from name/about
 *   - neighborhood — text-first (formatted_address + components),
 *     bounding-box fallback against scripts/scrape/lib/atlanta-neighborhoods.json
 *   - attributes detected from opening_hours, types, name, reviews
 *     (includes 'After Hours' for venues open past 4am)
 *   - confidence per importPlaces.js formula
 *   - status (canonical enum, INFRA-VENUE-11): ≥80 → unclaimed, <80 → pending_review;
 *     launchFeaturedNames bumps to 'approved' + isFeatured=true;
 *     existingVenueStatusOverrides may force 'closed'
 *   - tier 'unclaimed' for new venues; preserve for existing if upgraded
 *   - protected fields preserved on existing 209 (claimedBy, Stripe, customs)
 *   - audit subcollection entry per write
 *
 * Per event (SerpAPI):
 *   - matched to venueId by per-venue fetch source or fuzzy name
 *   - tags include 'After Hours' if endTime past 4am or about mentions
 *   - vibes inherited from linked venue (fallback ['Late Night','High Energy'])
 *   - dateISO computed from SerpAPI date.start_date + date.when
 *   - status 'approved' by default (canonical; was 'pending' pre-VENUE-DATA-04)
 *
 * Usage:
 *   node 03-transform-and-write.js              # writes to wugi-prod
 *   node 03-transform-and-write.js --dry-run    # transform + report only
 * ───────────────────────────────────────────────────────────────────── */
'use strict';

const fs   = require('fs');
const path = require('path');

const admin = require('firebase-admin');
const serviceAccount = require(path.resolve(__dirname, '../serviceAccount.json'));
admin.initializeApp({
  credential:    admin.credential.cert(serviceAccount),
  projectId:     'wugi-prod',
  storageBucket: 'wugi-prod.firebasestorage.app',
});
const db   = admin.firestore();
const FV   = admin.firestore.FieldValue;

// ── CLI ───────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');

// ── Paths ─────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '../../..');
const RAW_DIR = path.join(ROOT, 'data/raw');
const PHASE2_RESULT  = path.join(RAW_DIR, 'phase2-details-result.json');
const PHASE2B_RESULT = path.join(RAW_DIR, 'phase2b-logos-result.json');
const PHASE2_OVR     = path.join(RAW_DIR, 'phase2-overrides.json');
const MATCH_OVR      = path.join(RAW_DIR, 'match-overrides.json');
const NEIGHBORHOODS_PATH = path.join(__dirname, 'lib/atlanta-neighborhoods.json');

const PHASE3_RESULT  = path.join(RAW_DIR, 'phase3-write-result.json');
const ORPHAN_EVENTS  = path.join(RAW_DIR, 'orphan-events.json');

// ── Canonical enums (must match firestore-v2.ts) ─────────────────────
const VIBES = [
  'Boujee', 'Divey', 'Speakeasy', 'High Energy', 'Rooftop', 'Late Night',
  'Chill', 'Dance', 'Live Music', 'Date Night', 'Sports', 'Brunch',
  'Cultural', 'Hookah', 'Lounge', 'Adult',
];
const PRIMARY_CATEGORIES = [
  'Bar', 'Nightclub', 'Restaurant', 'Lounge', 'Live Music', 'Comedy',
  'Adult', 'Event Venue', 'Brewery/Distillery', 'Cafe', 'Hotel Bar/Rooftop Pool',
];
const NEIGHBORHOODS = loadJson(NEIGHBORHOODS_PATH).neighborhoods;
const NEIGHBORHOOD_NAMES = NEIGHBORHOODS.map(n => n.name);

// ── Confidence scoring (per importPlaces.js) ──────────────────────────
const FIELD_WEIGHTS = {
  name: 20, address: 20, phone: 15, website: 15,
  hours: 10, photos: 10, instagram: 5, parking: 5,
};
const VISIBILITY_THRESHOLD   = 60;
const AUTO_APPROVE_THRESHOLD = 80;
const PENDING_REVIEW_MIN     = 60;

// Fields that must NEVER be overwritten by the scrape — copied straight
// from the existing Firestore doc onto the new one. previousSlugs is
// computed in buildVenueDoc (existing + maybe-appended old slug), so
// it is intentionally NOT in this set.
const PROTECTED_FIELDS = new Set([
  'claimedBy', 'claimedAt', 'isClaimed', 'tier',
  'stripeConnectAccountId', 'stripeTerminalLocationId',
  'payoutTier', 'payoutSchedule', 'payoutDelayHours', 'payoutPreEvent',
  'reservePercent', 'reserveBalance',
  'paymentDescriptor', 'paymentDescriptorNote',
  'idVerificationThreshold', 'totalOrders',
  'chargebackCount', 'chargebackBalance',
]);

// ── Helpers ───────────────────────────────────────────────────────────
function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }
function slugify(s) {
  return String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 80) || 'unnamed';
}
function normalizeForMatch(s) {
  return String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Series grouping key — drops emoji + extended pictograms, lowercases,
// collapses whitespace. Same shape as backfill-series-ids.js so a re-scrape
// converges on the same seriesId values.
function normalizeEventTitle(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/[‍️]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Existing media might be string URLs (legacy) or {type,uri} objects.
// Normalize to the v2 {type,uri} shape and drop picsum.photos placeholders.
function normalizeExistingMedia(m) {
  if (!Array.isArray(m)) return [];
  return m.map(x => {
    if (typeof x === 'string') return { type: 'image', uri: x };
    if (x && typeof x === 'object' && x.uri) return { type: x.type || 'image', uri: x.uri };
    return null;
  }).filter(x => x && x.uri && !/picsum\.photos|placekitten|loremflickr/i.test(x.uri));
}

// ── Vibe heuristics ──────────────────────────────────────────────────
const VIBE_KEYWORDS = {
  Rooftop:        [/rooftop/i, /sky bar/i, /skyline/i, /open[ -]air/i],
  Hookah:         [/hookah/i, /shisha/i, /sheesha/i],
  Speakeasy:      [/speakeasy/i, /hidden bar/i, /password/i, /unmarked/i],
  Divey:          [/dive bar/i, /divey/i, /no[- ]frills/i, /cash[- ]only/i, /hole[- ]in[- ]the[- ]wall/i],
  Boujee:         [/upscale/i, /high[- ]end/i, /fine dining/i, /michelin/i, /elegant/i, /luxury/i, /premium/i, /sophisticated/i],
  'High Energy':  [/dance floor/i, /pumping/i, /packed/i, /loud/i, /crowded/i, /club vibe/i, /edm/i],
  Dance:          [/dancing/i, /dance club/i, /dj/i, /salsa/i, /bachata/i, /reggaeton/i],
  'Live Music':   [/live music/i, /live band/i, /jazz/i, /concert/i, /performance/i, /open mic/i, /singer[- ]songwriter/i],
  Chill:          [/relaxed/i, /chill/i, /cozy/i, /intimate/i, /quiet/i, /laid[- ]back/i],
  'Date Night':   [/romantic/i, /date night/i, /candle/i, /intimate dinner/i],
  Sports:         [/sports bar/i, /game day/i, /watch party/i, /multiple tvs/i, /every game/i],
  Brunch:         [/brunch/i, /bottomless mimosa/i, /sunday brunch/i],
  Cultural:       [/african/i, /afro/i, /ethiopian/i, /caribbean/i, /jamaican/i, /latin/i, /asian/i, /korean/i, /vietnamese/i, /soul food/i, /mediterranean/i],
  Lounge:         [/lounge/i],
  'Late Night':   [/open late/i, /late night/i, /after hours/i, /until 3am/i, /until 4am/i, /until 5am/i],
  Adult:          [/gentlemen/i, /strip club/i, /topless/i, /burlesque/i, /adult entertainment/i],
};

function inferVibes(text, types, name, vibesHint) {
  const blob = (text || '') + ' ' + (Array.isArray(types) ? types.join(' ') : '') + ' ' + (name || '');
  const inferred = new Set();

  // 1) Honor explicit hints from curated input first
  (vibesHint || []).filter(v => VIBES.includes(v)).forEach(v => inferred.add(v));

  // 2) Keyword heuristics
  for (const [vibe, patterns] of Object.entries(VIBE_KEYWORDS)) {
    if (patterns.some(p => p.test(blob))) inferred.add(vibe);
  }

  // 3) Category-derived defaults
  if (Array.isArray(types)) {
    if (types.includes('night_club')) { inferred.add('High Energy'); inferred.add('Dance'); }
    if (types.includes('bar') && !inferred.has('Divey')) inferred.add('Lounge');
  }

  // Cap at 4 for tidy display
  return Array.from(inferred).slice(0, 4);
}

// ── Primary category mapping ─────────────────────────────────────────
function inferPrimaryCategory(types, name, hintCategory) {
  const t = Array.isArray(types) ? types : [];
  const lname = (name || '').toLowerCase();

  // Strong name signals override types
  if (/(strip club|gentlemen|topless|burlesque)/.test(lname)) return 'Adult';
  if (/(comedy)/.test(lname)) return 'Comedy';
  if (/(brewery|brewing|distillery|winery)/.test(lname)) return 'Brewery/Distillery';
  if (/(café|cafe|coffee)/.test(lname)) return 'Cafe';
  if (/(rooftop|sky bar|skyline)/.test(lname) && (t.includes('lodging') || /hotel/.test(lname))) return 'Hotel Bar/Rooftop Pool';

  // Type-based
  if (t.includes('night_club')) return 'Nightclub';
  if (t.includes('comedy_club')) return 'Comedy';
  if (t.includes('bakery')) return 'Cafe';
  if (t.includes('cafe') || t.includes('coffee_shop')) return 'Cafe';
  if (t.includes('movie_theater') || t.includes('performing_arts_theater') || t.includes('stadium') || t.includes('amusement_park')) return 'Event Venue';
  if (t.includes('liquor_store') || t.includes('food')) return 'Restaurant';
  if (/lounge/.test(lname)) return 'Lounge';
  if (t.includes('restaurant') || t.includes('meal_takeaway') || t.includes('meal_delivery')) return 'Restaurant';
  if (t.includes('bar')) return 'Bar';
  if (t.includes('lodging')) return 'Hotel Bar/Rooftop Pool';

  // Honor curated hint as last resort
  if (hintCategory && PRIMARY_CATEGORIES.includes(hintCategory)) return hintCategory;
  return 'Bar';
}

// ── Subcategories ────────────────────────────────────────────────────
function inferSubcategories(name, types, primaryCategory) {
  const subs = [];
  const lname = (name || '').toLowerCase();
  if (/rooftop/.test(lname)) subs.push('Rooftop');
  if (/sports/.test(lname))  subs.push('Sports');
  if (/wine/.test(lname))    subs.push('Wine');
  if (/cocktail/.test(lname)) subs.push('Cocktail');
  if (/karaoke/.test(lname)) subs.push('Karaoke');
  if (/hookah/.test(lname))  subs.push('Hookah');
  if (/dive/.test(lname))    subs.push('Dive');
  if (/(steakhouse|steak)/.test(lname)) subs.push('Steakhouse');
  if (/(sushi|japanese)/.test(lname)) subs.push('Japanese');
  if (/(italian|pizza)/.test(lname)) subs.push('Italian');
  if (/(mexican|tacos|cantina)/.test(lname)) subs.push('Mexican');
  return subs.slice(0, 3);
}

// ── Neighborhood detection ───────────────────────────────────────────
function inferNeighborhood(formattedAddress, addressComponents, location) {
  const addr = (formattedAddress || '').toLowerCase();
  // Pass 1: substring match in formatted_address
  for (const n of NEIGHBORHOODS) {
    if (addr.includes(n.name.toLowerCase())) return { name: n.name, slug: n.slug, source: 'address-text' };
  }
  // Pass 2: address_components long_name match
  if (Array.isArray(addressComponents)) {
    for (const c of addressComponents) {
      const long = (c.long_name || '').toLowerCase();
      for (const n of NEIGHBORHOODS) {
        if (long === n.name.toLowerCase()) return { name: n.name, slug: n.slug, source: 'address-component' };
      }
    }
  }
  // Pass 3: bounding-box match by lat/lng
  if (location && typeof location.lat === 'number' && typeof location.lng === 'number') {
    for (const n of NEIGHBORHOODS) {
      const b = n.bounds;
      if (location.lat >= b.south && location.lat <= b.north &&
          location.lng >= b.west  && location.lng <= b.east) {
        return { name: n.name, slug: n.slug, source: 'bounding-box' };
      }
    }
  }
  return null;
}

// ── Attribute detection ──────────────────────────────────────────────
function inferAttributes(placeDetails, name) {
  const attrs = new Set();
  const lname = (name || '').toLowerCase();
  const reviews = (placeDetails && placeDetails.reviews) || [];
  const editorial = (placeDetails && placeDetails.editorial_summary && placeDetails.editorial_summary.overview) || '';
  const reviewBlob = editorial + ' ' + reviews.map(r => r.text || '').join(' ');
  const types = (placeDetails && placeDetails.types) || [];

  // Hours-based
  const weekdayText = placeDetails && placeDetails.opening_hours && placeDetails.opening_hours.weekday_text;
  if (Array.isArray(weekdayText)) {
    for (const line of weekdayText) {
      // 'Friday: 5:00 PM – 4:00 AM' or '… 12:00 AM'
      if (/3:00\s?AM|4:00\s?AM|5:00\s?AM|6:00\s?AM/i.test(line)) attrs.add('After Hours');
      if (/2:00\s?AM|3:00\s?AM|4:00\s?AM/i.test(line))           attrs.add('Open Late');
    }
  }

  // Name-based
  if (/rooftop/.test(lname)) attrs.add('Rooftop');
  if (/karaoke/.test(lname)) attrs.add('Karaoke');
  if (types.includes('night_club')) attrs.add('Dancing');
  if (/(gentlemen|strip|topless|burlesque)/.test(lname)) attrs.add('21+ Only');

  // Review-text based
  const tests = [
    [/patio|outdoor/i,           'Outdoor Seating'],
    [/rooftop/i,                 'Rooftop'],
    [/dancing|dance floor/i,     'Dancing'],
    [/dj /i,                     'Live DJ'],
    [/live band|live music/i,    'Live Band'],
    [/happy hour/i,              'Happy Hour'],
    [/bottle service/i,          'Bottle Service'],
    [/vip/i,                     'VIP/Sections'],
    [/dress code/i,              'Dress Code Enforced'],
    [/reservation/i,             'Reservations Available'],
    [/walk[- ]in/i,              'Walk-Ins Welcome'],
    [/valet/i,                   'Valet Parking'],
    [/free parking/i,            'Free Parking'],
    [/wheelchair|accessible/i,   'Wheelchair Accessible'],
    [/coat check/i,              'Coat Check'],
    [/hookah|shisha/i,           'Smoking/Hookah Allowed'],
    [/cash only/i,               'Cash Only'],
    [/byob/i,                    'BYOB'],
    [/private event/i,           'Private Events Available'],
    [/brunch/i,                  'Day Party/Brunch'],
    [/game day|watch party/i,    'Game Day Venue'],
    [/karaoke/i,                 'Karaoke'],
    [/trivia/i,                  'Trivia Night'],
    [/open mic/i,                'Open Mic'],
  ];
  for (const [re, attr] of tests) if (re.test(reviewBlob)) attrs.add(attr);

  return Array.from(attrs);
}

// ── Confidence scoring ───────────────────────────────────────────────
function scoreField(fieldName, value) {
  switch (fieldName) {
    case 'name':    return (!value) ? 0 : 95;
    case 'address': return !value ? 0 : (/atlanta|ga\b/i.test(value)) ? 95 : 70;
    case 'phone':   return value ? 90 : 0;
    case 'website': return !value ? 0 : value.startsWith('https://') ? 85 : 70;
    case 'hours':   return (!value || value.length === 0) ? 0 : value.length >= 7 ? 80 : 50;
    case 'photos':  return (!value || value.length === 0) ? 0 : value.length >= 3 ? 75 : 40;
    case 'instagram':
      if (!value) return 0;
      if (value.confidence === 'high')           return 85;
      if (value.confidence === 'medium')         return 65;
      if (value.confidence === 'inferred-high')  return 45;
      if (value.confidence === 'inferred-medium')return 30;
      return 20;
    case 'parking': return value ? 60 : 0;  // Phase 2 v3 API doesn't return parkingOptions; default 0
    default: return 0;
  }
}

function computeConfidence(fields) {
  let weightedSum = 0;
  const breakdown = {};
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const score   = scoreField(field, fields[field]);
    const visible = score >= VISIBILITY_THRESHOLD;
    breakdown[field] = {
      score, visible,
      source: field === 'instagram' ? (fields.instagram?.source || 'inferred') : 'google_places',
    };
    weightedSum += (score * weight) / 100;
  }
  return { overall: Math.round(weightedSum), breakdown };
}

// ── Build a v2 venue document ────────────────────────────────────────
function buildVenueDoc(v2input, existing, logo, overrides, matchOverrides) {
  const pd  = v2input.placeDetails;
  const placeId = v2input.placeId;
  // Google business_status from Phase 2's cached Place Details. Used to
  // suppress launchFeaturedNames promotion for closed venues (VENUE-DATA-07).
  const googleBusinessStatus = (pd && pd.business_status) || null;

  const name = (pd && pd.name) || existing?.name || v2input.curatedName || v2input.name || 'Unknown Venue';

  const formattedAddress = (pd && pd.formatted_address) || existing?.address || '';
  const location = pd && pd.geometry && pd.geometry.location
    ? { lat: pd.geometry.location.lat, lng: pd.geometry.location.lng }
    : existing?.location || null;

  const types = (pd && pd.types) || [];
  const editorial = (pd && pd.editorial_summary && pd.editorial_summary.overview) || '';
  const reviews = (pd && pd.reviews) || [];
  const reviewSnippets = reviews.slice(0, 5).map(r => ({
    text: (r.text || '').slice(0, 500),
    rating: r.rating || 0,
    authorName: r.author_name || '',
  }));

  const vibes = inferVibes(
    editorial + ' ' + reviews.map(r => r.text || '').join(' '),
    types, name, v2input.vibesHint || []
  );
  const primaryCategory = inferPrimaryCategory(types, name, v2input.category);
  const subcategories   = inferSubcategories(name, types, primaryCategory);
  const attributes      = inferAttributes(pd, name);
  const neighborhood    = inferNeighborhood(formattedAddress, pd?.address_components, location);

  const photos = v2input.photos || [];
  const media  = photos.map(p => ({ type: 'image', uri: p.url }));

  const ig = v2input.instagram;
  const igVisible = ig && ig.confidenceScore >= VISIBILITY_THRESHOLD;

  const fetchedPhone   = (pd && pd.formatted_phone_number) || (pd && pd.international_phone_number) || null;
  const fetchedWebsite = (pd && pd.website) || null;
  const fetchedHours   = (pd && pd.opening_hours && pd.opening_hours.weekday_text) || [];

  // For confidence scoring + defaultX fields, use fresh Google values where available
  const phone   = fetchedPhone   || existing?.phone   || null;
  const website = fetchedWebsite || existing?.website || null;
  const hours   = fetchedHours.length ? fetchedHours : (existing?.hours || []);

  // Owner overrides protected on claimed venues (preserves manually edited content).
  // For unclaimed, we trust fresh Google data — that's the whole point of the refresh.
  const isClaimed = !!(existing && (existing.isClaimed || existing.claimedBy));

  const conf = computeConfidence({
    name, address: formattedAddress, phone, website, hours, photos: media,
    instagram: ig, parking: existing?.parking,
  });

  // Status — canonical enum only (INFRA-VENUE-11):
  //   approved | unclaimed | pending_review | closed | disabled
  // Confidence buckets:
  //   ≥80 → unclaimed   (auto-publish, awaits owner claim)
  //   60-79 → pending_review (manual approval)
  //   <60 → pending_review (was 'low_confidence' — collapsed onto pending_review per VENUE-DATA-04)
  let status;
  if      (conf.overall >= AUTO_APPROVE_THRESHOLD) status = 'unclaimed';
  else                                             status = 'pending_review';

  // launchFeaturedNames promotion — venues on the strategic launch list
  // jump to status='approved' + isFeatured=true. Replaces the hardcoded
  // list in mobile-app/scripts/promote-featured.js.
  //
  // VENUE-DATA-07 guard: never promote a venue whose Google business_status
  // says it's closed. (Compound regression: was on launchFeaturedNames
  // pre-VENUE-DATA-07, but is permanently closed; force-promote falsely
  // resurrected it on the consumer feed.)
  //
  // Source-of-truth for the list is match-overrides.json (NOT phase2-overrides
  // — earlier Phase 3 was reading the wrong file and silently no-op'ing the
  // promotion. Fixed in VENUE-DATA-07.)
  let launchFeatured = false;
  const launchNames = (matchOverrides && matchOverrides.launchFeaturedNames && matchOverrides.launchFeaturedNames.names) || [];
  const isClosedByGoogle = googleBusinessStatus === 'CLOSED_PERMANENTLY' || googleBusinessStatus === 'CLOSED_TEMPORARILY';
  if (launchNames.length && !isClosedByGoogle) {
    const lname = (name || '').toLowerCase();
    for (const target of launchNames) {
      const t = target.toLowerCase();
      if (lname === t || lname.includes(t) || t.includes(lname)) {
        launchFeatured = true;
        status = 'approved';
        break;
      }
    }
  }

  // Apply existingVenueStatusOverrides (Elleven45, Gold Room → 'closed')
  if (overrides && Array.isArray(overrides.existingVenueStatusOverrides)) {
    for (const o of overrides.existingVenueStatusOverrides) {
      if (o.matchHint && new RegExp(o.matchHint, 'i').test(name)) {
        status = o.setStatus;
        if (o.closedReason) v2input._closedReason = o.closedReason;
        break;
      }
    }
  }

  // Tier — preserve existing tier if upgraded; default 'unclaimed'
  const tier = (existing && existing.tier && existing.tier !== 'unclaimed')
    ? existing.tier
    : 'unclaimed';

  // Slug
  const slug = slugify(name);
  const previousSlugs = existing?.previousSlugs || [];
  if (existing?.slug && existing.slug !== slug && !previousSlugs.includes(existing.slug)) {
    previousSlugs.push(existing.slug);
  }

  // Source
  let source = 'google-places';
  if (/afro district/i.test(name)) source = 'manual';
  if (existing?.source && !pd) source = existing.source;

  // Build the v2 doc payload (no FieldValues yet — those go on writeBatch)
  const doc = {
    // Identity
    id: v2input.venueId,
    name, slug,
    googlePlaceId: placeId,

    // Location
    location: location || (existing?.location ?? null),
    address: formattedAddress,
    addressComponents: pd?.address_components || existing?.addressComponents || null,
    neighborhood: neighborhood?.name || existing?.neighborhood || null,
    neighborhoodSlug: neighborhood?.slug || existing?.neighborhoodSlug || null,
    market: 'atlanta',

    // Categorization
    primaryCategory,
    subcategories,
    category: subcategories.length ? `${primaryCategory} · ${subcategories.join(' · ')}` : primaryCategory,
    googleTypes: types,
    vibes,
    attributes,
    crowd: existing?.crowd || [],
    priceLevel: pd?.price_level != null ? '$'.repeat(pd.price_level + 1) : (existing?.priceLevel || null),

    // Tier
    tier,
    isClaimed,

    // Status
    status,
    isActive: status !== 'closed' && status !== 'disabled',
    isFeatured: existing?.isFeatured || !!v2input.forceFeatured || launchFeatured,

    // Confidence
    confidence: conf,

    // Source
    source,

    // Default content (free-tier baseline)
    defaultPhone:   phone,
    defaultWebsite: website,
    defaultHours:   hours,
    defaultAbout:   editorial || existing?.about || null,
    defaultMedia:   media,

    // App-facing (claimed: preserve owner overrides; unclaimed: refresh from defaults)
    phone:   isClaimed ? (existing?.phone   ?? phone)   : phone,
    website: isClaimed ? (existing?.website ?? website) : website,
    hours:   isClaimed ? (existing?.hours   ?? hours)   : hours,
    hoursVisible: existing?.hoursVisible ?? true,
    about:   isClaimed ? (existing?.about   ?? editorial) : (editorial || existing?.about || null),
    // For media: claimed → keep existing curated media if present;
    // unclaimed → use fresh Google photos (the picsum.photos refresh case).
    media:   isClaimed
      ? ((existing?.media && existing.media.length) ? normalizeExistingMedia(existing.media) : media)
      : (media.length ? media : normalizeExistingMedia(existing?.media)),

    instagram:       igVisible ? ig.handle : (existing?.instagram || null),
    instagramSource: ig?.source || existing?.instagramSource || null,

    logoUrl:       logo?.logoUrl       || existing?.logoUrl       || null,
    logoSource:    logo?.logoSource    || existing?.logoSource    || null,

    // Reviews
    rating:           pd?.rating ?? existing?.rating ?? null,
    userRatingsTotal: pd?.user_ratings_total ?? existing?.userRatingsTotal ?? 0,
    reviewSnippets,

    // Schema
    schemaVersion: 2,
    previousSlugs,
  };

  if (status === 'closed' && v2input._closedReason) {
    doc.closedReason = v2input._closedReason;
  }

  return { doc, neighborhood, vibes, attributes };
}

// ── Compute fieldsChanged for audit log ──────────────────────────────
function diffForAudit(prev, next) {
  const changed = [];
  const ignore = new Set(['updatedAt', 'createdAt', 'logoFetchedAt']);
  for (const key of new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])) {
    if (ignore.has(key)) continue;
    const a = JSON.stringify(prev?.[key]);
    const b = JSON.stringify(next?.[key]);
    if (a !== b) changed.push(key);
  }
  return changed;
}

// ── SerpAPI date → ISO 8601 ──────────────────────────────────────────
// SerpAPI Google Events returns date.start_date like "May 4" (no year)
// and date.when like "Sun, May 3, 4 – 11 PM". Convert to ISO 8601 in
// the event-local timezone. Pure best-effort; returns null if unparseable.
const DEFAULT_VIBES_FOR_ORPHAN_VENUE = ['Late Night', 'High Energy'];

function parseSerpapiDateToISO(dateField) {
  if (!dateField || typeof dateField !== 'object') return null;
  const startDate = dateField.start_date;       // "May 4"
  const when      = dateField.when;             // "Sun, May 3, 4 – 11 PM"
  if (!startDate) return null;

  const now  = new Date();
  const year = now.getFullYear();

  // Append current year first; if parsed date is >30 days in the past,
  // assume it's next year (SerpAPI returns upcoming events).
  let parsed = new Date(`${startDate} ${year}`);
  if (isNaN(parsed.getTime())) return null;
  if ((now.getTime() - parsed.getTime()) > 30 * 24 * 60 * 60 * 1000) {
    parsed = new Date(`${startDate} ${year + 1}`);
  }
  if (isNaN(parsed.getTime())) return null;

  // Extract start time from `when` if present (handles "8 PM", "8:30 PM", etc.)
  if (when) {
    const m = when.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)/);
    if (m) {
      let hour = parseInt(m[1], 10);
      const minute = m[2] ? parseInt(m[2], 10) : 0;
      const mer = m[3].toUpperCase();
      if (mer === 'PM' && hour < 12) hour += 12;
      if (mer === 'AM' && hour === 12) hour = 0;
      parsed.setHours(hour, minute, 0, 0);
    }
  }

  return parsed.toISOString();
}

// ── Build a v2 event document ────────────────────────────────────────
// Per VENUE-DATA-04: writes canonical status 'approved' (not 'pending'),
// inherits vibes from the linked venue (fallback default), and computes
// dateISO from the SerpAPI date.
function buildEventDoc(rawEvent, venueByPlaceId, venueByNormalizedName) {
  // Match strategy:
  // 1) per-venue source: rawEvent._source === 'per-venue' → use _venuePlaceId
  // 2) citywide: fuzzy name match against venueByNormalizedName
  let venueRef = null;

  if (rawEvent._source === 'per-venue' && rawEvent._venueId) {
    venueRef = venueByPlaceId.get(rawEvent._venuePlaceId) || null;
  }

  if (!venueRef && rawEvent.address) {
    const addrLine = Array.isArray(rawEvent.address) ? rawEvent.address[0] : rawEvent.address;
    if (addrLine) {
      const norm = normalizeForMatch(addrLine);
      for (const [name, v] of venueByNormalizedName) {
        if (norm.includes(name) && name.length >= 6) { venueRef = v; break; }
      }
    }
  }

  if (!venueRef) return null; // orphan
  const { venueId, name: venueName, address: venueAddress, vibes: venueVibes } = venueRef;

  const title = rawEvent.title || rawEvent.name || 'Untitled event';
  const addr  = Array.isArray(rawEvent.address) ? rawEvent.address.join(', ') : (rawEvent.address || '');
  const dateField = rawEvent.date;

  // Tags including 'After Hours' heuristic
  const tags = [];
  const blob = `${title} ${rawEvent.description || ''}`.toLowerCase();
  if (/after hours|late night|after.party/i.test(blob)) tags.push('After Hours');

  // dateISO from SerpAPI structured date; legacy `date` mirror keeps the
  // human-readable string for screens that haven't migrated.
  const dateISO = parseSerpapiDateToISO(dateField);
  const dateLegacy = (dateField && dateField.start_date) || (dateField && dateField.when) || (dateISO ? dateISO.slice(0, 10) : new Date().toISOString().slice(0, 10));

  // Vibe inheritance — never write empty vibes (would hide event from
  // any vibe-personalized query via array-contains-any).
  const vibes = (Array.isArray(venueVibes) && venueVibes.length > 0)
    ? venueVibes.slice()
    : DEFAULT_VIBES_FOR_ORPHAN_VENUE.slice();

  return {
    id: rawEvent.event_id || `serp-${slugify(title)}-${slugify(addr).slice(0, 30)}`,
    slug: slugify(title),
    title,
    venueId,
    venueName,
    venue: venueName,                              // legacy mirror
    address: addr,
    date: dateLegacy,                              // legacy human-readable
    dateISO,                                       // ISO 8601 (HOME-FEED-01 needs this)
    time: (dateField && (dateField.when || dateField.start_date)) || null,
    about: rawEvent.description || '',
    media: rawEvent.thumbnail ? [{ type: 'image', uri: rawEvent.thumbnail }] : [],
    vibes,
    vibesInheritedFrom: (Array.isArray(venueVibes) && venueVibes.length > 0) ? 'venue' : 'default',
    tags,
    sourceUrl: (rawEvent.link || (rawEvent.event_location_map && rawEvent.event_location_map.link)) || null,
    source: 'serpapi',
    status: 'approved',                            // canonical (was 'pending')
    isActive: true,
    // Always present so feed queries that orderBy('isFeatured', 'desc')
    // don't silently drop scraped events. Promotion scripts flip to true.
    isFeatured: false,
    // Defensive default: each newly-built event is a single occurrence and
    // therefore its own anchor. The series-stamping pass below overwrites
    // this for siblings of a multi-occurrence series.
    isSeriesAnchor: true,
    market: 'atlanta',
    confidence: { overall: 60, breakdown: {} },
    schemaVersion: 2,
  };
}

// ── Firestore writeBatch in chunks of 500 ops ────────────────────────
async function commitInBatches(operations, label) {
  if (DRY_RUN) {
    console.log(`  [dry-run] ${operations.length} ops queued for ${label} — not committing`);
    return { committed: 0, batches: 0 };
  }
  let committed = 0, batches = 0;
  for (let i = 0; i < operations.length; i += 500) {
    const slice = operations.slice(i, i + 500);
    const batch = db.batch();
    for (const op of slice) {
      if (op.type === 'set')    batch.set(op.ref, op.data, op.options || { merge: true });
      else if (op.type === 'update') batch.update(op.ref, op.data);
      else if (op.type === 'delete') batch.delete(op.ref);
    }
    await batch.commit();
    committed += slice.length;
    batches += 1;
    process.stdout.write(`  committed batch ${batches} (${slice.length} ops, total ${committed}/${operations.length}) — ${label}\n`);
  }
  return { committed, batches };
}

// ── Main ──────────────────────────────────────────────────────────────
(async function main() {
  const startedAt = Date.now();
  console.log(`Phase 3 transform + write — ${DRY_RUN ? 'DRY RUN' : 'LIVE wugi-prod'} — ${new Date().toISOString()}`);

  // Load all inputs
  if (!fs.existsSync(PHASE2_RESULT))  { console.error(`ERR  ${PHASE2_RESULT} not found`); process.exit(1); }
  const phase2  = loadJson(PHASE2_RESULT);
  const phase2b = fs.existsSync(PHASE2B_RESULT) ? loadJson(PHASE2B_RESULT) : { results: [] };
  const overrides = fs.existsSync(PHASE2_OVR) ? loadJson(PHASE2_OVR) : {};
  const matchOverrides = fs.existsSync(MATCH_OVR) ? loadJson(MATCH_OVR) : {};

  const logoByPlaceId = new Map(phase2b.results.filter(r => r.logoUrl).map(r => [r.placeId, r]));
  console.log(`✓ ${phase2.venues.length} venues from Phase 2`);
  console.log(`✓ ${logoByPlaceId.size} logos from Phase 2b`);

  // Load existing Firestore venues (for protected-field preservation)
  const existingSnap = await db.collection('venues').get();
  const existingById = new Map(existingSnap.docs.map(d => [d.id, d.data()]));
  console.log(`✓ ${existingById.size} existing Firestore venue docs loaded`);

  // ── Pre-pass: existingVenueStatusOverrides ─────────────────────────
  // Elleven45 / Gold Room need status='closed' even though Phase 1 dropped
  // them so they're absent from phase2.venues. Walk existing Firestore docs
  // and queue closed-status updates by name match.
  const existingStatusOps = [];
  if (Array.isArray(overrides.existingVenueStatusOverrides)) {
    for (const o of overrides.existingVenueStatusOverrides) {
      const re = new RegExp(o.matchHint, 'i');
      for (const [id, v] of existingById) {
        if (o.existingDocId && o.existingDocId !== id) continue;
        if (!re.test(v.name || '')) continue;
        existingStatusOps.push({
          type: 'update',
          ref: db.collection('venues').doc(id),
          data: {
            status: o.setStatus,
            isActive: false,
            closedReason: o.closedReason || null,
            closedAt: FV.serverTimestamp(),
            updatedAt: FV.serverTimestamp(),
          },
        });
        // Also write an audit entry
        existingStatusOps.push({
          type: 'set',
          ref: db.collection('venues').doc(id).collection('audit').doc(),
          data: {
            changedAt: FV.serverTimestamp(),
            changedBy: 'system-scrape-2026-05-03',
            changeType: 'update',
            source: 'override',
            fieldsChanged: ['status', 'isActive', 'closedReason', 'closedAt'],
            notes: `existingVenueStatusOverride: ${o.closedReason || ''}`,
            reviewed: false,
          },
          options: {},
        });
        console.log(`  pre-pass: queued status='${o.setStatus}' for ${v.name} (${id})`);
      }
    }
  }

  // ── Build venue docs ───────────────────────────────────────────────
  const venueOps = [];
  const auditOps = [];
  const summary = {
    create: 0, refresh: 0, skip: 0,
    byStatus: {}, byTier: {}, byNeighborhood: {}, byPrimaryCategory: {},
    confidenceHistogram: { '0-39': 0, '40-59': 0, '60-79': 0, '80-100': 0 },
  };
  const transformedVenues = [];
  const venueByPlaceId = new Map();
  const venueByNormalizedName = new Map();

  for (const v of phase2.venues) {
    const venueId = v.venueId;
    if (!venueId) { summary.skip += 1; continue; }
    const existing = existingById.get(venueId) || null;
    const logo     = logoByPlaceId.get(v.placeId) || null;

    // Guard: if Phase 2 couldn't fetch Place Details, do NOT downgrade an
    // existing venue to low-confidence — leave its Firestore doc untouched
    // and skip the audit log. (Net-new with no place details get skipped too.)
    if (!v.placeDetails) {
      summary.skip += 1;
      continue;
    }

    const built = buildVenueDoc(v, existing, logo, overrides, matchOverrides);
    let { doc } = built;

    // Apply Teranga special-handling from match-overrides.json (isTestVenue + preserveClaimedBy)
    if (v.setFields && typeof v.setFields === 'object') {
      doc = { ...doc, ...v.setFields };
    }

    // Apply protected fields preservation: copy existing values for any PROTECTED_FIELD that exists
    if (existing) {
      for (const f of PROTECTED_FIELDS) {
        if (existing[f] !== undefined) doc[f] = existing[f];
      }
      // tier downgrade guard: never reduce existing tier
      if (existing.tier && existing.tier !== 'unclaimed') doc.tier = existing.tier;
    }

    // Build write op
    const ref = db.collection('venues').doc(venueId);
    venueOps.push({
      type: 'set',
      ref,
      data: {
        ...doc,
        scrapedAt:      FV.serverTimestamp(),
        lastEnrichedAt: FV.serverTimestamp(),
        updatedAt:      FV.serverTimestamp(),
        ...(existing ? {} : { createdAt: FV.serverTimestamp() }),
      },
      options: { merge: true },
    });

    // Audit log entry
    const fieldsChanged = existing ? diffForAudit(existing, doc) : Object.keys(doc);
    const auditRef = db.collection('venues').doc(venueId).collection('audit').doc();
    auditOps.push({
      type: 'set',
      ref: auditRef,
      data: {
        changedAt:    FV.serverTimestamp(),
        changedBy:    'system-scrape-2026-05-03',
        changeType:   existing ? 'refresh' : 'create',
        source:       doc.source,
        fieldsChanged,
        reviewed:     false,
      },
      options: {},
    });

    // Track summary
    summary[existing ? 'refresh' : 'create'] += 1;
    summary.byStatus[doc.status] = (summary.byStatus[doc.status] || 0) + 1;
    summary.byTier[doc.tier] = (summary.byTier[doc.tier] || 0) + 1;
    if (doc.neighborhood) summary.byNeighborhood[doc.neighborhood] = (summary.byNeighborhood[doc.neighborhood] || 0) + 1;
    summary.byPrimaryCategory[doc.primaryCategory] = (summary.byPrimaryCategory[doc.primaryCategory] || 0) + 1;
    const c = doc.confidence.overall;
    if      (c >= 80) summary.confidenceHistogram['80-100'] += 1;
    else if (c >= 60) summary.confidenceHistogram['60-79'] += 1;
    else if (c >= 40) summary.confidenceHistogram['40-59'] += 1;
    else              summary.confidenceHistogram['0-39'] += 1;

    transformedVenues.push({ venueId, name: doc.name, status: doc.status, tier: doc.tier, neighborhood: doc.neighborhood, confidence: c });
    // Stash vibes alongside name/address so buildEventDoc can inherit them.
    const venueRef = { venueId, name: doc.name, address: doc.address, vibes: doc.vibes || [] };
    if (v.placeId) venueByPlaceId.set(v.placeId, venueRef);
    if (doc.name)  venueByNormalizedName.set(normalizeForMatch(doc.name), venueRef);
  }

  // ── Build event docs ──────────────────────────────────────────────
  const orphans  = [];
  const builtEvents = [];
  const seenEventKeys = new Set();

  for (const e of phase2.events || []) {
    const built = buildEventDoc(e, venueByPlaceId, venueByNormalizedName);
    if (!built) {
      orphans.push({ title: e.title, address: e.address, source: e._source });
      continue;
    }
    const dedupeKey = `${built.title}|${built.venueId}|${built.dateISO}`;
    if (seenEventKeys.has(dedupeKey)) continue;
    seenEventKeys.add(dedupeKey);
    builtEvents.push(built);
  }

  // ── Bulk-read existing events ──────────────────────────────────────
  // Mirrors the venue path (existingById at line ~727). The write loop
  // below uses this to preserve createdAt across re-scrapes (writing it
  // only when the event doc is net-new). The cleanup pass below also
  // consumes from this Map so we only do one collection scan.
  const existingEventsSnap = await db.collection('events').get();
  const existingEventsById = new Map(
    existingEventsSnap.docs.map(d => [d.id, { data: d.data(), ref: d.ref }])
  );
  console.log(`✓ ${existingEventsById.size} existing Firestore event docs loaded`);

  // ── Series grouping (VENUE-DATA-08 Deliverable C) ─────────────────
  // Group events by (venueId, normalizedTitle). Set seriesId/isSeriesAnchor/
  // seriesOccurrences at write time so future scrapes don't recreate the
  // 8-9-occurrence dupes problem in the consumer feed. Same logic as the
  // backfill script (mobile-app/scripts/backfill-series-ids.js) for parity.
  const TODAY_ISO = new Date().toISOString().slice(0, 10);
  const seriesGroups = new Map(); // key -> { events:[built], seriesId }
  for (const b of builtEvents) {
    const venueId = b.venueId || '_no_venue';
    const norm    = normalizeEventTitle(b.title || '');
    const key     = `${venueId}::${norm}`;
    if (!seriesGroups.has(key)) {
      seriesGroups.set(key, {
        events:   [],
        seriesId: `series-${slugify(venueId)}-${slugify(norm) || 'untitled'}`,
      });
    }
    seriesGroups.get(key).events.push(b);
  }
  // Stamp series fields on each event in-place
  for (const { events: siblings, seriesId } of seriesGroups.values()) {
    // Anchor = lowest-future occurrence. If no future-or-today occurrence
    // exists, the series goes dormant (no anchor at all) — feed queries
    // that filter on isSeriesAnchor==true must not surface stale series.
    // The next scrape (or rollForwardSeriesAnchors) will pick a new anchor
    // when fresh occurrences land.
    const future = siblings.filter(s => (s.dateISO || '') >= TODAY_ISO);
    let anchor = null;
    if (future.length > 0) {
      future.sort((a, b) => (a.dateISO || '').localeCompare(b.dateISO || ''));
      anchor = future[0];
    }
    const allIds = siblings.map(s => s.id);
    for (const s of siblings) {
      const isAnchor = !!(anchor && s.id === anchor.id);
      s.seriesId           = seriesId;
      s.isSeriesAnchor     = isAnchor;
      s.seriesOccurrences  = isAnchor ? allIds : null;
    }
  }

  // Build write ops from stamped events
  const eventOps = [];
  const eventDocs = [];
  for (const built of builtEvents) {
    const ref = db.collection('events').doc(built.id);
    const existing = existingEventsById.get(built.id);
    eventOps.push({
      type: 'set',
      ref,
      data: {
        ...built,
        updatedAt: FV.serverTimestamp(),
        scrapedAt: FV.serverTimestamp(),
        // Only set createdAt on net-new docs. Mirrors the venue path
        // at line ~826 — re-scrape merge writes must not reshuffle the
        // feed by re-stamping creation timestamps.
        ...(existing ? {} : { createdAt: FV.serverTimestamp() }),
      },
      options: { merge: true },
    });
    eventDocs.push(built);
  }
  console.log(`  series grouped ${builtEvents.length} events into ${seriesGroups.size} series; ${[...seriesGroups.values()].filter(g => g.events.length > 1).length} multi-occurrence`);

  // ── Final cleanup pass: existing events with `name` instead of `title` ─
  // Reads from existingEventsById (loaded above) — no second collection scan.
  console.log('');
  console.log('── Cleanup pass: legacy event field normalization ─────────────');
  let nameToTitleMigrated = 0;
  for (const { data, ref } of existingEventsById.values()) {
    if (!data.title && data.name) {
      eventOps.push({
        type: 'update',
        ref,
        data: { title: data.name, updatedAt: FV.serverTimestamp() },
      });
      nameToTitleMigrated += 1;
    }
  }
  console.log(`  legacy events with name→title migration queued: ${nameToTitleMigrated}`);

  // Existing venues with venueLatitude/venueLongitude → location object
  let venueLatLngMigrated = 0;
  for (const [id, v] of existingById) {
    if (v.venueLatitude != null && v.venueLongitude != null && !v.location) {
      const ref = db.collection('venues').doc(id);
      venueOps.push({
        type: 'update',
        ref,
        data: { location: { lat: v.venueLatitude, lng: v.venueLongitude }, updatedAt: FV.serverTimestamp() },
      });
      venueLatLngMigrated += 1;
    }
  }
  console.log(`  legacy venues with venueLatitude/Longitude → location: ${venueLatLngMigrated}`);

  // ── Commit ────────────────────────────────────────────────────────
  console.log('');
  console.log(`── ${DRY_RUN ? 'DRY RUN — committing nothing' : 'Committing to wugi-prod'} ──`);
  console.log(`  venue ops:  ${venueOps.length}`);
  console.log(`  audit ops:  ${auditOps.length}`);
  console.log(`  event ops:  ${eventOps.length}`);

  const statusResult = await commitInBatches(existingStatusOps, 'status-overrides');
  const venueResult  = await commitInBatches(venueOps, 'venues');
  const auditResult  = await commitInBatches(auditOps, 'audit');
  const eventResult  = await commitInBatches(eventOps, 'events');

  // ── Output result + orphans ───────────────────────────────────────
  writeJson(PHASE3_RESULT, {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    summary: {
      ...summary,
      venuesProcessed: transformedVenues.length,
      eventsProcessed: eventDocs.length,
      orphanEvents:    orphans.length,
      legacyMigrations: { eventNameToTitle: nameToTitleMigrated, venueLatLngToLocation: venueLatLngMigrated },
      committed: { statusOverrides: statusResult.committed, venueOps: venueResult.committed, auditOps: auditResult.committed, eventOps: eventResult.committed },
    },
    transformedVenues,
  });
  writeJson(ORPHAN_EVENTS, { generatedAt: new Date().toISOString(), count: orphans.length, items: orphans });

  // ── Print summary ─────────────────────────────────────────────────
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  console.log('─────────────────────────────────────────────────────────────────────');
  console.log(`Phase 3 — complete in ${elapsed}s ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE writes to wugi-prod)'}`);
  console.log('─────────────────────────────────────────────────────────────────────');
  console.log(`Venues processed:  ${transformedVenues.length}  (create ${summary.create}, refresh ${summary.refresh}, skip ${summary.skip})`);
  console.log(`Events processed:  ${eventDocs.length}  (orphans ${orphans.length})`);
  console.log('');
  console.log('By status:');         for (const [s, n] of Object.entries(summary.byStatus))      console.log(`  ${s.padEnd(20)} ${n}`);
  console.log('By tier:');           for (const [s, n] of Object.entries(summary.byTier))        console.log(`  ${s.padEnd(20)} ${n}`);
  console.log('By primary category:');for (const [s, n] of Object.entries(summary.byPrimaryCategory)) console.log(`  ${s.padEnd(28)} ${n}`);
  console.log('Confidence histogram:'); for (const [s, n] of Object.entries(summary.confidenceHistogram)) console.log(`  ${s.padEnd(10)} ${n}`);
  console.log('Top 10 neighborhoods:');
  Object.entries(summary.byNeighborhood).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([n, c]) => console.log(`  ${n.padEnd(28)} ${c}`));
  console.log('');
  console.log(`Result: ${path.relative(ROOT, PHASE3_RESULT)}`);
  console.log(`Orphan events: ${path.relative(ROOT, ORPHAN_EVENTS)} (${orphans.length})`);

  process.exit(0);
})().catch(err => {
  console.error('ERR  Phase 3 failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
