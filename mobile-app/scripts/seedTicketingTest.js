/**
 * Wugi — seedTicketingTest.js
 *
 * Seeds test events with ticket types for ticketing development.
 * Uses confirmed active venues only.
 *
 * Test scenarios covered:
 *   Tongue & Groove Fridays  → GA + VIP + Free Ladies Night (all 3 types)
 *   Afrobeats Saturdays      → GA + Tax-inclusive Dinner Package
 *   Nite Owl Bottle Wars     → GA + $500 VIP (tests $60 booking fee cap)
 *   Ponce City Rooftop       → No tickets (tests CTA hidden)
 *
 * Usage:
 *   cd ~/Documents/GitHub/wugi/mobile-app/scripts
 *   node seedTicketingTest.js
 */

require('dotenv').config({ path: __dirname + '/.env' });
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'wugi-prod',
});

const db = admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

const EVENTS = [
  // ── 1. Tongue & Groove Fridays ───────────────────────────────────────
  // Tests: GA + VIP + Free ticket types, standard tax calculation
  {
    id: 'test-tongue-groove-fridays',
    name: 'Tongue & Groove Fridays',
    venue: 'Tongue & Groove',
    venueId: 'tongue-groove',
    date: 'FRI APR 4',
    time: '9 PM',
    age: '21+',
    about: "Atlanta's iconic nightclub. World-class DJs, live performances, and VIP bottle service every weekend.",
    vibes: ['High Energy', 'Boujee'],
    media: [
      { type: 'photo', uri: 'https://picsum.photos/seed/tongue1/800/1000' },
      { type: 'photo', uri: 'https://picsum.photos/seed/tongue2/800/1000' },
    ],
    status: 'approved',
    hasTickets: true,
    ticketTypes: [
      {
        id: 'test-tg-ga',
        name: 'General Admission',
        description: 'Entry only · Limited availability',
        price: 2500,           // $25.00
        isFree: false,
        taxIncluded: false,
        taxIncludedSetBy: null,
        taxIncludedConfirmedBy: null,
        taxIncludedConfirmedAt: null,
        capacity: 300,
        sold: 0,
        remaining: 300,
        status: 'on_sale',
        approvalStatus: 'approved',
        approvalNote: null,
        bookingFeePercent: null,
        bookingFeeMin: null,
        bookingFeeMax: null,
        saleStartsAt: null,
        saleEndsAt: null,
        maxPerOrder: 10,
      },
      {
        id: 'test-tg-vip',
        name: 'VIP Table',
        description: 'Bottle service included · Dedicated server',
        price: 15000,          // $150.00
        isFree: false,
        taxIncluded: false,
        taxIncludedSetBy: null,
        taxIncludedConfirmedBy: null,
        taxIncludedConfirmedAt: null,
        capacity: 20,
        sold: 0,
        remaining: 20,
        status: 'on_sale',
        approvalStatus: 'approved',
        approvalNote: null,
        bookingFeePercent: null,
        bookingFeeMin: null,
        bookingFeeMax: null,
        saleStartsAt: null,
        saleEndsAt: null,
        maxPerOrder: 4,
      },
      {
        id: 'test-tg-ladies',
        name: 'Ladies Night',
        description: 'Free entry before 11 PM',
        price: 0,
        isFree: true,
        taxIncluded: false,
        taxIncludedSetBy: null,
        taxIncludedConfirmedBy: null,
        taxIncludedConfirmedAt: null,
        capacity: 100,
        sold: 0,
        remaining: 100,
        status: 'on_sale',
        approvalStatus: 'approved',
        approvalNote: null,
        bookingFeePercent: null,
        bookingFeeMin: null,
        bookingFeeMax: null,
        saleStartsAt: null,
        saleEndsAt: null,
        maxPerOrder: 4,
      },
    ],
  },

  // ── 2. Afrobeats Saturdays at Teranga City ───────────────────────────
  // Tests: tax-inclusive ticket type (Dinner Package)
  {
    id: 'test-afrobeats-saturdays',
    name: 'Afrobeats Saturdays',
    venue: 'Teranga City Ultra Lounge',
    venueId: 'teranga-city',
    date: 'SAT APR 5',
    time: '9 PM',
    age: '21+',
    about: "Atlanta's hottest Afrobeats and Afro-house night. Authentic West African cuisine, premium bottles, and a cultural experience unlike anything in the city.",
    vibes: ['Boujee', 'High Energy'],
    media: [
      { type: 'photo', uri: 'https://picsum.photos/seed/teranga_ev1/800/1000' },
      { type: 'photo', uri: 'https://picsum.photos/seed/teranga_ev2/800/1000' },
    ],
    status: 'approved',
    hasTickets: true,
    ticketTypes: [
      {
        id: 'test-tc-ga',
        name: 'General Admission',
        description: 'Entry only',
        price: 2000,           // $20.00
        isFree: false,
        taxIncluded: false,
        taxIncludedSetBy: null,
        taxIncludedConfirmedBy: null,
        taxIncludedConfirmedAt: null,
        capacity: 150,
        sold: 0,
        remaining: 150,
        status: 'on_sale',
        approvalStatus: 'approved',
        approvalNote: null,
        bookingFeePercent: null,
        bookingFeeMin: null,
        bookingFeeMax: null,
        saleStartsAt: null,
        saleEndsAt: null,
        maxPerOrder: 10,
      },
      {
        id: 'test-tc-dinner',
        name: 'Dinner + Entry Package',
        description: 'Dinner for 2 + entry · Tax included in price',
        price: 15000,          // $150.00 — tax included
        isFree: false,
        taxIncluded: true,
        taxIncludedSetBy: 'seed_script',
        taxIncludedConfirmedBy: 'admin',
        taxIncludedConfirmedAt: null,
        capacity: 30,
        sold: 0,
        remaining: 30,
        status: 'on_sale',
        approvalStatus: 'approved',
        approvalNote: null,
        bookingFeePercent: null,
        bookingFeeMin: null,
        bookingFeeMax: null,
        saleStartsAt: null,
        saleEndsAt: null,
        maxPerOrder: 2,
      },
    ],
  },

  // ── 3. Nite Owl Bottle Wars ──────────────────────────────────────────
  // Tests: $500 VIP ticket (booking fee = $60, under $100 cap)
  {
    id: 'test-nite-owl-bottle-wars',
    name: 'Bottle Wars Sundays',
    venue: 'Nite Owl Kitchen & Cocktails',
    venueId: 'nite-owl',
    date: 'SUN APR 6',
    time: '8 PM',
    age: '21+',
    about: "Atlanta's most legendary Sunday night experience. Tables compete for the best presentation, the crowd votes, and everyone wins.",
    vibes: ['Divey', 'Late Night'],
    media: [
      { type: 'photo', uri: 'https://picsum.photos/seed/bottlewars1/800/1000' },
      { type: 'photo', uri: 'https://picsum.photos/seed/bottlewars2/800/1000' },
    ],
    status: 'approved',
    hasTickets: true,
    ticketTypes: [
      {
        id: 'test-no-ga',
        name: 'General Admission',
        description: 'Entry only',
        price: 1500,           // $15.00
        isFree: false,
        taxIncluded: false,
        taxIncludedSetBy: null,
        taxIncludedConfirmedBy: null,
        taxIncludedConfirmedAt: null,
        capacity: 100,
        sold: 0,
        remaining: 100,
        status: 'on_sale',
        approvalStatus: 'approved',
        approvalNote: null,
        bookingFeePercent: null,
        bookingFeeMin: null,
        bookingFeeMax: null,
        saleStartsAt: null,
        saleEndsAt: null,
        maxPerOrder: 10,
      },
      {
        id: 'test-no-bottle',
        name: 'Bottle Wars Table',
        description: 'Premium table + bottle package',
        price: 50000,          // $500.00 — booking fee = $60 (under $100 cap)
        isFree: false,
        taxIncluded: false,
        taxIncludedSetBy: null,
        taxIncludedConfirmedBy: null,
        taxIncludedConfirmedAt: null,
        capacity: 10,
        sold: 0,
        remaining: 10,
        status: 'on_sale',
        approvalStatus: 'approved',
        approvalNote: null,
        bookingFeePercent: null,
        bookingFeeMin: null,
        bookingFeeMax: null,
        saleStartsAt: null,
        saleEndsAt: null,
        maxPerOrder: 1,
      },
    ],
  },

  // ── 4. Ponce City Rooftop Social ─────────────────────────────────────
  // Tests: hasTickets: false → Get Tickets CTA hidden
  {
    id: 'test-ponce-rooftop-social',
    name: 'ATL Rooftop Social',
    venue: 'Ponce City Market',
    venueId: 'ponce-city-market',
    date: 'SAT APR 5',
    time: '7 PM',
    age: '21+',
    about: "Atlanta's premier rooftop social mixer. Meet Atlanta's most interesting people with drinks in hand and the city below.",
    vibes: ['Rooftop', 'High Energy'],
    media: [
      { type: 'photo', uri: 'https://picsum.photos/seed/rooftopsocial1/800/1000' },
    ],
    status: 'approved',
    hasTickets: false,         // ← No tickets — CTA should be hidden
    ticketTypes: [],
  },
];

// ── Seed ──────────────────────────────────────────────────────────────
async function seed() {
  console.log('🎟️  Wugi — Ticketing Test Seed\n');
  console.log('Using confirmed active venues only:\n');

  let totalTicketTypes = 0;

  for (const event of EVENTS) {
    const { ticketTypes, ...eventData } = event;
    process.stdout.write(`  ${event.name} (${event.venueId})... `);

    await db.collection('events').doc(event.id).set({
      ...eventData,
      createdAt: ts(),
      updatedAt: ts(),
    }, { merge: true });

    for (const tt of ticketTypes) {
      const { id: ttId, ...ttData } = tt;
      await db
        .collection('events').doc(event.id)
        .collection('ticketTypes').doc(ttId)
        .set({
          ...ttData,
          eventId:  event.id,
          venueId:  event.venueId,
          createdAt: ts(),
          updatedAt: ts(),
        }, { merge: true });
      totalTicketTypes++;
    }

    if (ticketTypes.length > 0) {
      console.log(`✅  ${ticketTypes.length} ticket types`);
    } else {
      console.log(`✅  no tickets (CTA hidden)`);
    }
  }

  // Ensure config/ticketing exists
  await db.collection('config').doc('ticketing').set({
    bookingFeePercent:            0.12,
    bookingFeeMin:                199,
    bookingFeeMax:                10000,
    reservePercent:               0.05,
    reserveHoldHoursMin:          48,
    reserveHoldHoursMax:          72,
    reserveHoldHoursDefault:      60,
    chargebackFee:                1500,
    chargebackRateThresholdTier5: 0.005,
    stripeTaxEnabled:             true,
    stripeTaxProductCode:         'txcd_10000000',
  }, { merge: true });

  console.log('\n✅  config/ticketing set');
  console.log('\n🎊 Done!');
  console.log(`   ${EVENTS.length} events`);
  console.log(`   ${totalTicketTypes} ticket types`);
  console.log('\nTest scenarios:');
  console.log('  Tongue & Groove Fridays  → GA + VIP + Free Ladies Night');
  console.log('  Afrobeats Saturdays      → GA + Tax-inclusive Dinner Package');
  console.log('  Nite Owl Bottle Wars     → GA + $500 Bottle Table');
  console.log('  Ponce Rooftop Social     → No tickets (CTA hidden)');
  process.exit(0);
}

seed().catch(e => {
  console.error('❌ Seed failed:', e);
  process.exit(1);
});
