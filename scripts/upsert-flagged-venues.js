#!/usr/bin/env node
/**
 * Wugi — upsert-flagged-venues.js
 *
 * Upserts the 22 Google-verified flagged demo venues from
 * scripts/data/flagged-venues.json into /venues on wugi-prod.
 *
 * Run from monorepo root (firebase-admin resolves from functions/):
 *   NODE_PATH=./functions/node_modules node scripts/upsert-flagged-venues.js
 *   NODE_PATH=./functions/node_modules node scripts/upsert-flagged-venues.js --execute
 *
 * --dry-run is the DEFAULT. --execute performs writes and is gated on
 * Jarrod's explicit word. A full /venues backup is written before ANY write.
 *
 * DELIBERATELY NEVER WRITTEN (verified against live schema 2026-07-26):
 *   tier          — live value is claim state ("unclaimed" x483), NOT the
 *                   manifest's C/S/A. Manifest tier is script bookkeeping only.
 *   venue         — legacy field; 0 of 492 docs carry it, nothing reads it.
 *   source        — pipeline provenance ("google-places" x482). We add
 *                   manualVerifiedAt/By alongside instead of clobbering it.
 *   attributes    — live shape is an ARRAY of display tags. Structured data
 *                   (afterHours, venueSpecial) goes in its own top-level field.
 */
const path  = require('path');
const fs    = require('fs');
const admin = require('firebase-admin');

const EXECUTE = process.argv.includes('--execute');
const ONLY    = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || null;

const SA = path.join(__dirname, 'serviceAccount.json');
if (!fs.existsSync(SA)) { console.error('FATAL: scripts/serviceAccount.json not found'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(SA)), projectId: 'wugi-prod' });
const db  = admin.firestore();
const FV  = admin.firestore.FieldValue;
const NOW = new Date().toISOString().replace(/[:.]/g, '-');

const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/flagged-venues.json'), 'utf8'));
const SOURCE_TAG = 'flagged-venue-upsert-2026-07';

const C = { r:'\x1b[31m', g:'\x1b[32m', y:'\x1b[33m', b:'\x1b[36m', d:'\x1b[2m', x:'\x1b[0m', bold:'\x1b[1m' };
const c = (col, s) => `${C[col]}${s}${C.x}`;

/** Full /venues backup — always, before any write. */
async function backupVenues() {
  const dir = path.join(__dirname, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const snap = await db.collection('venues').get();
  const out  = {};
  snap.forEach(d => { out[d.id] = JSON.parse(JSON.stringify(d.data())); });
  const file = path.join(dir, `venues-backup-${NOW}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(c('g', `\n  BACKUP: ${snap.size} docs -> ${path.relative(process.cwd(), file)}\n`));
  return file;
}

/** Deep-ish equality for diffing scalar/object/array field values. */
const eq = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

const short = v => {
  if (v === undefined) return c('d', '<unset>');
  if (v === null)      return c('d', 'null');
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 92 ? s.slice(0, 89) + '…' : s;
};

/** Build the proposed field patch for one manifest venue. */
function buildPatch(v, cur) {
  const patch = {};
  const skipped = [];

  if (v.renameTo || v.mode === 'create') patch.name = v.renameTo || v.name;
  patch.address       = v.address;
  patch.phone         = v.phone;
  patch.googlePlaceId = v.googlePlaceId;
  patch.status        = 'approved';
  patch.isActive      = true;

  // location — write the 4-key superset; three shapes coexist live
  // ({lat,lng} x283, all-four x202, {latitude,longitude} x2) and a
  // geofence depends on this eventually. Superset satisfies all readers.
  if (v.coordsSuspect) {
    skipped.push(`location — COORDS SUSPECT, withheld (${v.lat}, ${v.lng})`);
  } else {
    patch.location = { lat: v.lat, lng: v.lng, latitude: v.lat, longitude: v.lng };
  }

  // hours object has zero consumers today; hoursText is what VenueScreen renders.
  // For CURATED docs we skip BOTH. Overwriting `hours` while preserving the
  // hand-written `hoursText` yields self-contradicting docs — e.g. Vision's
  // curated text says "Closed Wed" while Google's hours say Wed 11AM-5PM.
  // The curated hours object IS curated data. (Jarrod approved 2026-07-26.)
  if (v.curated) {
    skipped.push('hours + hoursText — curated doc, both preserved (Google hours contradict curated text)');
  } else {
    patch.hours     = v.hours;
    patch.hoursText = v.hoursText;
  }

  if (v.afterHours)    patch.afterHours    = v.afterHours;
  if (v.venueSpecial)  patch.venueSpecial  = v.venueSpecial;
  if (v.neighborhood)  patch.neighborhood  = v.neighborhood;
  if (v.mode === 'create') {
    patch.slug       = v.canonicalDocId.replace(/-atl$/, '');
    patch.market     = 'atlanta';
    patch.isTestVenue = false;
    patch.isFeatured = false;
    patch.source     = 'google-places';
    patch.attributes = [];
    patch.vibes      = [];
    patch.media      = [];
  }
  patch.manualVerifiedBy = SOURCE_TAG;
  return { patch, skipped };
}

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

/** Verify the pre-resolved canonical doc, or fall back to exact name+alias match.
 *  Substring matching is DELIBERATELY absent — it false-positived
 *  "Flo" against "Floating Brunch ATL LLC" during resolution. */
function resolve(v, allDocs) {
  const byId = allDocs.find(d => d.id === v.canonicalDocId);
  if (byId) return { doc: byId, how: 'pinned canonicalDocId' };
  if (v.mode === 'create') {
    const names = [v.name, ...(v.aliases || [])].map(norm);
    const hits  = allDocs.filter(d => names.includes(norm(d.data.name)));
    if (hits.length === 1) return { doc: hits[0], how: c('y', 'name/alias hit — expected CREATE but a doc exists') };
    if (hits.length > 1)   return { doc: null, ambiguous: hits, how: c('r', 'AMBIGUOUS') };
    return { doc: null, how: 'no doc — will CREATE' };
  }
  return { doc: null, how: c('r', `MISSING — pinned doc ${v.canonicalDocId} not found`) };
}

(async () => {
  console.log(c('bold', `\n${'='.repeat(78)}`));
  console.log(c('bold', `  FLAGGED-VENUE UPSERT — ${EXECUTE ? c('r', 'EXECUTE (WRITES ENABLED)') : c('g', 'DRY RUN (no writes)')}`));
  console.log(c('bold', `${'='.repeat(78)}`));

  const snap = await db.collection('venues').get();
  const allDocs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
  console.log(`  /venues docs loaded: ${allDocs.length}`);

  let backupFile = null;
  if (EXECUTE) backupFile = await backupVenues();

  const plan = { update: [], create: [], archive: [], problems: [] };
  const venues = MANIFEST.venues.filter(v => !ONLY || v.key === ONLY);

  for (const v of venues) {
    const { doc, how, ambiguous } = resolve(v, allDocs);
    console.log(c('bold', `\n${'─'.repeat(78)}`));
    console.log(c('bold', `  ${v.name}`) + c('d', `  [${v.key}]  tier=${v.manifestTier}  ${v.curated ? 'CURATED' : ''}`));
    console.log(c('d', `  resolve: ${how}`));

    if (ambiguous) {
      console.log(c('r', `  AMBIGUOUS — ${ambiguous.map(d => d.id).join(' | ')} — REPORT ONLY, no write`));
      plan.problems.push({ key: v.key, why: 'ambiguous', ids: ambiguous.map(d => d.id) });
      continue;
    }
    if (!doc && v.mode === 'update') {
      console.log(c('r', `  pinned doc missing — skipping (manifest needs correcting)`));
      plan.problems.push({ key: v.key, why: 'pinned doc missing', ids: [v.canonicalDocId] });
      continue;
    }

    const cur = doc ? doc.data : {};
    const { patch, skipped } = buildPatch(v, cur);

    if (v.unarchive && cur.status === 'archived') {
      console.log(c('y', `  UN-ARCHIVE: status archived -> approved (reverses 2026-07-07 decision, Jarrod approved)`));
    }

    const changes = Object.entries(patch).filter(([k, nv]) => !eq(cur[k], nv));
    if (!doc) {
      console.log(c('g', `  CREATE ${v.canonicalDocId}`));
      Object.entries(patch).forEach(([k, nv]) => console.log(`    ${c('g','+')} ${k.padEnd(16)} ${short(nv)}`));
      plan.create.push({ v, patch });
    } else if (changes.length === 0) {
      console.log(c('d', `  no changes`));
    } else {
      console.log(`  UPDATE ${doc.id} ${c('d', `(${changes.length} field${changes.length>1?'s':''})`)}`);
      changes.forEach(([k, nv]) => {
        console.log(`    ${c('y','~')} ${k.padEnd(16)} ${c('r', short(cur[k]))}`);
        console.log(`      ${' '.repeat(16)} ${c('g', '-> ' + short(nv))}`);
      });
      plan.update.push({ v, doc, patch });
    }
    skipped.forEach(s => console.log(`    ${c('b','·')} skip ${s}`));
    if (v.lowConfidence) console.log(c('y', `    ! LOW CONFIDENCE — ${v.review}`));
    else if (v.review)   console.log(c('d', `    note: ${v.review}`));

    for (const aid of v.archiveDocIds) {
      const ad = allDocs.find(d => d.id === aid);
      if (!ad) { console.log(c('r', `    archive target ${aid} not found`)); continue; }
      console.log(c('y', `    ARCHIVE ${aid}`) + c('d', ` "${ad.data.name}" status=${ad.data.status} -> archived, replacedBy=${v.canonicalDocId}`));
      plan.archive.push({ id: aid, replacedBy: v.canonicalDocId, name: ad.data.name });
    }
  }

  console.log(c('bold', `\n${'='.repeat(78)}`));
  console.log(c('bold', '  SUMMARY'));
  console.log(`    updates:  ${plan.update.length}`);
  console.log(`    creates:  ${plan.create.length}`);
  console.log(`    archives: ${plan.archive.length}`);
  console.log(`    problems: ${plan.problems.length}${plan.problems.length ? c('r', ' <-- REVIEW') : ''}`);
  plan.problems.forEach(p => console.log(c('r', `      - ${p.key}: ${p.why} (${p.ids.join(', ')})`)));

  if (!EXECUTE) {
    console.log(c('g', `\n  DRY RUN — nothing written. Re-run with --execute to apply.\n`));
    process.exit(0);
  }

  console.log(c('r', `\n  EXECUTING WRITES…`));
  const batch = db.batch();
  const stamp = { manualVerifiedAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() };
  plan.update.forEach(({ doc, patch }) => batch.set(db.collection('venues').doc(doc.id), { ...patch, ...stamp }, { merge: true }));
  plan.create.forEach(({ v, patch }) => batch.set(db.collection('venues').doc(v.canonicalDocId), { ...patch, ...stamp, createdAt: FV.serverTimestamp() }, { merge: true }));
  plan.archive.forEach(a => batch.set(db.collection('venues').doc(a.id), {
    status: 'archived', isActive: false, isFeatured: false,
    replacedBy: a.replacedBy,
    archivedNote: `Duplicate of ${a.replacedBy} (canonical). Soft-archived ${new Date().toISOString().slice(0,10)} by ${SOURCE_TAG}. Backup: ${path.basename(backupFile)}`,
    archivedAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(),
  }, { merge: true }));

  await batch.commit();
  console.log(c('g', `  DONE — ${plan.update.length} updated, ${plan.create.length} created, ${plan.archive.length} archived.`));
  console.log(c('d', `  Backup: ${backupFile}\n`));
  process.exit(0);
})().catch(e => { console.error(c('r', 'FATAL'), e); process.exit(1); });
