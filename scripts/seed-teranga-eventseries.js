/**
 * Seed the 3 Teranga `eventSeries` docs — Build #76.
 *
 * Fully DATA-DRIVEN: nothing is hardcoded except the 3 gallery ids to anchor off.
 * For each gallery it reads `gallery.seriesId`, then reads a representative
 * existing event instance carrying that seriesId, and INHERITS the template
 * (title / venueId / venueName / category / age / about / media / vibes / time)
 * and DERIVES the recurrence (dayOfWeek + time + timezone) from that instance.
 *
 * eventSeries doc id = the seriesId. status = 'active'.
 * seriesSlug is derived from the representative instance id (strip trailing
 * -YYYY-MM-DD) so generateSeriesEvents produces ids consistent with existing
 * instances; falls back to the seriesId (minus the "series-" prefix).
 *
 * DRY RUN by default — prints exactly what it WOULD write and makes ZERO writes.
 * Pass --execute to actually write (set with merge, idempotent).
 *
 *   node scripts/seed-teranga-eventseries.js            # dry run
 *   node scripts/seed-teranga-eventseries.js --execute  # write
 */
const admin = require('firebase-admin');
const sa = require('./serviceAccount.json');

admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db = admin.firestore();

const DRY_RUN = !process.argv.includes('--execute');
const GALLERY_IDS = [
  'teranga-friday-night-vibes',
  'teranga-weekend-brunch',
  'teranga-saturday-night',
];
const TIMEZONE = 'America/New_York';
const WEEKDAY_TOKENS = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

// Derive 0–6 weekday: prefer dateISO; else the leading token of a display date
// like "SAT APR 5". Returns null if neither is parseable.
function weekdayOf(ev) {
  if (typeof ev.dateISO === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ev.dateISO)) {
    return new Date(`${ev.dateISO.slice(0, 10)}T00:00:00Z`).getUTCDay();
  }
  const tok = String(ev.date || '').trim().slice(0, 3).toUpperCase();
  return tok in WEEKDAY_TOKENS ? WEEKDAY_TOKENS[tok] : null;
}

// Strip a trailing -YYYY-MM-DD from an instance id to get the deterministic slug.
function slugFromInstanceId(instanceId, seriesId) {
  const m = String(instanceId || '').match(/^(.+)-\d{4}-\d{2}-\d{2}$/);
  return m ? m[1] : String(seriesId).replace(/^series-/, '');
}

// Pick the representative instance: prefer one WITH dateISO (best for weekday
// derivation), newest first; else fall back to the first doc.
function pickRepresentative(docs) {
  const withISO = docs
    .filter(d => typeof d.data().dateISO === 'string')
    .sort((a, b) => (b.data().dateISO < a.data().dateISO ? -1 : 1));
  return (withISO[0] || docs[0]) || null;
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no writes\n' : '🚀 EXECUTE — writing eventSeries docs\n');

  for (const galleryId of GALLERY_IDS) {
    console.log(`── ${galleryId} ─────────────────────────────`);
    const g = await db.collection('galleries').doc(galleryId).get();
    if (!g.exists) { console.log('  ❌ gallery missing — skip\n'); continue; }
    const seriesId = g.data().seriesId;
    if (!seriesId) { console.log('  ❌ gallery has no seriesId — skip\n'); continue; }

    const snap = await db.collection('events').where('seriesId', '==', seriesId).get();
    if (snap.empty) { console.log(`  ❌ no events for seriesId=${seriesId} — skip\n`); continue; }
    const rep = pickRepresentative(snap.docs);
    const ev = rep.data();

    const dayOfWeek = weekdayOf(ev);
    if (dayOfWeek === null) { console.log(`  ❌ cannot derive weekday from rep ${rep.id} — skip\n`); continue; }
    const seriesSlug = slugFromInstanceId(rep.id, seriesId);

    const doc = {
      status: 'active',
      title: ev.title || '',
      venue: ev.venue || ev.venueName || '',
      venueName: ev.venueName || ev.venue || '',
      venueId: ev.venueId || '',
      category: ev.category ?? null,
      age: ev.age || '21+',
      about: ev.about || '',
      media: ev.media || [],
      vibes: ev.vibes || [],
      time: ev.time || '9:00 PM',
      seriesSlug,
      recurrence: { dayOfWeek, frequency: 'weekly', timezone: TIMEZONE },
    };

    console.log(`  seriesId (doc id) : ${seriesId}`);
    console.log(`  representative ev : ${rep.id} (dateISO=${ev.dateISO || 'none'}, date="${ev.date || ''}")`);
    console.log(`  seriesSlug        : ${seriesSlug}`);
    console.log(`  recurrence        : day=${dayOfWeek} (${Object.keys(WEEKDAY_TOKENS)[dayOfWeek]}), weekly, ${TIMEZONE}, time="${doc.time}"`);
    console.log(`  inherited         : title="${doc.title}", venueId=${doc.venueId}, age=${doc.age}, media=${doc.media.length}, vibes=${doc.vibes.length}`);
    console.log(`  WOULD WRITE eventSeries/${seriesId}:`);
    console.log('  ' + JSON.stringify(doc));

    if (!DRY_RUN) {
      await db.collection('eventSeries').doc(seriesId).set(doc, { merge: true });
      console.log('  ✅ written');
    }
    console.log('');
  }

  console.log(DRY_RUN ? 'DRY RUN complete — 0 writes.' : 'Done.');
  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
