/**
 * Lens Phase 1 — device provisioning (run LOCALLY, needs serviceAccount.json).
 *
 * Creates/updates everything a hardware capture device needs:
 *   1. Firebase Auth user for the device (email/password), with the
 *      `lensDeviceId` custom claim that storage.rules checks on writes to
 *      lens-ingest/{deviceId}/...
 *   2. devices/{deviceId} registry doc — assignment (venueId, galleryId, ...),
 *      mode auto|review, active toggle, heartbeat fields.
 *   3. The assigned eventGalleries doc (idempotent merge), so the Lens app's
 *      getOrCreateGallery(eventId + photographerId) resolves to the SAME
 *      gallery the device feeds.
 *
 * Idempotent — safe to re-run; existing values only change when the matching
 * flag is passed. Targets wugi-prod explicitly.
 *
 * Usage:
 *   node scripts/lens-provision-device.js \
 *     --device lens-proto-01 \
 *     --event <eventId> \
 *     --photographer-email jarrod.knight88@gmail.com \
 *     [--password <device-user-password>] \
 *     [--mode review|auto] [--inactive | --active] \
 *     [--gallery <galleryId>]     # default: lens-<deviceId>
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS, scripts/serviceAccount.json,
 * or mobile-app/scripts/serviceAccount.json (SessionStart hook location).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');

function loadCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return null; // ADC
  const candidates = [
    path.join(__dirname, 'serviceAccount.json'),
    path.join(__dirname, '..', 'mobile-app', 'scripts', 'serviceAccount.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return require(p);
  }
  console.error('❌ No serviceAccount.json found (looked in scripts/ and mobile-app/scripts/) and GOOGLE_APPLICATION_CREDENTIALS is unset.');
  process.exit(1);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const DEVICE_ID = arg('device', 'lens-proto-01');
const GALLERY_ID = arg('gallery', `lens-${DEVICE_ID}`);
const MODE = arg('mode', null);
const EVENT_ID = arg('event', null);
const PHOTOG_EMAIL = arg('photographer-email', null);
const PHOTOG_UID = arg('photographer-uid', null);
const PASSWORD = arg('password', null);
const EMAIL = arg('email', `${DEVICE_ID}@devices.wugi.us`);

async function main() {
  const sa = loadCredentials();
  admin.initializeApp({
    ...(sa ? { credential: admin.credential.cert(sa) } : {}),
    projectId: 'wugi-prod',
  });
  const db = admin.firestore();

  // ── 1. Device auth user + lensDeviceId claim ─────────────────────────
  let user;
  try {
    user = await admin.auth().getUserByEmail(EMAIL);
    console.log(`✓ Auth user exists: ${EMAIL} (${user.uid})`);
    if (PASSWORD) {
      await admin.auth().updateUser(user.uid, { password: PASSWORD });
      console.log('  ↳ password updated');
    }
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    const password = PASSWORD || crypto.randomBytes(12).toString('base64url');
    user = await admin.auth().createUser({ email: EMAIL, password });
    console.log(`✓ Created device auth user ${EMAIL} (${user.uid})`);
    if (!PASSWORD) console.log(`  ↳ generated password (store securely, shown ONCE): ${password}`);
  }

  const claims = user.customClaims || {};
  if (claims.lensDeviceId !== DEVICE_ID) {
    await admin.auth().setCustomUserClaims(user.uid, { ...claims, lensDeviceId: DEVICE_ID });
    console.log(`✓ Set custom claim lensDeviceId=${DEVICE_ID}`);
  } else {
    console.log(`✓ Custom claim lensDeviceId already set`);
  }

  // ── 2. Resolve assignment pieces ─────────────────────────────────────
  let photographerId = PHOTOG_UID || null;
  if (!photographerId && PHOTOG_EMAIL) {
    photographerId = (await admin.auth().getUserByEmail(PHOTOG_EMAIL)).uid;
    console.log(`✓ Photographer ${PHOTOG_EMAIL} → ${photographerId}`);
  }

  let eventTitle = null, venueId = null, venueName = null;
  if (EVENT_ID) {
    const ev = await db.doc(`events/${EVENT_ID}`).get();
    if (!ev.exists) { console.error(`❌ events/${EVENT_ID} not found`); process.exit(1); }
    eventTitle = ev.data().title || null;
    venueId = ev.data().venueId || null;
    venueName = ev.data().venueName || ev.data().venue || null;
    console.log(`✓ Event: "${eventTitle}" @ ${venueName || venueId || 'unknown venue'}`);
  }

  // ── 3. devices/{deviceId} registry doc ───────────────────────────────
  const deviceRef = db.doc(`devices/${DEVICE_ID}`);
  const existing = (await deviceRef.get()).data() || {};
  const now = admin.firestore.FieldValue.serverTimestamp();

  const assignment = {
    ...(existing.assignment || {}),
    galleryId: GALLERY_ID,
    ...(EVENT_ID       ? { eventId: EVENT_ID }             : {}),
    ...(eventTitle     ? { eventTitle }                    : {}),
    ...(venueId        ? { venueId }                       : {}),
    ...(venueName      ? { venueName }                     : {}),
    ...(photographerId ? { photographerId }                : {}),
  };

  await deviceRef.set({
    label:      existing.label || `Lens ${DEVICE_ID}`,
    authUid:    user.uid,
    active:     has('inactive') ? false
              : has('active')   ? true
              : (existing.active === undefined ? true : existing.active),
    mode:       MODE || existing.mode || 'review',
    assignment,
    heartbeatAt: existing.heartbeatAt || null,
    batteryPct:  existing.batteryPct === undefined ? null : existing.batteryPct,
    createdAt:   existing.createdAt || now,
    updatedAt:   now,
  }, { merge: true });
  console.log(`✓ devices/${DEVICE_ID} → mode=${MODE || existing.mode || 'review'}, gallery=${GALLERY_ID}`);

  // ── 4. Assigned gallery doc (idempotent) ─────────────────────────────
  const galleryRef = db.doc(`eventGalleries/${GALLERY_ID}`);
  const gallery = (await galleryRef.get()).data() || {};
  await galleryRef.set({
    eventId:        gallery.eventId        || EVENT_ID || null,
    eventTitle:     gallery.eventTitle     || eventTitle || `Lens ${DEVICE_ID}`,
    venueId:        gallery.venueId        || venueId || null,
    venueName:      gallery.venueName      || venueName || '',
    photographerId: gallery.photographerId || photographerId || null,
    status:         gallery.status         || 'live',
    source:         gallery.source         || 'lens-device',
    photoCount:     gallery.photoCount     === undefined ? 0 : gallery.photoCount,
    pendingCount:   gallery.pendingCount   === undefined ? 0 : gallery.pendingCount,
    publishedCount: gallery.publishedCount === undefined ? 0 : gallery.publishedCount,
    createdAt:      gallery.createdAt      || now,
    updatedAt:      now,
  }, { merge: true });
  console.log(`✓ eventGalleries/${GALLERY_ID} ready`);

  console.log('\nDone. Next: node scripts/lens-simulate-device.js --device ' + DEVICE_ID);
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e); process.exit(1); });
