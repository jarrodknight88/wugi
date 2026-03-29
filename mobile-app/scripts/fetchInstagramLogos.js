/**
 * Wugi — fetchInstagramLogos.js
 * Pulls Instagram profile pic URLs and saves as logoUrl on venue docs.
 * No SerpAPI needed — scrapes og:image from public Instagram profiles.
 *
 * Usage:
 *   node fetchInstagramLogos.js --test    ← test 5 venues
 *   node fetchInstagramLogos.js           ← run all venues
 *   node fetchInstagramLogos.js --force   ← re-fetch even if logoUrl exists
 */
require('dotenv').config({ path: __dirname + '/.env' });
const admin  = require('firebase-admin');
const https  = require('https');
const serviceAccount = require('./serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'wugi-prod',
});

const db   = admin.firestore();
const args = process.argv.slice(2);
const TEST  = args.includes('--test');
const FORCE = args.includes('--force');

function fetchProfilePic(handle) {
  const clean = handle.replace('@', '').trim();
  return new Promise((resolve) => {
    const req = https.get(
      `https://www.instagram.com/${clean}/`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
          'Accept': 'text/html',
        },
        timeout: 8000,
      },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          const match = data.match(/<meta property="og:image" content="([^"]+)"/);
          if (match && match[1]) {
            // Decode HTML entities (og:image URLs contain &amp; instead of &)
            const url = match[1]
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"');
            resolve(url);
          } else {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('📸 Wugi — Instagram Logo Fetcher\n');
  const snap = await db.collection('venues')
    .where('status', 'in', ['unclaimed', 'approved'])
    .get();

  let venues = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(v => v.instagram && !v.instagramInferred && v.instagramSource !== 'inferred');

  if (!FORCE) venues = venues.filter(v => !v.logoUrl);
  if (TEST)   venues = venues.slice(0, 5);

  console.log(`Processing ${venues.length} venues...\n`);

  let success = 0, failed = 0;

  for (const venue of venues) {
    const handle = venue.instagram?.replace('@', '').trim();
    if (!handle) continue;
    process.stdout.write(`  ${venue.name} (@${handle})... `);

    const logoUrl = await fetchProfilePic(handle);
    if (logoUrl) {
      await db.collection('venues').doc(venue.id).update({
        logoUrl,
        logoSource:    'instagram',
        logoFetchedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log('✅');
      success++;
    } else {
      console.log('⚠️  failed');
      failed++;
    }
    await delay(1500);
  }

  console.log(`\n✅ ${success} logos saved`);
  console.log(`⚠️  ${failed} failed (app shows initials as fallback)`);
  if (TEST) console.log('\nRun without --test to process all venues.');
  process.exit(0);
}

run().catch(e => { console.error('❌', e); process.exit(1); });
