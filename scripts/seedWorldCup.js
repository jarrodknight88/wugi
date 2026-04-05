// ─────────────────────────────────────────────────────────────────────
// Wugi — seed World Cup launch events + Teranga City
// ─────────────────────────────────────────────────────────────────────
const admin = require('/Users/jarrod/Documents/GitHub/wugi/node_modules/firebase-admin');
const sa    = require('/Users/jarrod/Documents/GitHub/wugi/scripts/serviceAccount.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db = admin.firestore();
const now = admin.firestore.FieldValue.serverTimestamp();

async function main() {

  // ── 1. Teranga City venue ───────────────────────────────────────────
  const teranga = await upsertVenue('teranga-city', {
    name:        'Teranga City',
    category:    'African Cuisine & Nightlife',
    address:     '789 Ralph David Abernathy Blvd SW, Atlanta, GA 30310',
    phone:       '(404) 555-0192',
    website:     'https://terangacity.com',
    instagram:   'terangacity',
    attributes:  ['Full Bar','Live Music','DJ','Private Events','VIP Tables','Outdoor Patio'],
    vibes:       ['High Energy','Boujee','Late Night'],
    about:       'Atlanta\'s premier West African dining and nightlife destination. World-class cocktails, authentic cuisine, and electric DJ nights.',
    neighborhood: 'West End',
    neighborhoodSlug: 'west-end',
    status:      'approved',
    isClaimed:   true,
    claimedBy:   'jarrod.knight88@gmail.com',
    payoutTier:  1,
    media:       [
      'https://picsum.photos/seed/teranga1/800/600',
      'https://picsum.photos/seed/teranga2/800/600',
    ],
    rating:      4.7,
    priceLevel:  '$$',
    isActive:    true,
    isFeatured:  true,
  });

  // ── 2. World Cup watch party events at Teranga ──────────────────────
  const wcEvents = [
    { title: 'FIFA World Cup Opening Watch Party 🌍',    date: 'MON JUN 9',  time: '5:00 PM', vibes: ['High Energy','Late Night'] },
    { title: 'USA vs Morocco Watch Party 🇺🇸',           date: 'SAT JUN 14', time: '3:00 PM', vibes: ['High Energy'] },
    { title: 'World Cup Quarter Final Watch Party ⚽',    date: 'FRI JUL 4',  time: '2:00 PM', vibes: ['High Energy','Boujee'] },
    { title: 'World Cup Semi-Final Watch Party 🏆',       date: 'TUE JUL 8',  time: '2:00 PM', vibes: ['High Energy','Boujee'] },
    { title: 'FIFA World Cup Final Watch Party 🏆🎉',     date: 'SUN JUL 19', time: '11:00 AM', vibes: ['High Energy','Boujee','Late Night'] },
  ];

  for (const e of wcEvents) {
    await upsertEvent(`${slugify(e.title)}-teranga`, {
      title:    e.title,
      venue:    'Teranga City',
      venueId:  teranga,
      date:     e.date,
      time:     e.time,
      age:      '21+',
      about:    `Join us at Teranga City for the ultimate World Cup watch experience. Premium bar service, VIP tables available, authentic West African cuisine. Atlanta\'s best spot to watch the beautiful game.`,
      vibes:    e.vibes,
      status:   'approved',
      hasTickets: true,
      media:    [{ type: 'image', uri: `https://picsum.photos/seed/${slugify(e.title)}/800/1000` }],
    });
    console.log('✅ Event:', e.title);
  }

  // ── 3. Additional Atlanta nightlife events ──────────────────────────
  const otherEvents = [
    {
      id: 'fridayz-atlanta-apr-11',
      title: 'Fridayz ATL 🔥', venue: 'Clermont Lounge', date: 'FRI APR 11', time: '10:00 PM',
      vibes: ['High Energy', 'Late Night', 'Divey'],
    },
    {
      id: 'sunday-social-apr-13',
      title: 'Sunday Social Rooftop', venue: 'Happy Hour ATL', date: 'SUN APR 13', time: '2:00 PM',
      vibes: ['Rooftop', 'Boujee'],
    },
    {
      id: 'speakeasy-thursday-apr-10',
      title: 'The Speakeasy Sessions', venue: 'After Eight', date: 'THU APR 10', time: '9:00 PM',
      vibes: ['Speakeasy', 'Boujee'],
    },
  ];

  for (const e of otherEvents) {
    await upsertEvent(e.id, {
      title: e.title, venue: e.venue, venueId: slugify(e.venue),
      date: e.date, time: e.time, age: '21+',
      about: `One of Atlanta\'s premier nightlife events. ${e.title} delivers an unmatched experience every week.`,
      vibes: e.vibes, status: 'approved', hasTickets: false,
      media: [{ type: 'image', uri: `https://picsum.photos/seed/${e.id}/800/1000` }],
    });
    console.log('✅ Event:', e.title);
  }

  console.log('\n🎉 Seed complete!');
  process.exit(0);
}

async function upsertVenue(id, data) {
  await db.collection('venues').doc(id).set({
    ...data, createdAt: now, updatedAt: now,
    slug: id, market: 'atlanta', previousSlugs: [],
  }, { merge: true });
  console.log('✅ Venue:', data.name);
  return id;
}

async function upsertEvent(id, data) {
  await db.collection('events').doc(id).set({
    ...data, createdAt: now, updatedAt: now,
    galleryId: null,
  }, { merge: true });
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

main().catch(e => { console.error(e); process.exit(1); });
