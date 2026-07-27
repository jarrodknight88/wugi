// ─────────────────────────────────────────────────────────────────────
// Wugi — checkInPass callable
// Server-side replacement for the direct client write that ManualLookupScreen
// / ScannerScreen perform today (check-in-app sets `passes/{id}.scanStatus`
// straight from the device). Per docs/DOOR-REDESIGN-SPEC.md §10, ALL Door
// writes route through callables so uid + role/venue + geofence are enforced
// server-side — Firestore rules stay read-only for venue_staff.
//
// Role/venue gate mirrors canAccessVenue() in firebase/firestore.rules
// (lines ~32-36) exactly, so rules and this callable never disagree:
//   isStaff() (super_admin | moderator | support)  → any venue
//   venue_admin | venue_staff                      → only if venueId in venueIds()
//
// Geofence is SOFT here (unlike the hard geofence in captureTerminalPayment,
// functions/src/terminal/terminalFunctions.ts): scans must keep working
// offline, and a queued scan syncs later from wherever the device happens to
// be by then. Out-of-range or missing coords never reject the check-in —
// they're recorded as geofenceOk:false for review, never a retroactive denial.
//
// Double-redemption vs. idempotent retry: an offline queue WILL retry the
// same call. The pass doc's `checkInIdempotencyKey` from the write that
// first redeemed it is compared against the incoming key — a match means
// this is the same request replaying (return the original outcome), a
// mismatch means a genuine second scan (return alreadyCheckedIn, not a throw).
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GEOFENCE_RADIUS_METERS, extractVenueLatLng, haversineMeters } from './geofence';

const db = admin.firestore();

// Mirrors firebase/firestore.rules isStaff() / isVenueAdmin() / isVenueStaff().
const STAFF_ROLES = new Set(['super_admin', 'moderator', 'support']);
const VENUE_SCOPED_ROLES = new Set(['venue_admin', 'venue_staff']);

interface CheckInPassRequest {
  passId?: string;
  venueId?: string;
  eventId?: string;
  scanLat?: number;
  scanLng?: number;
  clientScannedAt?: string | number;
  idempotencyKey?: string;
}

interface CheckInPassResult {
  passId: string;
  alreadyCheckedIn: boolean;
  geofenceOk: boolean | null;
  distanceMeters: number | null;
  scannedBy?: string | null;
}

async function assertVenueAccess(uid: string, venueId: string): Promise<void> {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('permission-denied', 'No user document for caller');
  }
  const user = userSnap.data()!;
  const role: string = user.role || '';
  const venueIds: string[] = user.venueIds || [];
  const allowed = STAFF_ROLES.has(role) || (VENUE_SCOPED_ROLES.has(role) && venueIds.includes(venueId));
  if (!allowed) {
    throw new functions.https.HttpsError('permission-denied', `${role || 'role'} cannot check in passes for venue ${venueId}`);
  }
}

function computeGeofence(
  venueLocation: unknown,
  scanLat: unknown,
  scanLng: unknown
): { geofenceOk: boolean; distanceMeters: number | null } {
  const venueCoords = extractVenueLatLng(venueLocation);
  if (!venueCoords || typeof scanLat !== 'number' || typeof scanLng !== 'number') {
    return { geofenceOk: false, distanceMeters: null };
  }
  const distanceMeters = haversineMeters(scanLat, scanLng, venueCoords.lat, venueCoords.lng);
  return { geofenceOk: distanceMeters <= GEOFENCE_RADIUS_METERS, distanceMeters };
}

function parseClientScannedAt(value: unknown): admin.firestore.Timestamp {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return admin.firestore.Timestamp.fromMillis(value);
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return admin.firestore.Timestamp.fromMillis(ms);
  }
  throw new functions.https.HttpsError('invalid-argument', 'clientScannedAt must be a valid timestamp');
}

export const checkInPass = functions.https.onCall(async (data: CheckInPassRequest, context): Promise<CheckInPassResult> => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }
  const uid = context.auth.uid;

  const { passId, venueId, eventId, scanLat, scanLng, idempotencyKey } = data || {};
  if (!passId || typeof passId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'passId is required');
  }
  if (!venueId || typeof venueId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'venueId is required');
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'idempotencyKey is required');
  }
  const clientScannedAt = parseClientScannedAt(data?.clientScannedAt);

  await assertVenueAccess(uid, venueId);

  const passRef = db.collection('passes').doc(passId);
  const venueRef = db.collection('venues').doc(venueId);

  return db.runTransaction(async (tx): Promise<CheckInPassResult> => {
    const [passSnap, venueSnap] = await Promise.all([tx.get(passRef), tx.get(venueRef)]);

    if (!passSnap.exists) {
      throw new functions.https.HttpsError('not-found', `Pass ${passId} not found`);
    }
    const pass = passSnap.data()!;

    // The venueId a door staffer is authorised for and the venue the pass was
    // actually issued for must be the same — otherwise venue-scoped access
    // (checked above against the input venueId) would let staff at venue A
    // check in a pass belonging to venue B just by naming their own venue.
    if (pass.venueId && pass.venueId !== venueId) {
      throw new functions.https.HttpsError('failed-precondition', 'Pass does not belong to this venue');
    }

    if (eventId && pass.eventId && pass.eventId !== eventId) {
      functions.logger.warn(`checkInPass: eventId mismatch for pass ${passId} (input ${eventId}, pass ${pass.eventId})`);
    }

    const { geofenceOk, distanceMeters } = computeGeofence(venueSnap.data()?.location, scanLat, scanLng);

    if (pass.scanStatus === 'scanned') {
      if (pass.checkInIdempotencyKey === idempotencyKey) {
        // Same request replaying (offline queue re-sync) — return the
        // original outcome rather than a fresh one.
        return {
          passId,
          alreadyCheckedIn: false,
          geofenceOk: pass.geofenceOk ?? geofenceOk,
          distanceMeters: pass.distanceMeters ?? distanceMeters,
        };
      }
      // Genuine double-redemption — a distinct, non-throwing result so the
      // client can render "already used" instead of a generic error.
      return {
        passId,
        alreadyCheckedIn: true,
        geofenceOk: pass.geofenceOk ?? null,
        distanceMeters: pass.distanceMeters ?? null,
        scannedBy: pass.scannedBy ?? null,
      };
    }

    if (pass.scanStatus && pass.scanStatus !== 'valid') {
      throw new functions.https.HttpsError('failed-precondition', `Pass is not valid for check-in (status: ${pass.scanStatus})`);
    }

    tx.update(passRef, {
      scanStatus: 'scanned',
      scanLat: typeof scanLat === 'number' ? scanLat : null,
      scanLng: typeof scanLng === 'number' ? scanLng : null,
      geofenceOk,
      distanceMeters,
      scannedBy: uid,
      scannedAt: admin.firestore.FieldValue.serverTimestamp(),
      clientScannedAt,
      checkInIdempotencyKey: idempotencyKey,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { passId, alreadyCheckedIn: false, geofenceOk, distanceMeters };
  });
});
