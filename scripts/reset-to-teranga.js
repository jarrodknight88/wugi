/**
 * Teranga-only reset — consolidate venues, purge non-Teranga events, and
 * (re)create the 4 orphaned Teranga weekly eventSeries docs.
 *
 * Decisions encoded here (from the 2026-07-07 prod audit + eventSeries dump):
 *   • Keeper venue: teranga-city-brookhaven (approved, 90 events). The closed
 *     0-event dupes `teranga` and `teranga-city` are deleted.
 *   • Afro District: keep AFRO_KEEPER, delete the other (both have 0 events).
 *     Flip the two constants below if you prefer the gp_ doc instead.
 *   • eventSeries: existing real series (Fri 9PM Night Vibes, Sat 9PM
 *     Afrobeats, Sun 12PM Brunch) are untouched. The test doc
 *     `oQ9gsbtHvmKQ5wB78JYk` ("Series Test Sundays" — no recurrence, never
 *     generates) is deleted. The 4 orphaned weeklies (Thu 5PM R&B, Fri 5PM
 *     Happy Hour, Sat 12PM Seafood Brunch, Wed 9PM World Wide) are recreated
 *     DATA-DRIVEN from a representative existing instance, exactly like
 *     seed-teranga-eventseries.js — no overlap with the existing three.
 *   • Events: every event NOT on the keeper venue is deleted. Events with
 *     hasTickets:true are NEVER deleted — they are reported for manual review
 *     (tickets/passes reference them).
 *
 * Phases (in order):
 *   1. Seed the 4 missing Teranga weekly eventSeries docs (set with merge).
 *   2. Delete junk eventSeries docs.
 *   3. Venue cleanup: delete Teranga dupes; Afro District keep/delete pair
 *      (keeper gets status:'approved' if missing so it's visible in-app).
 *   4. Purge all events whose venueId !== keeper (ticketed events skipped).
 *
 * DRY RUN by default — prints exactly what it WOULD do and writes NOTHING.
 *
 *   node scripts/reset-to-teranga.js            # dry run
 *   node scripts/reset-to-teranga.js --execute  # apply
 *
 * Galleries are NOT touched (follow-up: non-Teranga galleries will dangle).
 */
const admin = require('firebase-admin');
const sa = require('./serviceAccount.json');

admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db = admin.firestore();

const DRY_RUN = !process.argv.includes('--execute');
const TIMEZONE = 'America/New_York';

const KEEPER_VENUE = 'teranga-city-brookhaven';
const VENUES_TO_DELETE = ['teranga', 'teranga-city'];
const AFRO_KEEPER = 'afro-district-atl';
const AFRO_DELETE = 'gp_ChIJqfG3ERYF9YgRJaVYLIR7G4U';

const SERIES_TO_DELETE = ['oQ9gsbtHvmKQ5wB78JYk']; // "Series Test Sundays" test junk

// Orphaned weekly seriesIds to recreate. The template + recurrence are derived
// from a representative existing instance; nothing here is hardcoded content.
const SERIES_TO_SEED = [
  'series-teranga-city-brookhaven-5-r-b-thursday-happy-hour',
  'series-teranga-city-brookhaven-friday-happy-hour-at-teranga',
  'series-teranga-city-brookhaven-saturday-seafood-brunch',
  'series-teranga-city-brookhaven-world-wide-wednesdays',
];

const WEEKDAY_TOKENS = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const WEEKDAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function weekdayOf(ev) {
  if (typeof ev.dateISO === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ev.dateISO)) {
    return new Date(`${ev.dateISO.slice(0, 10)}T00:00:00Z`).getUTCDay();
  }
  const tok = String(ev.date || '').trim().slice(0, 3).toUpperCase();
  return tok in WEEKDAY_TOKENS ? WEEKDAY_TOKENS[tok] : null;
}

function slugFromInstanceId(instanceId, seriesId) {
  const m = String(instanceId || '').match(/^(.+)-\d{4}-\d{2}-\d{2}$/);
  return m ? m[1] : String(seriesId).replace(/^series-/, '');
}

function pickRepresentative(docs) {
  const withISO = docs
    .filter(d => typeof d.data().dateISO === 'string')
    .sort((a, b) => (b.data().dateISO < a.data().dateISO ? -1 : 1));
  return (withISO[0] || docs[0]) || null;
}

// Delete a list of refs in batches of 400.
async function batchDelete(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    refs.slice(i, i + 400).forEach(r => batch.delete(r));
    await batch.commit();
  }
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no writes\n' : '🚀 EXECUTE — applying reset\n');

  // ── Phase 1: seed the 4 missing Teranga weekly eventSeries ──
  console.log('── Phase 1: seed missing Teranga weekly eventSeries ──');
  for (const seriesId of SERIES_TO_SEED) {
    const existing = await db.collection('eventSeries').doc(seriesId).get();
    if (existing.exists) { console.log(`  ✅ ${seriesId} already exists — skip`); continue; }

    const snap = await db.collection('events').where('seriesId', '==', seriesId).get();
    if (snap.empty) { console.log(`  ❌ ${seriesId}: no instances found — skip`); continue; }
    const rep = pickRepresentative(snap.docs);
    const ev = rep.data();
    const dayOfWeek = weekdayOf(ev);
    if (dayOfWeek === null) { console.log(`  ❌ ${seriesId}: cannot derive weekday — skip`); continue; }

    const doc = {
      status: 'active',
      title: ev.title || '',
      venue: ev.venue || ev.venueName || '',
      venueName: ev.venueName || ev.venue || '',
      venueId: ev.venueId || KEEPER_VENUE,
      category: ev.category ?? null,
      age: ev.age || '21+',
      about: ev.about || '',
      media: ev.media || [],
      vibes: ev.vibes || [],
      time: ev.time || '9:00 PM',
      seriesSlug: slugFromInstanceId(rep.id, seriesId),
      recurrence: { dayOfWeek, frequency: 'weekly', timezone: TIMEZONE },
    };
    console.log(`  ➕ ${seriesId}`);
    console.log(`     "${doc.title}" — ${WEEKDAY_NAMES[dayOfWeek]} ${doc.time}, slug=${doc.seriesSlug}, from ${snap.size} instances (rep ${rep.id})`);
    if (!DRY_RUN) {
      await db.collection('eventSeries').doc(seriesId).set(doc, { merge: true });
      console.log('     ✅ written');
    }
  }

  // ── Phase 2: delete junk eventSeries ──
  console.log('\n── Phase 2: delete junk eventSeries ──');
  for (const id of SERIES_TO_DELETE) {
    const s = await db.collection('eventSeries').doc(id).get();
    if (!s.exists) { console.log(`  ✅ ${id} already gone`); continue; }
    console.log(`  🗑️  ${id} ("${s.data().name || s.data().title || ''}")`);
    if (!DRY_RUN) await s.ref.delete();
  }

  // ── Phase 3: venue cleanup ──
  console.log('\n── Phase 3: venue cleanup ──');
  for (const id of [...VENUES_TO_DELETE, AFRO_DELETE]) {
    const v = await db.collection('venues').doc(id).get();
    if (!v.exists) { console.log(`  ✅ ${id} already gone`); continue; }
    const evCount = (await db.collection('events').where('venueId', '==', id).get()).size;
    if (evCount > 0) {
      console.log(`  ⚠️  ${id} ("${v.data().name}") has ${evCount} events — NOT deleting; repoint or purge first`);
      continue;
    }
    console.log(`  🗑️  ${id} ("${v.data().name}", 0 events)`);
    if (!DRY_RUN) await v.ref.delete();
  }
  const afroKeeper = await db.collection('venues').doc(AFRO_KEEPER).get();
  if (afroKeeper.exists && !afroKeeper.data().status) {
    console.log(`  ✏️  ${AFRO_KEEPER}: set status:'approved' (was missing — invisible in app)`);
    if (!DRY_RUN) await afroKeeper.ref.update({ status: 'approved' });
  }

  // ── Phase 4: purge all non-keeper events ──
  console.log('\n── Phase 4: purge events not at keeper venue ──');
  const all = await db.collection('events').get();
  const toDelete = [];
  const ticketed = [];
  let kept = 0;
  for (const d of all.docs) {
    const ev = d.data();
    if (ev.venueId === KEEPER_VENUE) { kept++; continue; }
    if (ev.hasTickets === true) { ticketed.push(d); continue; }
    toDelete.push(d);
  }
  console.log(`  events total   : ${all.size}`);
  console.log(`  kept (keeper)  : ${kept}`);
  console.log(`  ticketed SKIP  : ${ticketed.length}`);
  for (const d of ticketed) {
    console.log(`    ⚠️  ${d.id} — "${d.data().title}" @ ${d.data().venueName || d.data().venueId} (hasTickets — review manually)`);
  }
  console.log(`  to DELETE      : ${toDelete.length}`);
  const sample = toDelete.slice(0, 10);
  for (const d of sample) console.log(`    🗑️  ${d.id} — "${d.data().title}"`);
  if (toDelete.length > sample.length) console.log(`    … and ${toDelete.length - sample.length} more`);
  if (!DRY_RUN) {
    await batchDelete(toDelete.map(d => d.ref));
    console.log(`  ✅ deleted ${toDelete.length} events`);
  }

  console.log(DRY_RUN
    ? '\n🔍 DRY RUN complete — 0 writes. Re-run with --execute to apply.'
    : '\n✅ Reset complete. Run generateSeriesEvents (or wait for the nightly job) to extend the seeded weeklies.');
  process.exit(0);
}

main().catch(e => { console.error('ERR', e); process.exit(1); });
