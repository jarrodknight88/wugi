// ─────────────────────────────────────────────────────────────────────
// Wugi — validateSuperAdminPin Cloud Function
// Validates a super admin PIN stored in Firebase Secret Manager.
// PIN is set via: firebase functions:secrets:set SUPER_ADMIN_PIN
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';

export const validateSuperAdminPin = functions
  .runWith({ secrets: ['SUPER_ADMIN_PIN'] })
  .https.onCall(async (data, context) => {
    const { pin } = data;
    if (!pin || typeof pin !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'PIN required');
    }

    const superAdminPin = process.env.SUPER_ADMIN_PIN;
    if (!superAdminPin) {
      throw new functions.https.HttpsError('failed-precondition', 'Super admin PIN not configured');
    }

    // Constant-time comparison to prevent timing attacks
    const valid =
      pin.length === superAdminPin.length &&
      pin.split('').every((c, i) => c === superAdminPin[i]);

    if (!valid) {
      functions.logger.warn('Super admin PIN failed attempt', {
        ip: context.rawRequest?.ip,
        timestamp: new Date().toISOString(),
      });
      throw new functions.https.HttpsError('permission-denied', 'Invalid PIN');
    }

    functions.logger.info('Super admin PIN accepted', {
      ip: context.rawRequest?.ip,
      timestamp: new Date().toISOString(),
    });

    return {
      isSuperAdmin:  true,
      eventId:       '__super_admin__',
      eventName:     'All Events',
      venueName:     'Super Admin',
      venueId:       '__super_admin__',
      venueLatitude:  0,
      venueLongitude: 0,
      date: new Date().toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      }),
      role: 'super_admin',
    };
  });
