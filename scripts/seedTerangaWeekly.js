// ─────────────────────────────────────────────────────────────────────
// Wugi — seedTerangaWeekly.js
// Seeds real weekly recurring events for Teranga City Brookhaven
// Based on confirmed Eventbrite listings + social media programming
// Run: node scripts/seedTerangaWeekly.js
// ─────────────────────────────────────────────────────────────────────
const admin = require('/Users/jarrod/Documents/GitHub/wugi/node_modules/firebase-admin');
const sa    = require('/Users/jarrod/Documents/GitHub/wugi/scripts/serviceAccount.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db  = admin.firestore();
const now = admin.firestore.FieldValue.serverTimestamp();

const VENUE_ID   = 'teranga-city-brookhaven';
const VENUE_NAME = 'Teranga City';

// Unsplash photos matched to vibe — no copyright issues
const PHOTOS = {
  afrobeats:  'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1200&q=80',
  happyhour:  'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=1200&q=80',
  djnight:    'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=1200&q=80',
  brunch:     'https://images.unsplash.com/photo-1533777857889-4be7c70b33f7?w=1200&q=80',
  rnb:        'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1200&q=80',
};

// Ticket types shared across events
const TICKET_TYPES = [
  { id:'general-admission', name:'General Admission', description:'Entry to the event.', price:2500, capacity:200, remaining:200, sold:0, active:true, isFree:false, status:'on_sale', maxPerOrder:10, tableCapacity:null, sortOrder:1 },
  { id:'vip-table-4', name:'VIP Table (4 Guests)', description:'Reserved VIP table for 4 with bottle service and priority entry.', price:40000, capacity:10, remaining:10, sold:0, active:true, isFree:false, status:'on_sale', maxPerOrder:1, tableCapacity:4, sortOrder:2 },
  { id:'vip-table-8', name:'VIP Table (8 Guests)', description:'Reserved VIP table for 8 with two bottle selections and priority entry.', price:75000, capacity:5, remaining:5, sold:0, active:true, isFree:false, status:'on_sale', maxPerOrder:1, tableCapacity:8, sortOrder:3 },
];

// Generate next N occurrences of a given day of week (0=Sun, 1=Mon...6=Sat)
// starting from today
function nextOccurrences(dayOfWeek, count = 6) {
  const dates = [];
  const today = new Date();
  let d = new Date(today);
  // Find first occurrence on or after today
  while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
  for (let i = 0; i < count; i++) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return dates;
}

function formatDate(d) {
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${days[d.getDay()].toUpperCase()} ${months[d.getMonth()]} ${d.getDate()}`;
}

function formatDateISO(d) {
  return d.toISOString().split('T')[0];
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function seedEvent(eventData, ticketTypes) {
  const ref = db.collection('events').doc(eventData.id);
  await ref.set({
    ...eventData,
    venueName:  VENUE_NAME,
    venueId:    VENUE_ID,
    slug:       eventData.id,
    age:        '21+',
    status:     'approved',
    hasTickets: true,
    isFeatured: true,
    isRecurring: true,
    market:     'atlanta',
    galleryId:  null,
    createdAt:  now,
    updatedAt:  now,
  }, { merge: true });

  for (const tt of ticketTypes) {
    await ref.collection('ticketTypes').doc(tt.id).set({
      ...tt, eventId: eventData.id, venueId: VENUE_ID, createdAt: now, updatedAt: now,
    }, { merge: true });
  }
  console.log(`✅ ${eventData.title} (${eventData.date})`);
}

async function main() {
  console.log('🌍 Seeding Teranga City weekly recurring events...\n');

  // ── WEDNESDAY: World Wide Wednesdays ─────────────────────────────
  // Confirmed on Eventbrite: Afrobeats, Amapiano, Hip-Hop, Reggae, 9PM-2AM
  console.log('📅 World Wide Wednesdays (Wed):');
  for (const d of nextOccurrences(3, 8)) {
    await seedEvent({
      id:       `world-wide-wednesdays-teranga-${formatDateISO(d)}`,
      title:    'World Wide Wednesdays 🌍',
      date:     formatDate(d),
      dateISO:  formatDateISO(d),
      time:     '9:00 PM',
      endTime:  '2:00 AM',
      about:    "Every Wednesday night, Teranga City turns into a global dancefloor. Afrobeats, Amapiano, Hip Hop, and Reggae — take a midweek trip around the world without leaving Atlanta. High-energy music from 9PM–2AM with cocktail specials and food all night. VIP tables available — call 678-488-8004 to reserve.",
      vibes:    ['Afrobeats','High Energy','Late Night','Global'],
      media:    [{ type:'image', uri: PHOTOS.afrobeats }],
      sortOrder: 1,
    }, TICKET_TYPES);
  }

  // ── THURSDAY: $5 R&B Happy Hour (Ladies Night) ───────────────────
  // Confirmed on Eventbrite: Free entry, $5 R&B Thursday, Ladies Night
  console.log('\n📅 $5 R&B Thursday Happy Hour (Thu):');
  for (const d of nextOccurrences(4, 8)) {
    await seedEvent({
      id:       `rnb-thursday-teranga-${formatDateISO(d)}`,
      title:    '$5 R&B Thursday Happy Hour 🎶',
      date:     formatDate(d),
      dateISO:  formatDateISO(d),
      time:     '5:00 PM',
      endTime:  '9:00 PM',
      about:    "The best ladies night in Brookhaven. $5 R&B Thursday Happy Hour at Teranga City — cocktail specials, R&B vibes, and good energy all night. Free entry. $1 wings, $5 lamb chops, and $5 drinks during happy hour.",
      vibes:    ['R&B','Ladies Night','Happy Hour'],
      media:    [{ type:'image', uri: PHOTOS.rnb }],
      sortOrder: 2,
    }, [
      // Thursday is free entry — override ticket types
      { id:'free-entry', name:'Free Entry', description:'No ticket required. Free admission.', price:0, capacity:300, remaining:300, sold:0, active:true, isFree:true, status:'on_sale', maxPerOrder:10, tableCapacity:null, sortOrder:1 },
      TICKET_TYPES[1], // VIP Table 4
      TICKET_TYPES[2], // VIP Table 8
    ]);
  }

  // ── FRIDAY: Happy Hour 5PM-9PM ───────────────────────────────────
  console.log('\n📅 Friday Happy Hour (Fri 5PM-9PM):');
  for (const d of nextOccurrences(5, 8)) {
    await seedEvent({
      id:       `friday-happy-hour-teranga-${formatDateISO(d)}`,
      title:    'Friday Happy Hour at Teranga 🍹',
      date:     formatDate(d),
      dateISO:  formatDateISO(d),
      time:     '5:00 PM',
      endTime:  '9:00 PM',
      about:    "Start your Friday right at Teranga City Brookhaven. Extended happy hour from 5PM–9PM — $1 wings, $5 lamb chops, $5 drinks, and $15 hookah. Best happy hour in Brookhaven before the DJ takes over at 9PM.",
      vibes:    ['Happy Hour','High Energy'],
      media:    [{ type:'image', uri: PHOTOS.happyhour }],
      sortOrder: 3,
    }, [
      { id:'free-entry', name:'Free Entry', description:'Free admission during happy hour.', price:0, capacity:300, remaining:300, sold:0, active:true, isFree:true, status:'on_sale', maxPerOrder:10, tableCapacity:null, sortOrder:1 },
      TICKET_TYPES[1],
      TICKET_TYPES[2],
    ]);
  }

  // ── FRIDAY: DJ Night 9PM-2AM ─────────────────────────────────────
  console.log('\n📅 Friday Night Vibes (Fri 9PM):');
  for (const d of nextOccurrences(5, 8)) {
    await seedEvent({
      id:       `friday-night-vibes-teranga-${formatDateISO(d)}`,
      title:    'Friday Night Vibes at Teranga 🔥',
      date:     formatDate(d),
      dateISO:  formatDateISO(d),
      time:     '9:00 PM',
      endTime:  '2:00 AM',
      about:    "Friday nights at Teranga City are unmatched. DJ spinning Afrobeats, Amapiano, R&B, and Hip-Hop until 2AM. Full bar, premium hookah, and VIP tables. Late-night food menu available all night. This is the spot.",
      vibes:    ['High Energy','Late Night','Afrobeats','DJ'],
      media:    [{ type:'image', uri: PHOTOS.djnight }],
      sortOrder: 4,
    }, TICKET_TYPES);
  }

  // ── SATURDAY: Seafood Brunch 12PM-7PM ────────────────────────────
  console.log('\n📅 Saturday Seafood Brunch (Sat 12PM-7PM):');
  for (const d of nextOccurrences(6, 8)) {
    await seedEvent({
      id:       `saturday-seafood-brunch-teranga-${formatDateISO(d)}`,
      title:    'Saturday Seafood Brunch 🦐🥂',
      date:     formatDate(d),
      dateISO:  formatDateISO(d),
      time:     '12:00 PM',
      endTime:  '7:00 PM',
      about:    "Atlanta's best seafood brunch is every Saturday at Teranga City. Garlic shrimp trays from $15, crab legs $20, crab & shrimp trays $30, lobster crab & shrimp $80. French toast, eggs, bottomless cocktails, and great music from noon to 7PM. Come hungry.",
      vibes:    ['Brunch','Boujee','Seafood'],
      media:    [{ type:'image', uri: PHOTOS.brunch }],
      sortOrder: 5,
    }, [
      { id:'brunch-admission', name:'Brunch Entry', description:'Entry to the Saturday seafood brunch.', price:1500, capacity:200, remaining:200, sold:0, active:true, isFree:false, status:'on_sale', maxPerOrder:10, tableCapacity:null, sortOrder:1 },
      TICKET_TYPES[1],
      TICKET_TYPES[2],
    ]);
  }

  // ── SUNDAY: Weekend Brunch 12PM-7PM ──────────────────────────────
  console.log('\n📅 Sunday Brunch (Sun 12PM-7PM):');
  for (const d of nextOccurrences(0, 8)) {
    await seedEvent({
      id:       `sunday-brunch-teranga-${formatDateISO(d)}`,
      title:    'Sunday Brunch at Teranga 🥞',
      date:     formatDate(d),
      dateISO:  formatDateISO(d),
      time:     '12:00 PM',
      endTime:  '7:00 PM',
      about:    "Sundays are for brunch and Teranga does it best. West African flavors meet classic American brunch staples — plus cocktails, hookah, and good music to close out your weekend right. Noon to 7PM every Sunday.",
      vibes:    ['Brunch','Chill','Boujee'],
      media:    [{ type:'image', uri: PHOTOS.brunch }],
      sortOrder: 6,
    }, [
      { id:'brunch-admission', name:'Brunch Entry', description:'Entry to the Sunday brunch.', price:1500, capacity:200, remaining:200, sold:0, active:true, isFree:false, status:'on_sale', maxPerOrder:10, tableCapacity:null, sortOrder:1 },
      TICKET_TYPES[1],
      TICKET_TYPES[2],
    ]);
  }

  console.log('\n✅ All recurring events seeded!');
  console.log(`   ${8*6} total event instances across Wed/Thu/Fri×2/Sat/Sun`);
  process.exit(0);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
