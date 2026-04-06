import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db   = admin.firestore();
const auth = admin.auth();

const ALLOWED_CREATORS: Record<string, string[]> = {
  super_admin: ['super_admin','moderator','support','venue_admin','venue_staff','event_admin','event_staff'],
  moderator:   ['venue_admin','venue_staff','event_admin','event_staff'],
  venue_admin: ['venue_staff','event_admin','event_staff'],
};

export const createDashboardUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');

  const callerDoc = await db.collection('users').doc(context.auth.uid).get();
  if (!callerDoc.exists) throw new functions.https.HttpsError('permission-denied', 'No user document');

  const callerRole: string = callerDoc.data()?.role || '';
  const { email, password, role, venueIds = [], eventIds = [], tableAccess = false } = data;

  if (!(ALLOWED_CREATORS[callerRole] || []).includes(role)) {
    throw new functions.https.HttpsError('permission-denied', `${callerRole} cannot create ${role}`);
  }

  if (callerRole === 'venue_admin') {
    const callerVenues: string[] = callerDoc.data()?.venueIds || [];
    if (venueIds.some((v: string) => !callerVenues.includes(v))) {
      throw new functions.https.HttpsError('permission-denied', 'Cannot assign venues you do not manage');
    }
  }

  if (!email || !password || !role) {
    throw new functions.https.HttpsError('invalid-argument', 'email, password, role required');
  }

  const userRecord = await auth.createUser({ email, password });

  await db.collection('users').doc(userRecord.uid).set({
    email, role, venueIds, eventIds,
    tableAccess: tableAccess && role === 'event_admin',
    active: true,
    createdBy: context.auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { uid: userRecord.uid };
});
