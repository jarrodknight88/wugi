/**
 * Lens Phase 1 — hardware device simulator (run LOCALLY, needs
 * serviceAccount.json). Lets the whole ingest pipeline be exercised with
 * ZERO hardware: generates JPEGs (with EXIF DateTimeOriginal) and drops
 * them into the Storage ingest path exactly where the real device will:
 *
 *   lens-ingest/{deviceId}/{galleryId}/{filename}
 *
 * The deployed ingestLensUpload Cloud Function picks each one up, builds
 * renditions, and writes pending photo docs. Also simulates the device
 * heartbeat (heartbeatAt + batteryPct on devices/{deviceId}).
 *
 * Usage:
 *   node scripts/lens-simulate-device.js                          # 5 photos, 3s apart
 *   node scripts/lens-simulate-device.js --device lens-proto-01 --count 12 --interval 2000
 *   node scripts/lens-simulate-device.js --mismatch               # quarantine path test
 *
 * Flags:
 *   --device   <id>     device to impersonate            (default lens-proto-01)
 *   --count    <n>      photos to upload                 (default 5)
 *   --interval <ms>     delay between uploads            (default 3000)
 *   --mismatch          upload to a WRONG galleryId — must land in
 *                       lens-quarantine/ + lensQuarantine log, never pending
 *
 * NOTE: uploads use the Admin SDK (bypasses storage.rules). Rules for the
 * device-auth write path are exercised by the real device / a client-SDK
 * smoke test, not this script.
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS, scripts/serviceAccount.json,
 * or mobile-app/scripts/serviceAccount.json. `sharp` resolves from the repo
 * root node_modules (already a root dependency).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const admin = require('firebase-admin');
const sharp = require('sharp');

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

const DEVICE_ID = arg('device', 'lens-proto-01');
const COUNT     = parseInt(arg('count', '5'), 10);
const INTERVAL  = parseInt(arg('interval', '3000'), 10);
const MISMATCH  = process.argv.includes('--mismatch');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// EXIF datetime format: "YYYY:MM:DD HH:MM:SS" (local time)
function exifDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Generate a distinguishable test JPEG: solid random-hue background with a
// big index label, mixed portrait/landscape, EXIF DateTimeOriginal stamped
// so the ingest function's EXIF path is actually tested.
async function makeTestJpeg(index, capturedAt) {
  const portrait = index % 3 === 2;
  const width  = portrait ? 1200 : 2000;
  const height = portrait ? 1800 : 1333;
  const hue = Math.floor(Math.random() * 360);

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="hsl(${hue},45%,28%)"/>
    <circle cx="${width * 0.75}" cy="${height * 0.3}" r="${Math.min(width, height) * 0.18}" fill="hsl(${(hue + 40) % 360},55%,45%)"/>
    <text x="50%" y="52%" font-family="Helvetica, Arial, sans-serif" font-size="${Math.floor(height / 4)}"
      font-weight="bold" fill="white" text-anchor="middle">#${index + 1}</text>
    <text x="50%" y="66%" font-family="Helvetica, Arial, sans-serif" font-size="${Math.floor(height / 18)}"
      fill="rgba(255,255,255,0.75)" text-anchor="middle">${DEVICE_ID} · sim</text>
  </svg>`;

  return sharp(Buffer.from(svg))
    .jpeg({ quality: 92 })
    .withExif({
      IFD0: { Make: 'Wugi', Model: 'Lens Simulator', Software: 'lens-simulate-device.js' },
      IFD2: { DateTimeOriginal: exifDate(capturedAt) },
    })
    .toBuffer();
}

async function main() {
  const sa = loadCredentials();
  admin.initializeApp({
    ...(sa ? { credential: admin.credential.cert(sa) } : {}),
    projectId: 'wugi-prod',
    storageBucket: 'wugi-prod.appspot.com',
  });
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  const deviceSnap = await db.doc(`devices/${DEVICE_ID}`).get();
  if (!deviceSnap.exists) {
    console.error(`❌ devices/${DEVICE_ID} not found — run scripts/lens-provision-device.js first.`);
    process.exit(1);
  }
  const device = deviceSnap.data();
  const assignedGallery = device.assignment?.galleryId;
  if (!assignedGallery) {
    console.error(`❌ devices/${DEVICE_ID} has no assignment.galleryId — re-run the provision script.`);
    process.exit(1);
  }

  const targetGallery = MISMATCH ? 'wrong-gallery-for-quarantine-test' : assignedGallery;
  console.log(`📷 Simulating ${DEVICE_ID} → gallery "${targetGallery}"${MISMATCH ? '  (MISMATCH — expect quarantine)' : ''}`);
  console.log(`   mode=${device.mode}, active=${device.active}, ${COUNT} photos @ ${INTERVAL}ms\n`);

  for (let i = 0; i < COUNT; i++) {
    const capturedAt = new Date();
    const jpeg = await makeTestJpeg(i, capturedAt);
    const filename = `sim-${Date.now()}-${String(i + 1).padStart(3, '0')}.jpg`;
    const dest = `lens-ingest/${DEVICE_ID}/${targetGallery}/${filename}`;

    const tmp = path.join(os.tmpdir(), filename);
    fs.writeFileSync(tmp, jpeg);
    await bucket.upload(tmp, { destination: dest, contentType: 'image/jpeg' });
    fs.unlinkSync(tmp);
    console.log(`  ↑ [${i + 1}/${COUNT}] ${dest} (${(jpeg.length / 1024).toFixed(0)} KB)`);

    // Simulated hardware heartbeat alongside the capture.
    await db.doc(`devices/${DEVICE_ID}`).set({
      heartbeatAt: admin.firestore.FieldValue.serverTimestamp(),
      batteryPct:  Math.max(5, 100 - i * 2 - Math.floor(Math.random() * 5)),
      updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    if (i < COUNT - 1) await sleep(INTERVAL);
  }

  console.log(`\n✅ Uploaded ${COUNT} photo(s).`);
  console.log(MISMATCH
    ? 'Verify: Storage lens-quarantine/ + Firestore lensQuarantine — NOTHING in the pending pool.'
    : `Verify: eventGalleries/${assignedGallery}/photos (status pending) → Lens app pending pool → approve → consumer gallery + https://wugi.us/claim/${DEVICE_ID}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e); process.exit(1); });
