// ─────────────────────────────────────────────────────────────────────
// Wugi — validateSuperAdminPin Cloud Function
// Supports multiple named super admin PINs via Secret Manager:
//   SUPER_ADMIN_PIN       → Jarrod (owner)
//   SUPER_ADMIN_PIN_RICH  → Rich (partner/investor)
// Add new admins: firebase functions:secrets:set SUPER_ADMIN_PIN_NAME
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';

export const SUPER_ADMIN_SECRETS = ['SUPER_ADMIN_PIN', 'SUPER_ADMIN_PIN_RICH'];

export const SUPER_ADMIN_NAMES: Record<string, string> = {
  SUPER_ADMIN_PIN:      'Jarrod',
  SUPER_ADMIN_PIN_RICH: 'Rich',
};

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return a.split('').every((c, i) => c === b[i]);
}

export const validateSuperAdminPin = functions
  .runWith({ secrets: SUPER_ADMIN_SECRETS })
  .https.onCall(async (data, context) => {
    const { pin } = data;
    if (!pin || typeof pin !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'PIN required');
    }

    // Check pin against all registered super admin PINs
    for (const secretKey of SUPER_ADMIN_SECRETS) {
      const storedPin = process.env[secretKey];
      if (!storedPin) continue;
      if (constantTimeEqual(pin, storedPin)) {
        const adminName = SUPER_ADMIN_NAMES[secretKey] || 'Admin';
        functions.logger.info('Super admin PIN accepted', {
          admin: adminName,
          ip: context.rawRequest?.ip,
          timestamp: new Date().toISOString(),
        });
        return {
          isSuperAdmin:   true,
          adminName,
          eventId:        '__super_admin__',
          eventName:      'All Events',
          venueName:      'Super Admin',
          venueId:        '__super_admin__',
          venueLatitude:  0,
          venueLongitude: 0,
          date: new Date().toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
          }),
          role: 'super_admin',
        };
      }
    }

    functions.logger.warn('Super admin PIN failed attempt', {
      ip: context.rawRequest?.ip,
      timestamp: new Date().toISOString(),
    });
    throw new functions.https.HttpsError('permission-denied', 'Invalid PIN');
  });
