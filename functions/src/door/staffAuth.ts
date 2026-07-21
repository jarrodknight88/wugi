// ─────────────────────────────────────────────────────────────────────
// Wugi — Door staff identity + role verification (server-side)
// Wugi Door devices sign in to Firebase Auth anonymously — context.auth
// proves nothing about who is holding the device. A staff PIN is the
// only real proof of identity/role in this system, so any Cloud
// Function that needs to gate on role must re-verify the PIN here
// rather than trusting a client-supplied role or context.auth alone.
// ─────────────────────────────────────────────────────────────────────
import * as admin from 'firebase-admin';
import { SUPER_ADMIN_SECRETS, SUPER_ADMIN_NAMES, constantTimeEqual } from './validateSuperAdminPin';

export type StaffRole = 'door' | 'manager' | 'super_admin';

export interface VerifiedStaff {
  role: StaffRole;
  identity: string;
  venueId: string | null;
  eventId: string | null;
}

export async function verifyStaffPin(pin: unknown): Promise<VerifiedStaff | null> {
  if (!pin || typeof pin !== 'string') return null;

  for (const secretKey of SUPER_ADMIN_SECRETS) {
    const storedPin = process.env[secretKey];
    if (storedPin && constantTimeEqual(pin, storedPin)) {
      return {
        role: 'super_admin',
        identity: SUPER_ADMIN_NAMES[secretKey] || 'Admin',
        venueId: null,
        eventId: null,
      };
    }
  }

  const snap = await admin.firestore().collection('eventPins')
    .where('pin', '==', pin)
    .where('active', '==', true)
    .limit(1).get();
  if (snap.empty) return null;

  const pinDoc = snap.docs[0].data();
  if (pinDoc.expiresAt && pinDoc.expiresAt.toDate() < new Date()) return null;

  return {
    role: (pinDoc.role as StaffRole) || 'door',
    identity: pinDoc.label || pinDoc.venueName || snap.docs[0].id,
    venueId: pinDoc.venueId || null,
    eventId: pinDoc.eventId || null,
  };
}

export function isManagerOrAbove(staff: VerifiedStaff): boolean {
  return staff.role === 'manager' || staff.role === 'super_admin';
}
