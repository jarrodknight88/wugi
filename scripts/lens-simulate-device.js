/**
 * Lens Phase 1 — hardware device simulator (run LOCALLY, NO serviceAccount.json
 * needed). Lets the whole ingest pipeline be exercised with ZERO hardware:
 * generates JPEGs (with EXIF DateTimeOriginal) and drops them into the
 * Storage ingest path exactly where the real device will:
 *
 *   lens-ingest/{deviceId}/{galleryId}/{filename}
 *
 * Authenticates as the device's own Firebase Auth user via the Identity
 * Toolkit REST API (the client-SDK sign-in flow, not the Admin SDK) — every
 * write below is a real client-auth request, so it exercises storage.rules
 * and firestore.rules exactly as the physical device will, instead of
 * bypassing them.
 *
 * The deployed ingestLensUpload Cloud Function picks each upload up, builds
 * renditions, and writes pending photo docs. Also simulates the device
 * heartbeat (heartbeatAt + batteryPct on devices/{deviceId}).
 *
 * Usage:
 *   node scripts/lens-simulate-device.js                          # 5 photos, 3s apart
 *   node scripts/lens-simulate-device.js --device lens-proto-01 --count 10 --interval 3000
 *   node scripts/lens-simulate-device.js --device lens-proto-01 --count 6 --photos ./sample-photos
 *   node scripts/lens-simulate-device.js --mismatch               # quarantine path test
 *
 * Flags:
 *   --device   <id>     device to impersonate            (default lens-proto-01)
 *   --count    <n>      photos to upload                 (default 5)
 *   --interval <ms>     delay between uploads             (default 3000)
 *   --photos   <dir>    upload real JPEGs from this dir instead of generating
 *                       them (cycles through the dir's files if fewer than
 *                       --count). Without this flag, small solid-color JPEGs
 *                       with synthetic EXIF timestamps are generated.
 *   --mismatch          upload to a WRONG galleryId — must land in
 *                       lens-quarantine/ + lensQuarantine log, never pending
 *
 * Credentials (env vars, NOT serviceAccount.json):
 *   LENS_DEVICE_PASSWORD   required — password for the device's Firebase
 *                          Auth user (set via scripts/lens-provision-device.js,
 *                          which is run manually — this script never creates
 *                          the auth user itself).
 *   LENS_DEVICE_EMAIL      optional — defaults to `${device}@devices.wugi.us`,
 *                          the convention lens-provision-device.js uses.
 *   FIREBASE_WEB_API_KEY   optional — defaults to the wugi-prod Web API key
 *                          already embedded in every Wugi client app config
 *                          (lens/GoogleService-Info.plist, mobile-app/, etc.)
 *                          Web API keys are not secrets; they identify the
 *                          Firebase project to the Identity Toolkit REST API
 *                          and are meaningless without a valid user password.
 *
 * See scripts/LENS-PHASE1-TESTING.md for the full end-to-end procedure,
 * including the manual step of provisioning the device auth user.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PROJECT_ID = 'wugi-prod';
const BUCKET = 'wugi-prod.firebasestorage.app';
const DEFAULT_WEB_API_KEY = 'AIzaSyBq7LmHsOpy9mqk8aDaHTxTWBtxvhLSEVI'; // public Web API key, see header comment

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

const DEVICE_ID = arg('device', 'lens-proto-01');
const COUNT     = parseInt(arg('count', '5'), 10);
const INTERVAL  = parseInt(arg('interval', '3000'), 10);
const PHOTOS_DIR = arg('photos', null);
const MISMATCH  = process.argv.includes('--mismatch');

const EMAIL     = process.env.LENS_DEVICE_EMAIL || `${DEVICE_ID}@devices.wugi.us`;
const PASSWORD  = process.env.LENS_DEVICE_PASSWORD;
const API_KEY   = process.env.FIREBASE_WEB_API_KEY || DEFAULT_WEB_API_KEY;

if (!PASSWORD) {
  console.error('❌ LENS_DEVICE_PASSWORD is not set. This is the password for the device auth');
  console.error('   user, created via: node scripts/lens-provision-device.js --device ' + DEVICE_ID);
  console.error('   export LENS_DEVICE_PASSWORD=... and re-run.');
  process.exit(1);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Identity Toolkit REST auth (client-SDK equivalent, no Admin SDK) ─────
let session = null; // { idToken, refreshToken, uid, expiresAt }

async function signIn() {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
    }
  );
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`sign-in failed for ${EMAIL}: ${body.error?.message || res.status}`);
  }
  session = {
    idToken: body.idToken,
    refreshToken: body.refreshToken,
    uid: body.localId,
    expiresAt: Date.now() + Number(body.expiresIn) * 1000,
  };
}

async function refreshIfNeeded() {
  if (session && Date.now() < session.expiresAt - 5 * 60 * 1000) return; // >5min left
  if (!session) return signIn();

  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${session.refreshToken}`,
  });
  const body = await res.json();
  if (!res.ok) return signIn(); // fall back to a fresh sign-in
  session = {
    idToken: body.id_token,
    refreshToken: body.refresh_token,
    uid: body.user_id,
    expiresAt: Date.now() + Number(body.expires_in) * 1000,
  };
}

// ── Minimal Firestore REST helpers (client-auth, rules-enforced) ─────────
function decodeValue(v) {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  return undefined;
}
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}

async function firestoreGetDevice(deviceId) {
  await refreshIfNeeded();
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/devices/${deviceId}`,
    { headers: { Authorization: `Bearer ${session.idToken}` } }
  );
  if (res.status === 404) return null;
  const body = await res.json();
  if (!res.ok) throw new Error(`firestore get devices/${deviceId} failed: ${body.error?.message || res.status}`);
  return decodeFields(body.fields || {});
}

// Heartbeat write — only heartbeatAt/batteryPct/updatedAt, matching the
// device-self-update allowlist in firestore.rules (devices/{deviceId}).
async function firestorePatchHeartbeat(deviceId, batteryPct) {
  await refreshIfNeeded();
  const now = new Date().toISOString();
  const maskParams = ['heartbeatAt', 'batteryPct', 'updatedAt']
    .map(f => `updateMask.fieldPaths=${f}`).join('&');
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/devices/${deviceId}?${maskParams}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          heartbeatAt: { timestampValue: now },
          batteryPct: { integerValue: String(batteryPct) },
          updatedAt: { timestampValue: now },
        },
      }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`heartbeat patch failed: ${body.error?.message || res.status}`);
  }
}

// ── Storage REST upload (client-auth, storage.rules-enforced) ────────────
async function uploadToStorage(objectPath, buffer, contentType) {
  await refreshIfNeeded();
  const res = await fetch(
    `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': contentType },
      body: buffer,
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`upload of ${objectPath} failed (${res.status}): ${body}`);
  }
}

// EXIF datetime format: "YYYY:MM:DD HH:MM:SS" (local time)
function exifDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Small solid-color JPEG with an index label and a stamped EXIF
// DateTimeOriginal, so the ingest function's EXIF path is actually tested.
async function makeTestJpeg(index, capturedAt) {
  const hue = Math.floor(Math.random() * 360);
  const svg = `<svg width="480" height="320" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="hsl(${hue},45%,28%)"/>
    <text x="50%" y="52%" font-family="Helvetica, Arial, sans-serif" font-size="72"
      font-weight="bold" fill="white" text-anchor="middle">#${index + 1}</text>
    <text x="50%" y="70%" font-family="Helvetica, Arial, sans-serif" font-size="20"
      fill="rgba(255,255,255,0.75)" text-anchor="middle">${DEVICE_ID} · sim</text>
  </svg>`;

  return sharp(Buffer.from(svg))
    .jpeg({ quality: 85 })
    .withExif({
      IFD0: { Make: 'Wugi', Model: 'Lens Simulator', Software: 'lens-simulate-device.js' },
      IFD2: { DateTimeOriginal: exifDate(capturedAt) },
    })
    .toBuffer();
}

function loadPhotosDir(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => /\.(jpe?g)$/i.test(f))
    .sort();
  if (files.length === 0) throw new Error(`--photos ${dir} has no .jpg/.jpeg files`);
  return files.map(f => fs.readFileSync(path.join(dir, f)));
}

async function main() {
  console.log(`🔑 Signing in as ${EMAIL} (client SDK / Identity Toolkit REST)…`);
  await signIn();
  console.log(`✓ Authenticated (uid ${session.uid})`);

  const device = await firestoreGetDevice(DEVICE_ID);
  if (!device) {
    console.error(`❌ devices/${DEVICE_ID} not found — run scripts/lens-provision-device.js first.`);
    process.exit(1);
  }
  const assignedGallery = device.assignment?.galleryId;
  if (!assignedGallery) {
    console.error(`❌ devices/${DEVICE_ID} has no assignment.galleryId — re-run the provision script.`);
    process.exit(1);
  }

  const targetGallery = MISMATCH ? 'wrong-gallery-for-quarantine-test' : assignedGallery;
  const photoBuffers = PHOTOS_DIR ? loadPhotosDir(PHOTOS_DIR) : null;

  console.log(`📷 Simulating ${DEVICE_ID} → gallery "${targetGallery}"${MISMATCH ? '  (MISMATCH — expect quarantine)' : ''}`);
  console.log(`   mode=${device.mode}, active=${device.active}, ${COUNT} photos @ ${INTERVAL}ms`
    + (photoBuffers ? `, source=${PHOTOS_DIR} (${photoBuffers.length} file(s))` : ', source=generated') + '\n');

  for (let i = 0; i < COUNT; i++) {
    const capturedAt = new Date();
    const jpeg = photoBuffers ? photoBuffers[i % photoBuffers.length] : await makeTestJpeg(i, capturedAt);
    const filename = `sim-${Date.now()}-${String(i + 1).padStart(3, '0')}.jpg`;
    const dest = `lens-ingest/${DEVICE_ID}/${targetGallery}/${filename}`;

    await uploadToStorage(dest, jpeg, 'image/jpeg');
    console.log(`  ↑ [${i + 1}/${COUNT}] ${dest} (${(jpeg.length / 1024).toFixed(0)} KB)`);

    // Simulated hardware heartbeat alongside the capture — real client-auth
    // write, enforced by firestore.rules' device-self-update allowlist.
    const batteryPct = Math.max(5, 100 - i * 2 - Math.floor(Math.random() * 5));
    await firestorePatchHeartbeat(DEVICE_ID, batteryPct);

    if (i < COUNT - 1) await sleep(INTERVAL);
  }

  console.log(`\n✅ Uploaded ${COUNT} photo(s).`);
  console.log(MISMATCH
    ? 'Verify: Storage lens-quarantine/ + Firestore lensQuarantine — NOTHING in the pending pool.'
    : `Verify: eventGalleries/${assignedGallery}/photos (status pending) → Lens app pending pool → approve → consumer gallery + https://wugi.us/claim/${DEVICE_ID}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e.message || e); process.exit(1); });
