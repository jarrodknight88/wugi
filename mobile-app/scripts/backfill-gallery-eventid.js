#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────
 * Wugi — Build #74 §8 — gallery.eventId backfill  (DRY-RUN BY DEFAULT)
 *
 * Problem: every gallery doc in the top-level `galleries` collection has
 * eventId:null in prod, so EventScreen can't resolve "this event's gallery"
 * (getGalleriesByEvent returns nothing) and falls back to a generic gallery.
 * This script proposes a gallery → eventId mapping so each gallery can be
 * linked to the event it documents.
 *
 * MATCHING HEURISTIC (read the dry-run output before trusting it):
 *   Candidates for a gallery are events with the SAME venueId. Each candidate
 *   is scored:
 *     • title  — normalized (lowercase, emoji/punct stripped, whitespace
 *                collapsed). Exact match = strong; token-subset/overlap =
 *                partial. Generic gallery titles ("Saturday Night",
 *                "Weekend Brunch") rarely match an event title, so title
 *                alone is not enough.
 *     • date   — normalized to MONTH+DAY (weekday prefix + year ignored,
 *                since both are display strings like "SAT MAY 17" / "TUE JUN 9").
 *                Same night = strong signal a gallery documents that event.
 *   A gallery is matched to its best-scoring candidate ONLY if the score
 *   clears CONFIDENCE_THRESHOLD. venueId is a hard prerequisite (no
 *   cross-venue matches). Ties and sub-threshold galleries are reported as
 *   UNMATCHED for manual review — never guessed.
 *
 * SAFETY:
 *   • Dry-run by default: reads `galleries` + `events`, prints the full
 *     proposed mapping + unmatched list, and EXITS WITHOUT WRITING.
 *   • A write pass exists but is double-gated: it requires BOTH the
 *     `--commit` flag AND the env var WUGI_BACKFILL_CONFIRM=yes. Per the
 *     Build #74 STOP POINT, do NOT run the commit pass until the dry-run
 *     mapping has been reviewed and approved. The commit pass only fills
 *     galleries whose eventId is currently null/absent (idempotent; never
 *     overwrites an existing link).
 *
 * Run (dry-run):  node scripts/backfill-gallery-eventid.js
 * Run (commit):   WUGI_BACKFILL_CONFIRM=yes node scripts/backfill-gallery-eventid.js --commit
 * ───────────────────────────────────────────────────────────────────── */
'use strict';

const path  = require('path');
const admin = require('firebase-admin');
const sa    = require(path.resolve(__dirname, 'serviceAccount.json'));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const COMMIT = process.argv.includes('--commit');
const CONFIRMED = process.env.WUGI_BACKFILL_CONFIRM === 'yes';
const CONFIDENCE_THRESHOLD = 2; // see scoring below

// ── COMMIT ALLOWLIST (human-approved, Build #74) ──────────────────────
// The commit pass writes ONLY these explicit gallery→event pairs — it does
// NOT write on score threshold alone. This deliberately excludes the two
// date-only "night → brunch" matches the dry-run surfaced (teranga-saturday-
// night and teranga-late-night-lounge), which were reviewed and REJECTED as
// false positives. Ambiguous + unmatched galleries stay eventId:null. Each
// write is still guarded to only fill a currently-null eventId.
const COMMIT_ALLOWLIST = [
  { galleryId: 'teranga-fifa-watch-party',   eventId: 'fifa-world-cup-opening-watch-party-teranga' },
  { galleryId: 'teranga-friday-night-vibes', eventId: 'friday-night-vibes-teranga-2026-05-15' },
  { galleryId: 'teranga-weekend-brunch',     eventId: 'sunday-brunch-teranga-2026-05-24' },
];

// ── Normalization helpers ─────────────────────────────────────────────
function normalizeTitle(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
// Pull MONTH+DAY out of a display date string ("SAT MAY 17", "TUE JUN 9",
// "May 17", etc.). Returns a comparable "M-D" key or '' when unparseable.
function normalizeDate(s) {
  if (!s) return '';
  const lower = String(s).toLowerCase();
  let month = '';
  for (const m of Object.keys(MONTHS)) {
    if (lower.includes(m)) { month = m; break; }
  }
  const dayMatch = lower.match(/\b(\d{1,2})\b/);
  if (!month || !dayMatch) return '';
  return `${MONTHS[month]}-${Number(dayMatch[1])}`;
}

// Token-overlap score between two normalized titles (0..1).
function titleOverlap(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

// Score a (gallery, event) pair. venueId equality is assumed by the caller.
//   +3  exact normalized title match
//   +2  strong title token overlap (>= 0.6)
//   +2  same MONTH+DAY
//   +1  weak title token overlap (>= 0.3)
// Threshold = 2 → at least one strong signal (exact/strong title OR same date).
function scoreMatch(g, e) {
  let score = 0;
  const gt = normalizeTitle(g.title), et = normalizeTitle(e.title || e.name);
  const ov = titleOverlap(gt, et);
  if (gt && gt === et) score += 3;
  else if (ov >= 0.6)  score += 2;
  else if (ov >= 0.3)  score += 1;

  const gd = normalizeDate(g.date), ed = normalizeDate(e.date);
  if (gd && ed && gd === ed) score += 2;

  return score;
}

async function main() {
  console.log(`\n=== gallery.eventId backfill — ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ===\n`);

  const [gSnap, eSnap] = await Promise.all([
    db.collection('galleries').get(),
    db.collection('events').get(),
  ]);

  const galleries = gSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const events    = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`Loaded ${galleries.length} galleries, ${events.length} events.\n`);

  // Index events by venueId for candidate lookup.
  const eventsByVenue = new Map();
  for (const e of events) {
    if (!e.venueId) continue;
    if (!eventsByVenue.has(e.venueId)) eventsByVenue.set(e.venueId, []);
    eventsByVenue.get(e.venueId).push(e);
  }

  const proposed = [];   // { gallery, event, score }
  const ambiguous = [];  // { gallery, top: [{event,score}, ...] }
  const unmatched = [];   // gallery
  const alreadyLinked = []; // gallery (eventId already set)

  for (const g of galleries) {
    if (g.eventId) { alreadyLinked.push(g); continue; }
    const candidates = (g.venueId && eventsByVenue.get(g.venueId)) || [];
    if (candidates.length === 0) { unmatched.push({ g, reason: 'no events at venue' }); continue; }

    const scored = candidates
      .map(e => ({ e, score: scoreMatch(g, e) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0 || scored[0].score < CONFIDENCE_THRESHOLD) {
      unmatched.push({ g, reason: 'no candidate cleared threshold' });
      continue;
    }
    // Tie at the top score → ambiguous, do not guess.
    if (scored.length > 1 && scored[1].score === scored[0].score) {
      ambiguous.push({ g, top: scored.slice(0, 3) });
      continue;
    }
    proposed.push({ g, e: scored[0].e, score: scored[0].score });
  }

  // ── Report ──────────────────────────────────────────────────────────
  console.log(`── PROPOSED MATCHES (${proposed.length}) ──`);
  for (const { g, e, score } of proposed) {
    console.log(`  [${score}] gallery "${g.title}" (${g.id})`);
    console.log(`         venue=${g.venueId} date="${g.date}"`);
    console.log(`      →  event "${e.title || e.name}" (${e.id}) date="${e.date}"`);
  }

  console.log(`\n── AMBIGUOUS — top-score tie, NOT matched (${ambiguous.length}) ──`);
  for (const { g, top } of ambiguous) {
    console.log(`  gallery "${g.title}" (${g.id}) venue=${g.venueId} date="${g.date}"`);
    for (const { e, score } of top) console.log(`      [${score}] candidate "${e.title || e.name}" (${e.id}) date="${e.date}"`);
  }

  console.log(`\n── UNMATCHED (${unmatched.length}) ──`);
  for (const { g, reason } of unmatched) {
    console.log(`  gallery "${g.title}" (${g.id}) venue=${g.venueId || '∅'} date="${g.date}" — ${reason}`);
  }

  console.log(`\n── ALREADY LINKED (${alreadyLinked.length}) ──`);
  for (const g of alreadyLinked) console.log(`  gallery "${g.title}" (${g.id}) → eventId=${g.eventId}`);

  console.log(`\nSummary: ${proposed.length} proposed · ${ambiguous.length} ambiguous · ${unmatched.length} unmatched · ${alreadyLinked.length} already linked`);

  console.log(`\n── COMMIT ALLOWLIST (${COMMIT_ALLOWLIST.length}) — the only pairs the commit pass will write ──`);
  for (const a of COMMIT_ALLOWLIST) console.log(`  ${a.galleryId} → ${a.eventId}`);

  if (!COMMIT) {
    console.log('\nDRY-RUN complete. No writes performed. Review the mapping above.');
    console.log('To write the allowlist: WUGI_BACKFILL_CONFIRM=yes node scripts/backfill-gallery-eventid.js --commit\n');
    process.exit(0);
  }

  if (!CONFIRMED) {
    console.error('\n--commit was passed but WUGI_BACKFILL_CONFIRM=yes is not set. Aborting (no writes).\n');
    process.exit(1);
  }

  // ── Commit pass — ALLOWLIST ONLY, double-gated, only fills null eventId ─
  const galleryById = new Map(galleries.map(g => [g.id, g]));
  const eventById    = new Map(events.map(e => [e.id, e]));
  console.log(`\nWriting allowlisted eventId links…`);
  const batch = db.batch();
  const written = [];
  for (const { galleryId, eventId } of COMMIT_ALLOWLIST) {
    const g = galleryById.get(galleryId);
    const e = eventById.get(eventId);
    if (!g) { console.log(`  SKIP ${galleryId} — gallery doc not found`); continue; }
    if (!e) { console.log(`  SKIP ${galleryId} — target event ${eventId} not found`); continue; }
    if (g.eventId) { console.log(`  SKIP ${galleryId} — already linked to ${g.eventId}`); continue; }
    batch.set(db.collection('galleries').doc(galleryId), { eventId, updatedAt: FV.serverTimestamp() }, { merge: true });
    written.push({ galleryId, eventId });
  }
  if (written.length > 0) await batch.commit();
  console.log(`\n✓ Wrote ${written.length} gallery→eventId link(s):`);
  for (const w of written) console.log(`   ${w.galleryId} → eventId=${w.eventId}`);
  console.log('');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
