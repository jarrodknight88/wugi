const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function seed() {
  console.log('🌱 Seeding wugi-prod...');

  // ── Venues ────────────────────────────────────────────────────────
  const venues = [
    {
      id: 'venue_niteowl',
      name: 'Nite Owl Kitchen & Cocktails',
      category: 'Bar · Kitchen · Late Night',
      address: '6 Olive Street, Avondale Estates, GA 30002',
      phone: '(678) 925-4418',
      website: 'https://niteowlatl.com',
      instagram: '@niteowlatl',
      attributes: ['Open Late', 'Kid Friendly', 'Pet Friendly', 'Happy Hour'],
      vibes: ['Divey', 'Late Night'],
      about: 'Serves Happy Hour Food · Serves Great Cocktails · Late Night Kitchen.',
      media: [
        'https://picsum.photos/seed/venue1/800/600',
        'https://picsum.photos/seed/venue2/800/600',
        'https://picsum.photos/seed/venue3/800/600',
      ],
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      id: 'venue_skylounge',
      name: 'SkyLounge ATL',
      category: 'Rooftop Bar · Lounge',
      address: '3390 Peachtree Rd NE, Atlanta, GA 30326',
      phone: '(404) 555-0101',
      website: 'https://skyloungedatl.com',
      instagram: '@skyloungedatl',
      attributes: ['Rooftop', 'Bottle Service', 'Dress Code', 'Open Late'],
      vibes: ['Boujee', 'Rooftop'],
      about: "Atlanta's premier rooftop lounge with panoramic city views.",
      media: [
        'https://picsum.photos/seed/fv1/800/600',
        'https://picsum.photos/seed/fv1b/800/600',
      ],
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      id: 'venue_tonguegroove',
      name: 'Tongue & Groove',
      category: 'Nightclub',
      address: '565 Main Street NE, Atlanta, GA 30324',
      phone: '(404) 555-0202',
      website: 'https://tongueandgrooveatl.com',
      instagram: '@tonguegrooveatl',
      attributes: ['Nightclub', 'Live Music', 'Dress Code', '21+'],
      vibes: ['High Energy', 'Late Night'],
      about: "Atlanta's iconic nightclub.",
      media: [
        'https://picsum.photos/seed/fv2/800/600',
        'https://picsum.photos/seed/fv2b/800/600',
      ],
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      id: 'venue_ivybuckhead',
      name: 'Ivy Buckhead',
      category: 'Lounge · Bar',
      address: '48 Irby Ave NW, Atlanta, GA 30305',
      phone: '(404) 555-0303',
      website: 'https://ivybuckhead.com',
      instagram: '@ivybuckhead',
      attributes: ['Upscale', 'Cocktails', 'Dress Code', '21+'],
      vibes: ['Boujee', 'Speakeasy'],
      about: "Buckhead's most intimate upscale lounge.",
      media: [
        'https://picsum.photos/seed/ivy1/800/600',
        'https://picsum.photos/seed/ivy2/800/600',
      ],
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      id: 'venue_ponce',
      name: 'Ponce City Market',
      category: 'Venue · Rooftop · Event Space',
      address: '675 Ponce De Leon Ave NE, Atlanta, GA 30308',
      phone: '(404) 900-7900',
      website: 'https://poncecitymarket.com',
      instagram: '@poncecitymarket',
      attributes: ['Rooftop', 'Events', 'All Ages', 'Outdoor'],
      vibes: ['Rooftop', 'High Energy'],
      about: "Atlanta's vibrant mixed-use destination with rooftop events.",
      media: [
        'https://picsum.photos/seed/pcm1/800/600',
        'https://picsum.photos/seed/pcm2/800/600',
      ],
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      id: 'venue_stats',
      name: 'Stats Brewpub',
      category: 'Brewpub · Sports Bar',
      address: '300 Marietta St NW, Atlanta, GA 30313',
      phone: '(404) 555-0404',
      website: 'https://statsatl.com',
      instagram: '@statsatl',
      attributes: ['Sports Bar', 'Craft Beer', 'Brunch', 'All Ages'],
      vibes: ['Divey', 'High Energy'],
      about: "Craft beers and elevated bar food in the heart of downtown Atlanta.",
      media: [
        'https://picsum.photos/seed/stats1/800/600',
        'https://picsum.photos/seed/stats2/800/600',
      ],
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  ];

  for (const venue of venues) {
    const { id, ...data } = venue;
    await db.collection('venues').doc(id).set(data);
    console.log(`✅ Venue: ${data.name}`);
  }

  // ── Events ────────────────────────────────────────────────────────
  const events = [
    {
      id: 'event_euphoria',
      title: 'Euphoria Fridays',
      venue: 'SkyLounge ATL',
      venueId: 'venue_skylounge',
      date: 'FRI MAR 21',
      time: '10 PM',
      age: '21+',
      about: "The most immersive Friday night experience in Atlanta. Featuring the city's top DJs, rooftop views, and bottle service.",
      vibes: ['Boujee', 'Rooftop'],
      media: [
        { type: 'image', uri: 'https://picsum.photos/seed/ev1a/800/1000' },
        { type: 'image', uri: 'https://picsum.photos/seed/ev1b/800/1000' },
        { type: 'video', uri: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
        { type: 'image', uri: 'https://picsum.photos/seed/ev1c/800/1000' },
      ],
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      id: 'event_bottlewars',
      title: 'Bottle Wars Sundays',
      venue: 'Nite Owl Kitchen',
      venueId: 'venue_niteowl',
      date: 'SUN MAR 23',
      time: '8 PM',
      age: '21+',
      about: "Atlanta's most legendary Sunday night experience.",
      vibes: ['Divey', 'Late Night'],
      media: [
        { type: 'image', uri: 'https://picsum.photos/seed/ev2a/800/1000' },
      ],
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      id: 'event_rooftop',
      title: 'ATL Rooftop Social',
      venue: 'Ponce City Market',
      venueId: 'venue_ponce',
      date: 'SAT MAR 22',
      time: '7 PM',
      age: '21+',
      about: "Atlanta's premier rooftop social event.",
      vibes: ['Rooftop', 'High Energy'],
      media: [
        { type: 'image', uri: 'https://picsum.photos/seed/ev3a/800/1000' },
      ],
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      id: 'event_brunch',
      title: 'Sunday Funday Brunch',
      venue: 'Stats Brewpub',
      venueId: 'venue_stats',
      date: 'SUN MAR 23',
      time: '11 AM',
      age: 'All Ages',
      about: "Atlanta's favorite Sunday brunch experience.",
      vibes: ['Divey', 'High Energy'],
      media: [
        { type: 'image', uri: 'https://picsum.photos/seed/ev4a/800/1000' },
      ],
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      id: 'event_ladies',
      title: 'Ladies Night',
      venue: 'Ivy Buckhead',
      venueId: 'venue_ivybuckhead',
      date: 'FRI MAR 28',
      time: '9 PM',
      age: '21+',
      about: 'Ladies get in free before 11PM. Premium cocktails and live DJ.',
      vibes: ['Boujee', 'Speakeasy'],
      media: [
        { type: 'image', uri: 'https://picsum.photos/seed/ev5a/800/1000' },
        { type: 'image', uri: 'https://picsum.photos/seed/ev5b/800/1000' },
      ],
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      id: 'event_worldcup',
      title: 'FIFA World Cup Watch Party',
      venue: 'SkyLounge ATL',
      venueId: 'venue_skylounge',
      date: 'MON JUN 9',
      time: '2 PM',
      age: '21+',
      about: "Watch the World Cup opener from Atlanta's best rooftop. Bottle service, international food menu, and massive screens.",
      vibes: ['Boujee', 'Rooftop', 'High Energy'],
      media: [
        { type: 'image', uri: 'https://picsum.photos/seed/wc1/800/1000' },
        { type: 'image', uri: 'https://picsum.photos/seed/wc2/800/1000' },
      ],
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      id: 'event_speakeasy',
      title: 'Secret Speakeasy Night',
      venue: 'Ivy Buckhead',
      venueId: 'venue_ivybuckhead',
      date: 'SAT MAR 29',
      time: '10 PM',
      age: '21+',
      about: "A prohibition-era experience. Password at the door, craft cocktails, live jazz.",
      vibes: ['Speakeasy', 'Boujee'],
      media: [
        { type: 'image', uri: 'https://picsum.photos/seed/sp1/800/1000' },
      ],
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      id: 'event_highvoltage',
      title: 'High Voltage Saturdays',
      venue: 'Tongue & Groove',
      venueId: 'venue_tonguegroove',
      date: 'SAT MAR 29',
      time: '11 PM',
      age: '21+',
      about: "Atlanta's highest energy Saturday night. Top national DJs, light shows, and a crowd that never sleeps.",
      vibes: ['High Energy', 'Late Night'],
      media: [
        { type: 'image', uri: 'https://picsum.photos/seed/hv1/800/1000' },
        { type: 'image', uri: 'https://picsum.photos/seed/hv2/800/1000' },
      ],
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  ];

  for (const event of events) {
    const { id, ...data } = event;
    await db.collection('events').doc(id).set(data);
    console.log(`✅ Event: ${data.title}`);
  }

  // ── Deals ────────────────────────────────────────────────────────
  const deals = [
    {
      id: 'deal_halfbottles',
      title: 'Half Off Bottles',
      venueName: 'Nite Owl Kitchen & Cocktails',
      venueId: 'venue_niteowl',
      detail: 'Before 9 PM tonight',
      image: 'https://picsum.photos/seed/deal1/600/400',
      vibes: ['Divey', 'Late Night'],
      expiresAt: admin.firestore.Timestamp.fromDate(new Date('2026-12-31')),
    },
    {
      id: 'deal_ladiesfree',
      title: 'Ladies Drink Free',
      venueName: 'Tongue & Groove',
      venueId: 'venue_tonguegroove',
      detail: 'Before 11 PM Fridays',
      image: 'https://picsum.photos/seed/deal2/600/400',
      vibes: ['High Energy', 'Late Night'],
      expiresAt: admin.firestore.Timestamp.fromDate(new Date('2026-12-31')),
    },
    {
      id: 'deal_happyhour',
      title: '2-for-1 Cocktails',
      venueName: 'SkyLounge ATL',
      venueId: 'venue_skylounge',
      detail: 'Happy Hour 4–7 PM',
      image: 'https://picsum.photos/seed/deal3/600/400',
      vibes: ['Boujee', 'Rooftop'],
      expiresAt: admin.firestore.Timestamp.fromDate(new Date('2026-12-31')),
    },
    {
      id: 'deal_speakeasy',
      title: 'Complimentary Welcome Drink',
      venueName: 'Ivy Buckhead',
      venueId: 'venue_ivybuckhead',
      detail: 'Show Wugi app at door',
      image: 'https://picsum.photos/seed/deal4/600/400',
      vibes: ['Speakeasy', 'Boujee'],
      expiresAt: admin.firestore.Timestamp.fromDate(new Date('2026-12-31')),
    },
    {
      id: 'deal_brunch',
      title: 'Free Mimosa with Brunch',
      venueName: 'Stats Brewpub',
      venueId: 'venue_stats',
      detail: 'Weekends 11 AM – 2 PM',
      image: 'https://picsum.photos/seed/deal5/600/400',
      vibes: ['Divey', 'High Energy'],
      expiresAt: admin.firestore.Timestamp.fromDate(new Date('2026-12-31')),
    },
  ];

  for (const deal of deals) {
    const { id, ...data } = deal;
    await db.collection('deals').doc(id).set(data);
    console.log(`✅ Deal: ${data.title}`);
  }

  console.log('\n🎉 Seeding complete!');
  console.log('Collections seeded: venues, events, deals');
  console.log('All documents include vibes[] field for personalization queries');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seed error:', err);
  process.exit(1);
});
