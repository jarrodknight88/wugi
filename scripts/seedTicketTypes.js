/**
 * Seed ticket types as subcollections on existing events
 * Run: node scripts/seedTicketTypes.js
 */
const admin = require('firebase-admin');
const sa = require('./serviceAccount.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db = admin.firestore();

const ticketsByEvent = {
  'euphoria-fridays': [
    { id: 'general', name: 'General Admission', price: 2500, description: 'Entry to the event', capacity: 200, available: 200, sortOrder: 0 },
    { id: 'vip', name: 'VIP Access', price: 7500, description: 'VIP area + 1 complimentary drink', capacity: 50, available: 50, sortOrder: 1 },
  ],
  'bottle-wars-sundays': [
    { id: 'general', name: 'General Admission', price: 1500, description: 'Entry to Bottle Wars', capacity: 150, available: 150, sortOrder: 0 },
    { id: 'table', name: 'Table Package', price: 30000, description: 'Reserved table for 4 + bottle service', capacity: 10, available: 10, sortOrder: 1 },
  ],
  'atl-rooftop-social': [
    { id: 'general', name: 'General Admission', price: 2000, description: 'Entry to the rooftop social', capacity: 100, available: 100, sortOrder: 0 },
  ],
};

async function main() {
  for (const [eventId, tickets] of Object.entries(ticketsByEvent)) {
    for (const ticket of tickets) {
      const { id, ...data } = ticket;
      await db.collection('events').doc(eventId).collection('ticketTypes').doc(id).set({
        ...data,
        eventId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`✅ ${eventId} / ${id} — $${(ticket.price / 100).toFixed(2)}`);
    }
  }
  console.log('\nDone.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
