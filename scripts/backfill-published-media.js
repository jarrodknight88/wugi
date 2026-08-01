#!/usr/bin/env node
// Backfill: re-materialize dead signed URLs on the 3 broken events + 1 series template.
// DRY-RUN by default. --execute to write. Backs up target docs to scripts/backups/ first.
const admin = require('../functions/node_modules/firebase-admin');
const crypto = require('crypto');
const fs = require('fs');
admin.initializeApp({
  credential: admin.credential.cert(require('../mobile-app/scripts/serviceAccount.json')),
  storageBucket: 'wugi-prod.firebasestorage.app',
});
const db = admin.firestore();
const bucket = admin.storage().bucket();
const EXECUTE = process.argv.includes('--execute');
const TARGETS = [
  { col: 'events', id: 'eiErHMNQcyyFezS5BdpP' },
  { col: 'events', id: 'signature-saturdays-at-bamboo-bamboo-2026-08-01' },
  { col: 'events', id: 'FDF6ZiUgQqwCeggWYWyp' },
  { col: 'eventSeries', id: '556W86i4DHuW3HmyVpIE' },
];
const isDeadSigned = (u) => typeof u === 'string' && /X-Goog-Expires/.test(u) && u.includes('/intel-media/');
const objectPathOf = (u) => decodeURIComponent(new URL(u).pathname.replace(/^\/[^/]+\//, ''));
async function materialize(srcPath) {
  const destPath = 'published-media/' + srcPath.replace(/^intel-media\//, '');
  const dest = bucket.file(destPath);
  const [exists] = await dest.exists();
  let token;
  if (exists) {
    const [meta] = await dest.getMetadata();
    token = (meta.metadata || {}).firebaseStorageDownloadTokens;
  }
  if (!token) {
    token = crypto.randomUUID();
    if (EXECUTE) {
      await bucket.file(srcPath).copy(dest);
      await dest.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
    }
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destPath)}?alt=media&token=${exists && token ? token : token}`;
}
(async () => {
  console.log(EXECUTE ? '*** EXECUTE MODE ***' : '*** DRY RUN (no writes) ***');
  for (const t of TARGETS) {
    const snap = await db.collection(t.col).doc(t.id).get();
    if (!snap.exists) { console.log(`SKIP ${t.col}/${t.id} — not found`); continue; }
    const data = snap.data();
    if (EXECUTE) {
      fs.mkdirSync('scripts/backups', { recursive: true });
      fs.writeFileSync(`scripts/backups/${t.col}-${t.id}-${Date.now()}.json`, JSON.stringify(data, null, 2));
    }
    const media = data.media || [];
    const updates = {};
    let changed = 0;
    const newMedia = [];
    for (const m of media) {
      if (m && isDeadSigned(m.uri)) {
        const src = objectPathOf(m.uri);
        const [srcExists] = await bucket.file(src).exists();
        if (!srcExists) { console.log(`  !! source MISSING: ${src} — leaving as-is`); newMedia.push(m); continue; }
        const url = await materialize(src);
        newMedia.push({ ...m, uri: url });
        changed++;
        console.log(`  media: ${src}  ->  published-media/${src.replace(/^intel-media\//,'')}`);
      } else newMedia.push(m);
    }
    if (changed) updates.media = newMedia;
    if (isDeadSigned(data.coverImage)) {
      const src = objectPathOf(data.coverImage);
      const [srcExists] = await bucket.file(src).exists();
      if (srcExists) { updates.coverImage = await materialize(src); console.log(`  coverImage: ${src} -> materialized`); }
      else console.log(`  !! coverImage source MISSING: ${src}`);
    }
    const n = Object.keys(updates).length;
    console.log(`${t.col}/${t.id}: ${changed} media rewritten, coverImage ${updates.coverImage ? 'rewritten' : 'untouched'} ${n ? '' : '— NOTHING TO DO'}`);
    if (EXECUTE && n) await db.collection(t.col).doc(t.id).update(updates);
  }
  console.log(EXECUTE ? 'DONE — writes applied.' : 'DRY RUN complete — no writes. Re-run with --execute to apply.');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
