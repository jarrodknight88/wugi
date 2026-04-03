#!/usr/bin/env node
/**
 * Wugi Check-In — create-event-pin.js
 *
 * Usage:
 *   node scripts/create-event-pin.js
 *
 * Creates an eventPins document in Firestore that door staff use
 * to authenticate into the check-in app.
 *
 * Run from the monorepo root. Requires firebase/service-account.json.
 */

const admin = require('firebase-admin');
const readline = require('readline');

const serviceAccount = require(require('path').join(__dirname, '../firebase/service-account.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'wugi-prod',
});

const db = admin.firestore();

function generatePin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n🎟️  Wugi Check-In — PIN Generator\n');

  // Fetch available events
  const eventsSnap = await db.collection('events').orderBy('date').get();
  if (eventsSnap.empty) {
    console.error('❌ No events found in Firestore. Seed events first.');
    process.exit(1);
  }

  console.log('Available events:');
  const events = eventsSnap.docs.map((d, i) => {
    const data = d.data();
    console.log(`  [${i + 1}] ${data.name} — ${data.date} @ ${data.venueName}`);
    return { id: d.id, ...data };
  });

  const choice = await prompt(rl, '\nSelect event number: ');
  const event = events[parseInt(choice, 10) - 1];
  if (!event) { console.error('Invalid selection.'); process.exit(1); }

  // Fetch venue for coordinates
  const venueSnap = await db.collection('venues').doc(event.venueId).get();
  if (!venueSnap.exists) {
    console.error(`❌ Venue ${event.venueId} not found.`);
    process.exit(1);
  }
  const venue = venueSnap.data();

  if (!venue.latitude || !venue.longitude) {
    console.error('❌ Venue is missing latitude/longitude. Add coordinates to the venue doc first.');
    process.exit(1);
  }

  const roleInput = await prompt(rl, 'Role for this PIN [door/manager] (default: door): ');
  const role = roleInput.trim() === 'manager' ? 'manager' : 'door';

  const hoursInput = await prompt(rl, 'PIN valid for how many hours? (default: 12): ');
  const hours = parseInt(hoursInput, 10) || 12;

  rl.close();

  const pin = generatePin();
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  const pinDoc = {
    pin,
    eventId: event.id,
    eventName: event.name,
    venueId: event.venueId,
    venueName: event.venueName ?? venue.name,
    venueLatitude: venue.latitude,
    venueLongitude: venue.longitude,
    date: event.date,
    role,
    active: true,
    expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const ref = await db.collection('eventPins').add(pinDoc);

  console.log('\n✅ PIN created successfully!');
  console.log('─────────────────────────────');
  console.log(`  PIN:      ${pin}`);
  console.log(`  Event:    ${event.name}`);
  console.log(`  Venue:    ${pinDoc.venueName}`);
  console.log(`  Role:     ${role}`);
  console.log(`  Expires:  ${expiresAt.toLocaleString()}`);
  console.log(`  Doc ID:   ${ref.id}`);
  console.log('─────────────────────────────');
  console.log('\nShare this PIN with door staff. It expires automatically.\n');

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
