/**
 * Wugi Firebase Seed Script
 * 
 * Usage:
 *   cd ~/Documents/GitHub/wugi
 *   npm install firebase-admin
 *   node seed-wugi.js
 * 
 * Requires: serviceAccountKey.json in the same directory
 * Get it from: Firebase Console → Project Settings → Service Accounts → Generate new private key
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'wugi-prod',
});

const db = admin.firestore();

// ── Picsum seeds for consistent placeholder images ──────────────────
const img = (seed, w = 800, h = 600) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const thumb = (seed) => img(seed, 400, 400);

// ── VENUES ──────────────────────────────────────────────────────────
const venues = [
  {
    id: 'nite-owl',
    name: 'Nite Owl Kitchen & Cocktails',
    category: 'Bar · Kitchen · Late Night',
    address: '6 Olive Street, Avondale Estates, GA 30002',
    phone: '(678) 925-4418',
    website: 'https://niteowlatl.com',
    instagram: '@niteowlatl',
    attributes: ['Open Late', 'Kid Friendly', 'Pet Friendly', 'Happy Hour'],
    about: 'Avondale Estates neighborhood gem serving elevated bar food and creative cocktails. Known for their legendary late-night happy hour and welcoming community vibe.',
    media: [img('niteowl1'), img('niteowl2'), img('niteowl3')],
    menuDescription: 'Elevated bar food, craft cocktails, happy hour specials',
    location: { latitude: 33.7701, longitude: -84.2699 },
    vibes: ['Divey', 'Late Night'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'skylounge-atl',
    name: 'SkyLounge ATL',
    category: 'Rooftop Bar · Lounge',
    address: '3390 Peachtree Rd NE, Atlanta, GA 30326',
    phone: '(404) 555-0101',
    website: 'https://skyloungedatl.com',
    instagram: '@skyloungedatl',
    attributes: ['Rooftop', 'Bottle Service', 'Dress Code', 'Open Late'],
    about: "Atlanta's premier rooftop lounge with panoramic city views. Bottle service, craft cocktails, and the best skyline in the city.",
    media: [img('skylounge1'), img('skylounge2'), img('skylounge3')],
    menuDescription: 'Craft cocktails, small plates, bottle service packages',
    location: { latitude: 33.8468, longitude: -84.3618 },
    vibes: ['Boujee', 'Rooftop'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'tongue-groove',
    name: 'Tongue & Groove',
    category: 'Nightclub · Live Music',
    address: '565 Main Street NE, Atlanta, GA 30324',
    phone: '(404) 261-2325',
    website: 'https://tongueandgrooveatl.com',
    instagram: '@tonguegrooveatl',
    attributes: ['Nightclub', 'Live Music', 'Dress Code', '21+'],
    about: "Atlanta's iconic nightclub in a stunning 10,000 sq ft space. World-class DJs, live performances, and VIP bottle service every weekend.",
    media: [img('tongue1'), img('tongue2'), img('tongue3')],
    menuDescription: 'Full bar, bottle service, VIP packages',
    location: { latitude: 33.8095, longitude: -84.3677 },
    vibes: ['High Energy', 'Boujee'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'stats-brewpub',
    name: 'Stats Brewpub',
    category: 'Sports Bar · Brewpub',
    address: '300 Marietta St NW, Atlanta, GA 30313',
    phone: '(404) 885-1472',
    website: 'https://statsatlanta.com',
    instagram: '@statsatl',
    attributes: ['Sports Bar', 'Craft Beer', 'All Ages', 'Happy Hour'],
    about: 'Sports bar meets craft brewery in the heart of downtown Atlanta. 22 screens, 40+ taps, and a menu that goes way beyond bar food.',
    media: [img('stats1'), img('stats2'), img('stats3')],
    menuDescription: 'Craft beers, burgers, wings, brunch on weekends',
    location: { latitude: 33.7583, longitude: -84.3950 },
    vibes: ['Divey', 'High Energy'],
    isActive: true,
    isFeatured: false,
  },
  {
    id: 'ivy-buckhead',
    name: 'Ivy Buckhead',
    category: 'Upscale Lounge · Cocktail Bar',
    address: '48 Irby Ave NW, Atlanta, GA 30305',
    phone: '(404) 816-4690',
    website: 'https://ivybuckhead.com',
    instagram: '@ivybuckhead',
    attributes: ['Upscale', 'Cocktail Bar', 'Dress Code', 'Reservations'],
    about: "Buckhead's most sophisticated cocktail lounge. Curated spirits, handcrafted cocktails, and an intimate atmosphere perfect for special occasions.",
    media: [img('ivy1'), img('ivy2'), img('ivy3')],
    menuDescription: 'Handcrafted cocktails, wine, small plates',
    location: { latitude: 33.8387, longitude: -84.3800 },
    vibes: ['Boujee', 'Speakeasy'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'opera-atlanta',
    name: 'Opera Atlanta',
    category: 'Nightclub · EDM',
    address: '1150 Crescent Ave NE, Atlanta, GA 30309',
    phone: '(404) 874-3006',
    website: 'https://operaatlanta.com',
    instagram: '@operaatl',
    attributes: ['Nightclub', 'EDM', 'Bottle Service', '18+'],
    about: "Atlanta's largest and most celebrated nightclub. World-renowned DJs, state-of-the-art sound, and an unforgettable experience in a breathtaking venue.",
    media: [img('opera1'), img('opera2'), img('opera3')],
    menuDescription: 'Full bar, VIP tables, bottle service',
    location: { latitude: 33.7972, longitude: -84.3840 },
    vibes: ['High Energy', 'Boujee'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'ponce-city-market',
    name: 'Ponce City Market',
    category: 'Food Hall · Rooftop',
    address: '675 Ponce De Leon Ave NE, Atlanta, GA 30308',
    phone: '(404) 900-7900',
    website: 'https://poncecitymarket.com',
    instagram: '@poncecitymarket',
    attributes: ['Food Hall', 'Rooftop', 'All Ages', 'Outdoor'],
    about: 'Historic Sears building transformed into Atlanta\'s premier food and beverage destination. Rooftop bar, dozens of dining options, and stunning skyline views.',
    media: [img('ponce1'), img('ponce2'), img('ponce3')],
    menuDescription: 'Diverse food hall vendors, rooftop cocktails',
    location: { latitude: 33.7725, longitude: -84.3653 },
    vibes: ['Rooftop', 'High Energy'],
    isActive: true,
    isFeatured: false,
  },
  {
    id: 'elleven45-lounge',
    name: 'Elleven45 Lounge',
    category: 'Upscale Lounge · Hip Hop',
    address: '1145 Crescent Ave NE, Atlanta, GA 30309',
    phone: '(404) 724-9495',
    website: 'https://elleven45.com',
    instagram: '@elleven45atl',
    attributes: ['Hip Hop', 'Bottle Service', 'Dress Code', '21+'],
    about: "Midtown's hottest hip-hop and R&B lounge. Celebrity sightings, top-tier DJs, and a VIP experience that defines Atlanta nightlife.",
    media: [img('elleven1'), img('elleven2'), img('elleven3')],
    menuDescription: 'Premium bottles, craft cocktails, VIP sections',
    location: { latitude: 33.7962, longitude: -84.3838 },
    vibes: ['Boujee', 'High Energy'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'clermont-lounge',
    name: 'Clermont Lounge',
    category: 'Dive Bar · Entertainment',
    address: '789 Ponce de Leon Ave NE, Atlanta, GA 30306',
    phone: '(404) 874-4783',
    website: 'https://clermontlounge.net',
    instagram: '@clermontlounge',
    attributes: ['Dive Bar', 'Late Night', 'Cash Only', 'Iconic'],
    about: "Atlanta's most legendary dive bar. An institution since 1965 — unpretentious, unapologetic, and utterly unforgettable.",
    media: [img('clermont1'), img('clermont2'), img('clermont3')],
    menuDescription: 'Cold beer, well drinks, cash only',
    location: { latitude: 33.7717, longitude: -84.3638 },
    vibes: ['Divey', 'Late Night'],
    isActive: true,
    isFeatured: false,
  },
  {
    id: 'st-regis-bar',
    name: 'The Roof at St. Regis',
    category: 'Hotel Bar · Rooftop',
    address: '88 W Paces Ferry Rd NW, Atlanta, GA 30305',
    phone: '(404) 563-7900',
    website: 'https://stregisatlanta.com',
    instagram: '@stregisatlanta',
    attributes: ['Rooftop', 'Luxury', 'Hotel Bar', 'Dress Code'],
    about: 'The pinnacle of Atlanta rooftop dining and cocktails. Perched atop the St. Regis hotel in Buckhead with unparalleled views and impeccable service.',
    media: [img('stregis1'), img('stregis2'), img('stregis3')],
    menuDescription: 'Luxury cocktails, champagne, fine dining small plates',
    location: { latitude: 33.8472, longitude: -84.3871 },
    vibes: ['Boujee', 'Rooftop'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'darwin-cocktails',
    name: "Darwin's on Spring",
    category: 'Cocktail Bar · Speakeasy',
    address: '195 Spring St NW, Atlanta, GA 30303',
    phone: '(404) 835-8080',
    website: 'https://darwinsonspring.com',
    instagram: '@darwinsonspring',
    attributes: ['Craft Cocktails', 'Speakeasy', 'Happy Hour', 'Small Plates'],
    about: 'Hidden gem craft cocktail bar in downtown Atlanta. Award-winning bartenders, seasonal menus, and an intimate atmosphere that rewards discovery.',
    media: [img('darwin1'), img('darwin2'), img('darwin3')],
    menuDescription: 'Artisanal cocktails, curated spirits, charcuterie',
    location: { latitude: 33.7606, longitude: -84.3938 },
    vibes: ['Speakeasy', 'Boujee'],
    isActive: true,
    isFeatured: false,
  },
  {
    id: 'whiskey-bird',
    name: 'Whiskey Bird',
    category: 'Bar · Asian Fusion',
    address: '1409 N Highland Ave NE, Atlanta, GA 30306',
    phone: '(404) 996-6476',
    website: 'https://whiskeybird.com',
    instagram: '@whiskeybirdatl',
    attributes: ['Whiskey Bar', 'Late Night', 'Food', 'Virginia-Highland'],
    about: 'Virginia-Highland whiskey bar and Asian-inspired eatery. Extensive whiskey selection, great food, and a neighborhood vibe that keeps regulars coming back.',
    media: [img('whiskey1'), img('whiskey2'), img('whiskey3')],
    menuDescription: 'Whiskey flights, Asian fusion snacks, late night menu',
    location: { latitude: 33.7808, longitude: -84.3555 },
    vibes: ['Divey', 'Speakeasy'],
    isActive: true,
    isFeatured: false,
  },
  {
    id: 'herban-fix',
    name: 'Herban Fix Lounge',
    category: 'Lounge · Vegan',
    address: 'variableHerban, Atlanta, GA',
    phone: '(404) 875-0123',
    website: 'https://herbanfix.com',
    instagram: '@herbanfixatl',
    attributes: ['Vegan', 'Lounge', 'Live Music', 'Midtown'],
    about: 'Atlanta\'s premier vegan lounge experience. Creative plant-based cocktails, live jazz, and an ambiance that defies expectations.',
    media: [img('herban1'), img('herban2'), img('herban3')],
    menuDescription: 'Vegan cocktails, plant-based small plates, mocktails',
    location: { latitude: 33.7812, longitude: -84.3840 },
    vibes: ['Speakeasy', 'Boujee'],
    isActive: true,
    isFeatured: false,
  },
  {
    id: 'mbar',
    name: 'MBar',
    category: 'Rooftop Bar · Marriott',
    address: '265 Peachtree Center Ave, Atlanta, GA 30303',
    phone: '(404) 521-0000',
    website: 'https://marriott.com/mbar',
    instagram: '@mbardtlatl',
    attributes: ['Rooftop', 'Hotel Bar', 'Skyline Views', 'Cocktails'],
    about: 'Perched on the 50th floor of the Marriott Marquis, MBar offers the most dramatic downtown Atlanta skyline views with expertly crafted cocktails.',
    media: [img('mbar1'), img('mbar2'), img('mbar3')],
    menuDescription: 'Sky-high cocktails, wines, light bites',
    location: { latitude: 33.7594, longitude: -84.3882 },
    vibes: ['Boujee', 'Rooftop'],
    isActive: true,
    isFeatured: true,
  },
  {
    id: 'age-bar',
    name: 'Age Bar',
    category: 'Cocktail Bar · Live DJ',
    address: '327 Edgewood Ave SE, Atlanta, GA 30312',
    phone: '(404) 835-8765',
    website: 'https://agebar.atl',
    instagram: '@agebar_atl',
    attributes: ['Craft Cocktails', 'DJ', 'Late Night', 'Old Fourth Ward'],
    about: 'Old Fourth Ward\'s coolest cocktail bar. Rotating local DJs, creative seasonal cocktails, and a laid-back vibe that attracts Atlanta\'s creative class.',
    media: [img('agebar1'), img('agebar2'), img('agebar3')],
    menuDescription: 'Craft cocktails, local beers, late night bites',
    location: { latitude: 33.7524, longitude: -84.3712 },
    vibes: ['High Energy', 'Divey'],
    isActive: true,
    isFeatured: false,
  },
];

// ── EVENTS ──────────────────────────────────────────────────────────
const events = [
  {
    id: 'euphoria-fridays',
    title: 'Euphoria Fridays',
    venueId: 'skylounge-atl',
    venueName: 'SkyLounge ATL',
    date: 'FRI MAR 21',
    time: '10 PM',
    age: '21+',
    about: 'The most immersive Friday night rooftop experience in Atlanta. World-class DJs, bottle service, and panoramic city views.',
    media: [img('euphoria1', 800, 1000), img('euphoria2', 800, 1000)],
    ticketUrl: 'https://wugi.app/tickets/euphoria-fridays',
    isActive: true,
    isFeatured: true,
    tags: ['Rooftop', 'DJ', 'Bottle Service'],
  },
  {
    id: 'bottle-wars-sundays',
    title: 'Bottle Wars Sundays',
    venueId: 'nite-owl',
    venueName: 'Nite Owl Kitchen & Cocktails',
    date: 'SUN MAR 23',
    time: '8 PM',
    age: '21+',
    about: "Atlanta's most legendary Sunday night experience. Tables compete for the best presentation, the crowd votes, and everyone wins.",
    media: [img('bottlewars1', 800, 1000)],
    ticketUrl: 'https://wugi.app/tickets/bottle-wars',
    isActive: true,
    isFeatured: true,
    tags: ['Sunday', 'Bottle Service', 'Competition'],
  },
  {
    id: 'atl-rooftop-social',
    title: 'ATL Rooftop Social',
    venueId: 'ponce-city-market',
    venueName: 'Ponce City Market',
    date: 'SAT MAR 22',
    time: '7 PM',
    age: '21+',
    about: "Atlanta's premier rooftop social mixer. Meet Atlanta's most interesting people with drinks in hand and the city below.",
    media: [img('rooftopsocial1', 800, 1000)],
    ticketUrl: 'https://wugi.app/tickets/atl-rooftop-social',
    isActive: true,
    isFeatured: true,
    tags: ['Social', 'Rooftop', 'Mixer'],
  },
  {
    id: 'ladies-night-ivy',
    title: 'Ladies Night',
    venueId: 'ivy-buckhead',
    venueName: 'Ivy Buckhead',
    date: 'FRI MAR 28',
    time: '9 PM',
    age: '21+',
    about: 'Ladies get in free before 11PM with complimentary welcome cocktails. ATL\'s most anticipated weekly ladies night.',
    media: [img('ladiesnite1', 800, 1000)],
    ticketUrl: 'https://wugi.app/tickets/ladies-night-ivy',
    isActive: true,
    isFeatured: false,
    tags: ['Ladies Night', 'Free Entry', 'Cocktails'],
  },
  {
    id: 'sunday-funday-brunch',
    title: 'Sunday Funday Brunch',
    venueId: 'stats-brewpub',
    venueName: 'Stats Brewpub',
    date: 'SUN MAR 23',
    time: '11 AM',
    age: 'All Ages',
    about: "Atlanta's favorite Sunday brunch experience. Bottomless mimosas, live DJ, and the best brunch menu in the city.",
    media: [img('brunch1', 800, 1000)],
    ticketUrl: 'https://wugi.app/tickets/sunday-funday',
    isActive: true,
    isFeatured: false,
    tags: ['Brunch', 'Bottomless', 'DJ'],
  },
  {
    id: 'opera-saturdays',
    title: 'Opera Saturdays',
    venueId: 'opera-atlanta',
    venueName: 'Opera Atlanta',
    date: 'SAT MAR 22',
    time: '10 PM',
    age: '18+',
    about: "The biggest Saturday night in Atlanta. International DJs, 3 rooms of music, and 2,000+ of Atlanta's finest.",
    media: [img('opera1', 800, 1000)],
    ticketUrl: 'https://wugi.app/tickets/opera-saturdays',
    isActive: true,
    isFeatured: true,
    tags: ['EDM', 'Nightclub', 'DJ'],
  },
  {
    id: 'hip-hop-fridays-elleven',
    title: 'Hip Hop Fridays',
    venueId: 'elleven45-lounge',
    venueName: 'Elleven45 Lounge',
    date: 'FRI MAR 21',
    time: '9 PM',
    age: '21+',
    about: "Midtown's hottest hip-hop and R&B night. Celebrity appearances, top ATL DJs, and a crowd that sets the standard.",
    media: [img('hiphopfriday1', 800, 1000)],
    ticketUrl: 'https://wugi.app/tickets/hiphop-fridays',
    isActive: true,
    isFeatured: true,
    tags: ['Hip Hop', 'R&B', 'VIP'],
  },
  {
    id: 'speakeasy-thursdays',
    title: 'Speakeasy Thursdays',
    venueId: 'darwin-cocktails',
    venueName: "Darwin's on Spring",
    date: 'THU MAR 20',
    time: '8 PM',
    age: '21+',
    about: 'Secret menu, live jazz, and craft cocktails made with prohibition-era techniques. Atlanta\'s most intimate Thursday night experience.',
    media: [img('speakeasy1', 800, 1000)],
    ticketUrl: 'https://wugi.app/tickets/speakeasy-thursdays',
    isActive: true,
    isFeatured: false,
    tags: ['Speakeasy', 'Jazz', 'Craft Cocktails'],
  },
];

// ── DEALS ──────────────────────────────────────────────────────────
const deals = [
  {
    id: 'nite-owl-happy-hour',
    title: 'Half Off Bottles',
    venueId: 'nite-owl',
    venueName: 'Nite Owl Kitchen & Cocktails',
    detail: 'Before 9 PM tonight',
    image: img('deal1'),
    isActive: true,
  },
  {
    id: 'ivy-ladies-free',
    title: 'Ladies Drink Free',
    venueId: 'ivy-buckhead',
    venueName: 'Ivy Buckhead',
    detail: 'Before 11 PM Fridays',
    image: img('deal2'),
    isActive: true,
  },
  {
    id: 'skylounge-happy-hour',
    title: '2-for-1 Cocktails',
    venueId: 'skylounge-atl',
    venueName: 'SkyLounge ATL',
    detail: 'Happy Hour 4–7 PM',
    image: img('deal3'),
    isActive: true,
  },
  {
    id: 'stats-brunch-deal',
    title: 'Bottomless Mimosas $25',
    venueId: 'stats-brewpub',
    venueName: 'Stats Brewpub',
    detail: 'Every Sunday 11AM–3PM',
    image: img('deal4'),
    isActive: true,
  },
  {
    id: 'clermont-cheap-beer',
    title: '$3 Beers All Night',
    venueId: 'clermont-lounge',
    venueName: 'Clermont Lounge',
    detail: 'Every night, cash only',
    image: img('deal5'),
    isActive: true,
  },
];

// ── SEED FUNCTION ──────────────────────────────────────────────────
async function seed() {
  console.log('🌱 Starting Wugi seed...\n');

  // Seed venues
  console.log(`📍 Seeding ${venues.length} venues...`);
  for (const venue of venues) {
    const { id, ...data } = venue;
    await db.collection('venues').doc(id).set({
      ...data,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`  ✅ ${venue.name}`);
  }

  // Seed events
  console.log(`\n🎉 Seeding ${events.length} events...`);
  for (const event of events) {
    const { id, ...data } = event;
    await db.collection('events').doc(id).set({
      ...data,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`  ✅ ${event.title}`);
  }

  // Seed deals
  console.log(`\n💰 Seeding ${deals.length} deals...`);
  for (const deal of deals) {
    const { id, ...data } = deal;
    await db.collection('deals').doc(id).set({
      ...data,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`  ✅ ${deal.title}`);
  }

  console.log('\n🎊 Seed complete!');
  console.log(`   ${venues.length} venues`);
  console.log(`   ${events.length} events`);
  console.log(`   ${deals.length} deals`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
