// ─────────────────────────────────────────────────────────────────────
// Wugi — generateDoorPin Cloud Function
// Generates a 6-digit PIN for venue-level or event-level door access.
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

function randomPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export const generateDoorPin = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const {
    scope,           // 'venue' | 'event'
    venueId,
    venueName,
    venueLatitude,
    venueLongitude,
    eventId,
    eventName,
    eventDate,
    label,
    expiresInHours,
  } = data;

  if (!scope || !venueId) {
    throw new functions.https.HttpsError('invalid-argument', 'scope and venueId are required');
  }

  // Deactivate existing active PINs for this exact scope
  let query = db.collection('eventPins')
    .where('venueId', '==', venueId)
    .where('active', '==', true)
    .where('scope', '==', scope) as admin.firestore.Query;

  if (scope === 'event' && eventId) {
    query = query.where('eventId', '==', eventId);
  }

  const existing = await query.get();
  const batch = db.batch();
  existing.docs.forEach(doc =>
    batch.update(doc.ref, {
      active: false,
      deactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  );

  // Build new PIN doc
  const pin = randomPin();
  const expiresAt = expiresInHours
    ? admin.firestore.Timestamp.fromDate(
        new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
      )
    : null;

  const pinDoc: Record<string, any> = {
    pin,
    scope,
    venueId,
    venueName:     venueName     || '',
    venueLatitude: venueLatitude || null,
    venueLongitude:venueLongitude|| null,
    active:        true,
    label:         label || (scope === 'venue' ? 'Venue Access' : 'Event Access'),
    role:          'door',
    createdBy:     context.auth.uid,
    createdAt:     admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  };

  if (scope === 'event') {
    pinDoc.eventId   = eventId   || null;
    pinDoc.eventName = eventName || '';
    pinDoc.date      = eventDate || '';
  }

  const pinRef = db.collection('eventPins').doc();
  batch.set(pinRef, pinDoc);
  await batch.commit();

  return { pin, pinId: pinRef.id };
});
