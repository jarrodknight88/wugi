/**
 * Seed test ticket sales for Wugi Door testing
 * Creates realistic tickets in events/{eventId}/tickets subcollection
 * Run: node scripts/seedTestTickets.js
 */
const admin = require('firebase-admin');
const sa = require('./serviceAccount.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db = admin.firestore();

const EVENT_ID = 'fifa-world-cup-opening-watch-party-teranga';

const TICKET_TYPES = {
  ga:    { name: 'General Admission', price: 2500,  color: '#2a7a5a', typeId: 'ga' },
  vip:   { name: 'VIP Access',        price: 7500,  color: '#7c3aed', typeId: 'vip' },
  table: { name: 'VIP Table Package', price: 30000, color: '#1d4ed8', typeId: 'table' },
};

const TICKETS = [
  // Table 1 — all VIP Table, same color, assigned together
  { name: 'Marcus Johnson',    email: 'marcus.j@gmail.com',    type: 'table', table: 'Table 1', checkedIn: false, balanceDue: 0 },
  { name: 'Aaliyah Washington',email: 'aaliyah.w@gmail.com',   type: 'table', table: 'Table 1', checkedIn: false, balanceDue: 0 },
  { name: 'DeShawn Carter',    email: 'deshawn.c@gmail.com',   type: 'table', table: 'Table 1', checkedIn: true,  balanceDue: 0 },
  { name: 'Jasmine Brown',     email: 'jasmine.b@gmail.com',   type: 'table', table: 'Table 1', checkedIn: false, balanceDue: 5000 },

  // Table 2 — mixed VIP and table, one with balance due
  { name: 'Tyler Robinson',    email: 'tyler.r@gmail.com',     type: 'vip',   table: 'Table 2', checkedIn: false, balanceDue: 0 },
  { name: 'Keisha Williams',   email: 'keisha.w@gmail.com',    type: 'vip',   table: 'Table 2', checkedIn: true,  balanceDue: 0 },
  { name: 'Jordan Davis',      email: 'jordan.d@gmail.com',    type: 'table', table: 'Table 2', checkedIn: false, balanceDue: 15000 },

  // Table 3 — all GA, no balance
  { name: 'Destiny Harris',    email: 'destiny.h@gmail.com',   type: 'ga',    table: 'Table 3', checkedIn: false, balanceDue: 0 },
  { name: 'Michael Thompson',  email: 'michael.t@gmail.com',   type: 'ga',    table: 'Table 3', checkedIn: false, balanceDue: 0 },

  // No table — walk-up GA guests
  { name: 'Brittany Moore',    email: 'brittany.m@gmail.com',  type: 'ga',    table: '',        checkedIn: false, balanceDue: 0 },
  { name: 'Andre Jackson',     email: 'andre.j@gmail.com',     type: 'ga',    table: '',        checkedIn: true,  balanceDue: 0 },
  { name: 'Simone Taylor',     email: 'simone.t@gmail.com',    type: 'vip',   table: '',        checkedIn: false, balanceDue: 0 },
  { name: 'Rashad Wilson',     email: 'rashad.w@gmail.com',    type: 'ga',    table: '',        checkedIn: false, balanceDue: 2500 },
  { name: 'Imani Lewis',       email: 'imani.l@gmail.com',     type: 'vip',   table: '',        checkedIn: false, balanceDue: 0 },
  { name: 'Chris Martin',      email: 'chris.m@gmail.com',     type: 'ga',    table: '',        checkedIn: false, balanceDue: 0 },
];

async function run() {
  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const ticketIds = [];

  for (const t of TICKETS) {
    const tt = TICKET_TYPES[t.type];
    const ref = db.collection('events').doc(EVENT_ID).collection('tickets').doc();
    ticketIds.push({ id: ref.id, name: t.name, type: tt.name });

    const data = {
      eventId:        EVENT_ID,
      holderName:     t.name,
      holderEmail:    t.email,
      ticketTypeName: tt.name,
      ticketTypeId:   tt.typeId,
      color:          tt.color,
      price:          tt.price,
      quantity:       1,
      checkedIn:      t.checkedIn,
      checkedInAt:    t.checkedIn ? now : null,
      checkedInBy:    t.checkedIn ? 'seed' : null,
      balanceDue:     t.balanceDue,
      tableAssignment: t.table,
      orderId:        'seed_' + ref.id.slice(-8),
      scanStatus:     t.checkedIn ? 'scanned' : 'valid',
      passUpdatedAt:  now,
      createdAt:      now,
      updatedAt:      now,
      source:         'seed',
    };
    batch.set(ref, data);
  }

  // Update sold counts on ticket types
  const soldByType = { ga: 0, vip: 0, table: 0 };
  TICKETS.forEach(t => soldByType[t.type]++);

  for (const [typeId, count] of Object.entries(soldByType)) {
    if (count === 0) continue;
    const ttRef = db.collection('events').doc(EVENT_ID).collection('ticketTypes').doc(typeId);
    batch.update(ttRef, {
      sold:      admin.firestore.FieldValue.increment(count),
      remaining: admin.firestore.FieldValue.increment(-count),
      updatedAt: now,
    });
  }

  await batch.commit();

  console.log(`\n✅ Seeded ${TICKETS.length} tickets to event: ${EVENT_ID}\n`);
  ticketIds.forEach(t => console.log(`  ${t.id}  ${t.name}  (${t.type})`));
  console.log('\nQR codes encode as: WUGI:{ticketId}');
  console.log('Sales breakdown:', soldByType);
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
