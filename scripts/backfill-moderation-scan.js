#!/usr/bin/env node
// Backfill SafeSearch moderation over all pre-moderation mediaAssets docs.
// Reuses the shipped computeModerationStatus thresholds (functions/lib build).
// Additive metadata only; re-runnable; skips docs already scanned.
const admin = require('../functions/node_modules/firebase-admin');
const vision = require('../functions/node_modules/@google-cloud/vision');
const { computeModerationStatus } = require('../functions/lib/intel/mediaModeration.js');
admin.initializeApp({
  credential: admin.credential.cert(require('../mobile-app/scripts/serviceAccount.json')),
  storageBucket: 'wugi-prod.firebasestorage.app',
});
const db = admin.firestore();
const path = require('path');
const client = new vision.ImageAnnotatorClient({ keyFilename: path.join(__dirname, '../mobile-app/scripts/serviceAccount.json') });
const BUCKET = 'wugi-prod.firebasestorage.app';

// same derivation logic as dashboard's assetEntriesFromMediaDoc: typed assets, else legacy storagePaths
function entriesOf(data) {
  if (Array.isArray(data.assets) && data.assets.length) {
    return data.assets.filter((a) => a && a.path).map((a) => ({ path: a.type === 'video' ? (a.posterPath || null) : a.path, isPoster: a.type === 'video' }));
  }
  if (Array.isArray(data.storagePaths)) {
    return data.storagePaths.filter((p) => typeof p === 'string' && /\.(jpe?g|png|webp)$/i.test(p)).map((p) => ({ path: p, isPoster: false }));
  }
  return [];
}
(async () => {
  const snap = await db.collection('mediaAssets').get();
  let scannedDocs = 0, skipped = 0, flaggedDocs = 0, imgCount = 0, errCount = 0;
  const flaggedList = [];
  for (const d of snap.docs) {
    const x = d.data();
    if (x.moderationStatus && x.moderationStatus !== 'unscanned') { skipped++; continue; }
    const entries = entriesOf(x).filter((e) => e.path);
    if (!entries.length) { await d.ref.update({ moderationStatus: 'unscanned' }); skipped++; continue; }
    let worst = 'clear';
    const perAsset = [];
    for (const e of entries) {
      try {
        const [r] = await client.safeSearchDetection(`gs://${BUCKET}/${e.path}`);
        const s = r.safeSearchAnnotation || {};
        const status = computeModerationStatus({ adult: s.adult, racy: s.racy, violence: s.violence, medical: s.medical, spoof: s.spoof });
        perAsset.push({ path: e.path, adult: s.adult, racy: s.racy, violence: s.violence, status });
        if (status === 'flagged') worst = 'flagged';
        imgCount++;
      } catch (err) { errCount++; perAsset.push({ path: e.path, error: String(err.message).slice(0, 80) }); }
    }
    const status = perAsset.every((p) => p.error) ? 'unscanned' : worst;
    await d.ref.update({ moderationStatus: status, safeSearchResults: perAsset, moderatedAt: admin.firestore.FieldValue.serverTimestamp(), moderationSource: 'backfill-2026-08-01' });
    scannedDocs++;
    if (status === 'flagged') { flaggedDocs++; flaggedList.push(d.id + ' @' + (x.sourceAccount || '?') + ' :: ' + perAsset.filter(p=>p.status==='flagged').map(p=>`adult=${p.adult},racy=${p.racy},violence=${p.violence}`).join(' | ')); }
  }
  console.log(`docs scanned: ${scannedDocs} | skipped(already/empty): ${skipped} | images scanned: ${imgCount} | vision errors: ${errCount}`);
  console.log(`FLAGGED docs: ${flaggedDocs}`);
  flaggedList.forEach((f) => console.log('  ⚑', f));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
