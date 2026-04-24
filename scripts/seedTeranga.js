// ─────────────────────────────────────────────────────────────────────
// Wugi — seedTeranga.js
// Seeds accurate Teranga City Brookhaven data into Firestore
// Run: node scripts/seedTeranga.js
// ─────────────────────────────────────────────────────────────────────
const admin = require('/Users/jarrod/Documents/GitHub/wugi/node_modules/firebase-admin');
const sa    = require('/Users/jarrod/Documents/GitHub/wugi/scripts/serviceAccount.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db  = admin.firestore();
const now = admin.firestore.FieldValue.serverTimestamp();

const VENUE_ID = 'teranga-city-brookhaven';

// Real public-domain/CC photos from Unsplash that match the vibe
// (lounge/restaurant/West African aesthetic — no copyright issues)
const VENUE_PHOTOS = [
  'https://images.unsplash.com/photo-1721322800607-8c38375eef04?w=1200&q=80', // moody restaurant interior
  'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=1200&q=80', // cocktails on bar
  'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=1200&q=80', // nightlife lounge
  'https://images.unsplash.com/photo-1571997478779-2adcbbe9ab2f?w=1200&q=80', // food spread
];

const EVENT_PHOTO = 'https://images.unsplash.com/photo-1508997449629-303059a039c0?w=1200&q=80'; // crowd watching screen

async function main() {
  console.log('🌍 Seeding Teranga City Brookhaven...\n');
  await seedVenue();
  await seedTicketTypes();
  await seedEvents();
  console.log('\n✅ Teranga seed complete!');
  process.exit(0);
}

async function seedVenue() {
  const data = {
    // ── Identity ───────────────────────────────────────────────────
    name:             'Teranga City',
    slug:             VENUE_ID,
    market:           'atlanta',
    category:         'Restaurant & Lounge',

    // ── Real contact info ──────────────────────────────────────────
    address:          '1860 Corporate Blvd NE, Atlanta, GA 30329',
    phone:            '(404) 228-3385',
    website:          'https://www.terangacitybh.com',
    instagram:        'teranga.bh',
    instagramSource:  'manual',

    // ── Description ────────────────────────────────────────────────
    about: "Teranga City is where bold West African flavors meet classic American comfort in a high-energy lounge atmosphere. Savor beef suya, jollof rice, or indulge in American favorites like burgers and Cajun pasta. Handcrafted cocktails, premium hookah, and pulsating beats set the stage for unforgettable nights. Every guest is family — come hungry, leave happy.",

    // ── Attributes ─────────────────────────────────────────────────
    attributes:  ['Full Bar','Hookah','DJ','VIP Tables','Private Events','Happy Hour','Brunch','Late Night','Outdoor Patio'],
    vibes:       ['High Energy','Boujee','Late Night','Afrobeats','West African'],

    // ── Hours ──────────────────────────────────────────────────────
    hours: [
      'Monday: 1:00 PM – 2:00 AM',
      'Tuesday: 1:00 PM – 2:00 AM',
      'Wednesday: 1:00 PM – 2:00 AM',
      'Thursday: 1:00 PM – 2:00 AM',
      'Friday: 1:00 PM – 2:00 AM',
      'Saturday: 12:00 PM – 2:00 AM',
      'Sunday: 12:00 PM – 2:00 AM',
    ],
    hoursVisible: true,

    // ── Happy Hour ─────────────────────────────────────────────────
    // Tue–Sun 1PM–7PM: $1 wings, $5 lamb chops, $5 drinks

    // ── Location ───────────────────────────────────────────────────
    location:           { latitude: 33.8515, longitude: -84.3240 },
    neighborhood:       'Brookhaven',
    neighborhoodSlug:   'brookhaven',

    // ── Media ──────────────────────────────────────────────────────
    media: VENUE_PHOTOS,

    // ── Meta ───────────────────────────────────────────────────────
    rating:      4.2,
    priceLevel:  '$$',
    googlePlaceId: null,

    // ── Status ─────────────────────────────────────────────────────
    status:    'approved',
    isClaimed: true,
    claimedBy: 'jarrod@wugi.us',
    isActive:  true,
    isFeatured: true,
    sortOrder:  1,

    // ── Timestamps ─────────────────────────────────────────────────
    createdAt: now,
    updatedAt: now,
  };

  await db.collection('venues').doc(VENUE_ID).set(data, { merge: true });
  console.log('✅ Venue seeded:', data.name);
}

async function seedTicketTypes() {
  const types = [
    {
      id:          'general-admission',
      name:        'General Admission',
      description: 'Entry to the event. First come, first served seating.',
      price:       2500,   // $25.00
      capacity:    200,
      remaining:   200,
      sold:        0,
      active:      true,
      isFree:      false,
      status:      'on_sale',
      maxPerOrder: 10,
      tableCapacity: null,
      sortOrder:   1,
    },
    {
      id:          'vip-table-4',
      name:        'VIP Table Package (4 Guests)',
      description: 'Reserved VIP table for 4. Includes bottle service and priority entry.',
      price:       40000,  // $400.00
      capacity:    10,
      remaining:   10,
      sold:        0,
      active:      true,
      isFree:      false,
      status:      'on_sale',
      maxPerOrder: 1,
      tableCapacity: 4,
      sortOrder:   2,
    },
    {
      id:          'vip-table-8',
      name:        'VIP Table Package (8 Guests)',
      description: 'Reserved VIP table for 8. Includes two bottle selections and priority entry.',
      price:       75000,  // $750.00
      capacity:    5,
      remaining:   5,
      sold:        0,
      active:      true,
      isFree:      false,
      status:      'on_sale',
      maxPerOrder: 1,
      tableCapacity: 8,
      sortOrder:   3,
    },
  ];

  // We'll attach these to each event below — store them for reuse
  console.log('✅ Ticket types prepared (will be added per event)');
  return types;
}

async function seedEvents() {
  const ticketTypes = [
    { id:'general-admission', name:'General Admission', description:'Entry to the event. First come, first served seating.', price:2500,  capacity:200, remaining:200, sold:0, active:true, isFree:false, status:'on_sale', maxPerOrder:10, tableCapacity:null, sortOrder:1 },
    { id:'vip-table-4',       name:'VIP Table (4 Guests)', description:'Reserved VIP table for 4 with bottle service and priority entry.', price:40000, capacity:10,  remaining:10,  sold:0, active:true, isFree:false, status:'on_sale', maxPerOrder:1,  tableCapacity:4, sortOrder:2 },
    { id:'vip-table-8',       name:'VIP Table (8 Guests)', description:'Reserved VIP table for 8 with two bottle selections and priority entry.', price:75000, capacity:5,   remaining:5,   sold:0, active:true, isFree:false, status:'on_sale', maxPerOrder:1,  tableCapacity:8, sortOrder:3 },
  ];

  const events = [
    {
      id:    'fifa-world-cup-opening-watch-party-teranga',
      title: 'FIFA World Cup Opening Watch Party 🌍⚽',
      date:  'TUE JUN 9',
      dateISO: '2026-06-09',
      time:  '5:00 PM',
      about: "The biggest sporting event on earth comes to Atlanta — and Teranga City is the place to be. Watch the FIFA World Cup opening match live on our big screens with premium cocktails, hookah, authentic West African cuisine, and the energy only Teranga can bring. VIP tables available. Early arrival strongly recommended.",
      vibes: ['High Energy','Boujee','Late Night','World Cup'],
    },
    {
      id:    'teranga-friday-nights-apr-25',
      title: 'Friday Night Vibes at Teranga 🔥',
      date:  'FRI APR 25',
      dateISO: '2026-04-25',
      time:  '9:00 PM',
      about: "Start your weekend right at Teranga City Brookhaven. DJ spinning Afrobeats, Amapiano, and R&B all night. Full bar, hookah, VIP tables, and the best late-night food in Brookhaven. Come through.",
      vibes: ['High Energy','Late Night','Afrobeats'],
    },
    {
      id:    'teranga-brunch-sat-apr-26',
      title: 'Teranga Weekend Brunch 🥂',
      date:  'SAT APR 26',
      dateISO: '2026-04-26',
      time:  '12:00 PM',
      about: "Brunch done right. Teranga City's weekend brunch is Atlanta's best kept secret — seafood trays, French toast, bottomless mimosas, and good vibes starting at noon. Grab your crew and your table.",
      vibes: ['Chill','Boujee','Brunch'],
    },
    {
      id:    'usa-vs-morocco-world-cup-watch-party-teranga',
      title: 'USA vs Morocco World Cup Watch Party 🇺🇸',
      date:  'SUN JUN 14',
      dateISO: '2026-06-14',
      time:  '3:00 PM',
      about: "This is the one. USA takes on Morocco at the FIFA World Cup and Teranga City is Atlanta's official watch party destination. Giant screens, full bar, hookah, VIP tables. Come early — it will be packed.",
      vibes: ['High Energy','Late Night','World Cup'],
    },
  ];

  for (const e of events) {
    const eventRef = db.collection('events').doc(e.id);
    await eventRef.set({
      title:      e.title,
      venueName:  'Teranga City',
      venueId:    VENUE_ID,
      slug:       e.id,
      date:       e.date,
      dateISO:    e.dateISO,
      time:       e.time,
      age:        '21+',
      about:      e.about,
      vibes:      e.vibes,
      status:     'approved',
      hasTickets: true,
      isFeatured: true,
      sortOrder:  1,
      media:      [{ type: 'image', uri: EVENT_PHOTO }],
      galleryId:  null,
      market:     'atlanta',
      createdAt:  now,
      updatedAt:  now,
    }, { merge: true });

    // Seed ticket types as subcollection
    for (const tt of ticketTypes) {
      await eventRef.collection('ticketTypes').doc(tt.id).set({
        ...tt, eventId: e.id, venueId: VENUE_ID, createdAt: now, updatedAt: now,
      }, { merge: true });
    }

    console.log('✅ Event seeded:', e.title);
  }
}

main().catch(e => { console.error('❌ Seed failed:', e); process.exit(1); });
