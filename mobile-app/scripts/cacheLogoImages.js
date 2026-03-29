/**
 * Wugi — cacheLogoImages.js
 * Downloads Instagram profile pics and stores them in Firebase Storage.
 * This gives permanent URLs that don't expire.
 *
 * Usage:
 *   node cacheLogoImages.js --test    ← test 5 venues
 *   node cacheLogoImages.js           ← run all venues
 */
require('dotenv').config({ path: __dirname + '/.env' });
const admin  = require('firebase-admin');
const https  = require('https');
const http   = require('http');
const sa     = require('./serviceAccount.json');

admin.initializeApp({
  credential:  admin.credential.cert(sa),
  projectId:   'wugi-prod',
  storageBucket: 'wugi-prod.firebasestorage.app',
});

const db      = admin.firestore();
const bucket  = admin.storage().bucket();
const args    = process.argv.slice(2);
const TEST    = args.includes('--test');

function downloadBuffer(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      timeout: 10000,
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadBuffer(res.headers.location).then(resolve);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/jpeg' }));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('☁️  Wugi — Logo Image Cache to Firebase Storage\n');
  const snap = await db.collection('venues')
    .where('logoUrl', '!=', '')
    .get();

  let venues = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(v => v.logoUrl && v.logoUrl.includes('cdninstagram.com'));

  if (TEST) venues = venues.slice(0, 5);
  console.log(`Uploading ${venues.length} logos to Firebase Storage...\n`);

  let success = 0, failed = 0;

  for (const venue of venues) {
    process.stdout.write(`  ${venue.name}... `);
    const result = await downloadBuffer(venue.logoUrl);
    if (!result) { console.log('⚠️  download failed'); failed++; continue; }

    const ext      = result.contentType.includes('png') ? 'png' : 'jpg';
    const filePath = `venue-logos/${venue.id}.${ext}`;
    const file     = bucket.file(filePath);

    await file.save(result.buffer, {
      metadata: { contentType: result.contentType },
      public: true,
    });

    const publicUrl = `https://storage.googleapis.com/wugi-prod.firebasestorage.app/${filePath}`;
    await db.collection('venues').doc(venue.id).update({
      logoUrl:       publicUrl,
      logoSource:    'firebase_storage',
      logoFetchedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log('✅');
    success++;
    await delay(200);
  }

  console.log(`\n✅ ${success} logos uploaded to Firebase Storage`);
  console.log(`⚠️  ${failed} failed`);
  if (TEST) console.log('\nRun without --test to process all venues.');
  process.exit(0);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
