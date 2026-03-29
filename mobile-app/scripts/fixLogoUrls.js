/**
 * Wugi — fixLogoUrls.js
 * Fixes HTML-encoded ampersands in logoUrl fields saved by fetchInstagramLogos.js
 * Run once: node fixLogoUrls.js
 */
require('dotenv').config({ path: __dirname + '/.env' });
const admin = require('firebase-admin');
const sa = require('./serviceAccount.json');
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db = admin.firestore();

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

async function fix() {
  console.log('🔧 Fixing HTML-encoded logoUrls...\n');
  const snap = await db.collection('venues').where('logoUrl', '!=', '').get();
  const batch = db.batch();
  let fixed = 0;
  snap.docs.forEach(doc => {
    const url = doc.data().logoUrl || '';
    if (url.includes('&amp;')) {
      batch.update(doc.ref, { logoUrl: decodeHtml(url) });
      fixed++;
    }
  });
  if (fixed > 0) {
    await batch.commit();
    console.log(`✅ Fixed ${fixed} venue logo URLs`);
  } else {
    console.log('No URLs needed fixing');
  }
  process.exit(0);
}
fix().catch(e => { console.error(e); process.exit(1); });
