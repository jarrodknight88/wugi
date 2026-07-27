#!/usr/bin/env node
/**
 * Wugi — repair-deal-venues.js
 *
 * Repairs `deals` docs whose venueId points at a venue that either does not
 * exist (orphaned — legacy venue_* ids predate the current scheme, or a
 * wrong canonical id was used) or resolves but the venue is status='closed'
 * (stale, not orphaned — flagged for deactivation instead of repointed).
 *
 * Resolution order per orphaned deal (first tier with exactly one match
 * wins; a tier with 2+ matches is AMBIGUOUS — reported and skipped, never
 * guessed):
 *   1. exact match      — venue.name === deal.venueName (trimmed)
 *   2. normalized match — norm(venue.name) === norm(deal.venueName)
 *   3. slug similarity  — normalized deal.venueId (legacy `venue_` prefix
 *                         stripped) contained in / contains venue.slug or
 *                         venue.id
 * Only live venues (status not closed/disabled) are considered candidates —
 * repointing an orphan onto another dead venue would just recreate the bug.
 *
 * --dry-run is the DEFAULT (prints the full proposed plan, writes nothing).
 * --execute performs writes and is gated on a human having reviewed the
 * dry-run output first. A full `deals` collection backup is written
 * immediately before the write batch commits.
 *
 * NEVER deletes a deal doc — only repoints venueId/venueName, or (for deals
 * resolved to a closed venue, e.g. gold-room-atl) sets isActive:false so a
 * human can decide whether to retire the deal entirely.
 *
 * Run from repo root:
 *   node scripts/repair-deal-venues.js            (dry run)
 *   node scripts/repair-deal-venues.js --execute
 *
 * Requires: firebase-admin installed (root package.json dependency),
 * service account key at scripts/serviceAccount.json (wugi-prod).
 *
 * OUT OF SCOPE (noted, not fixed here): /users docs carry the same
 * orphaned-reference class — e.g. a venue_admin account with
 * venueIds:['teranga-city'], which also does not exist, so that user sees
 * zero venues. See the tracking issue for the follow-up.
 */
const path  = require('path');
const fs    = require('fs');
const admin = require('firebase-admin');

const EXECUTE = process.argv.includes('--execute');

const SA = path.join(__dirname, 'serviceAccount.json');
if (!fs.existsSync(SA)) { console.error('FATAL: scripts/serviceAccount.json not found'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(SA)), projectId: 'wugi-prod' });
const db  = admin.firestore();
const FV  = admin.firestore.FieldValue;
const NOW = new Date().toISOString().replace(/[:.]/g, '-');

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m', bold: '\x1b[1m' };
const c = (col, s) => `${C[col]}${s}${C.x}`;

const CLOSED_STATUSES = ['closed', 'disabled'];

/** Full `deals` backup — always, before any write. */
async function backupDeals() {
  const dir = path.join(__dirname, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const snap = await db.collection('deals').get();
  const out  = {};
  snap.forEach(d => { out[d.id] = JSON.parse(JSON.stringify(d.data())); });
  const file = path.join(dir, `deals-backup-${NOW}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(c('g', `\n  BACKUP: ${snap.size} docs -> ${path.relative(process.cwd(), file)}\n`));
  return file;
}

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

/** Strip a leading legacy `venue_`/`venue-` prefix before normalizing an id for slug comparison. */
const idCore = id => norm((id || '').replace(/^venue[_-]?/i, ''));

const short = v => {
  if (v === undefined) return c('d', '<unset>');
  if (v === null) return c('d', 'null');
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 92 ? s.slice(0, 89) + '…' : s;
};

/**
 * Resolve the intended live venue for an orphaned deal.
 * Returns one of:
 *   { match, tier, evidence }   — exactly one candidate, safe to propose
 *   { ambiguous: [...], tier }  — 2+ candidates at the first tier that hit
 *   { match: null }             — no candidate at any tier
 */
function resolve(deal, liveVenues) {
  const dealName = (deal.venueName || '').trim();

  // Tier 1 — exact (trimmed) name match.
  let hits = liveVenues.filter(v => (v.data.name || '').trim() === dealName);
  if (hits.length === 1) return { match: hits[0], tier: 'exact name', evidence: `venue.name === deal.venueName ("${dealName}")` };
  if (hits.length > 1) return { ambiguous: hits, tier: 'exact name' };

  // Tier 2 — normalized name match (case/diacritics/punctuation-insensitive).
  const dn = norm(dealName);
  if (dn) {
    hits = liveVenues.filter(v => norm(v.data.name) === dn);
    if (hits.length === 1) return { match: hits[0], tier: 'normalized name', evidence: `norm(venue.name) === norm(deal.venueName) ("${dn}")` };
    if (hits.length > 1) return { ambiguous: hits, tier: 'normalized name' };
  }

  // Tier 3 — slug similarity. Require >=4 chars so a short core ("city",
  // "atl") can't false-positive against an unrelated venue.
  const core = idCore(deal.venueId);
  if (core.length >= 4) {
    hits = liveVenues.filter(v => {
      const slug = norm(v.data.slug || v.id);
      return slug.length >= 4 && (slug.includes(core) || core.includes(slug));
    });
    if (hits.length === 1) {
      const slug = norm(hits[0].data.slug || hits[0].id);
      return { match: hits[0], tier: 'slug similarity', evidence: `"${core}" <-> "${slug}" (id: ${hits[0].id})` };
    }
    if (hits.length > 1) return { ambiguous: hits, tier: 'slug similarity' };
  }

  return { match: null };
}

(async () => {
  console.log(c('bold', `\n${'='.repeat(78)}`));
  console.log(c('bold', `  DEAL VENUE REPAIR — ${EXECUTE ? c('r', 'EXECUTE (WRITES ENABLED)') : c('g', 'DRY RUN (no writes)')}`));
  console.log(c('bold', `${'='.repeat(78)}`));

  const [dealsSnap, venuesSnap] = await Promise.all([
    db.collection('deals').get(),
    db.collection('venues').get(),
  ]);
  const deals  = dealsSnap.docs.map(d => ({ id: d.id, data: d.data() }));
  const venues = venuesSnap.docs.map(d => ({ id: d.id, data: d.data() }));
  const venueById  = new Map(venues.map(v => [v.id, v]));
  const liveVenues = venues.filter(v => !CLOSED_STATUSES.includes(v.data.status));

  console.log(`  deals loaded:  ${deals.length}`);
  console.log(`  venues loaded: ${venues.length} (${liveVenues.length} live)`);

  const plan = { repoint: [], deactivate: [], ambiguous: [], unresolved: [], ok: [] };

  for (const deal of deals) {
    const venue = venueById.get(deal.data.venueId);

    if (venue && !CLOSED_STATUSES.includes(venue.data.status)) {
      plan.ok.push(deal);
      continue;
    }

    console.log(c('bold', `\n${'─'.repeat(78)}`));
    console.log(c('bold', `  ${deal.id}`) + c('d', `  venueId=${deal.data.venueId}  venueName="${deal.data.venueName}"`));

    if (venue) {
      // Resolved, but the venue itself is closed/disabled — a stale deal,
      // not an orphan. Never repoint; flag for a human deactivation call.
      console.log(c('y', `  POINTS AT ${String(venue.data.status).toUpperCase()} VENUE (${venue.id}) — not an orphan, flagging for deactivation`));
      console.log(c('y', `  DEACTIVATE: isActive -> false (do NOT repoint)`));
      plan.deactivate.push({ deal, venue });
      continue;
    }

    console.log(c('r', `  ORPHANED — venueId "${deal.data.venueId}" does not exist`));
    const res = resolve(deal.data, liveVenues);

    if (res.ambiguous) {
      console.log(c('r', `  AMBIGUOUS (${res.tier}) — REPORT ONLY, no write:`));
      res.ambiguous.forEach(v => console.log(`    - ${v.id}  "${v.data.name}"  status=${v.data.status}`));
      plan.ambiguous.push({ deal, tier: res.tier, candidates: res.ambiguous });
      continue;
    }

    if (!res.match) {
      console.log(c('r', `  NO CANDIDATE FOUND — manual review needed`));
      plan.unresolved.push({ deal });
      continue;
    }

    console.log(c('g', `  PROPOSED: ${deal.data.venueId} -> ${res.match.id}  (${res.tier})`));
    console.log(c('d', `    evidence: ${res.evidence}`));
    console.log(`    ${c('y', '~')} venueId    ${c('r', short(deal.data.venueId))}  ${c('g', '-> ' + short(res.match.id))}`);
    console.log(`    ${c('y', '~')} venueName  ${c('r', short(deal.data.venueName))}  ${c('g', '-> ' + short(res.match.data.name))}`);
    plan.repoint.push({ deal, venue: res.match, tier: res.tier, evidence: res.evidence });
  }

  console.log(c('bold', `\n${'='.repeat(78)}`));
  console.log(c('bold', '  SUMMARY'));
  console.log(`    ok (live venue):     ${plan.ok.length}`);
  console.log(`    repoint proposed:    ${plan.repoint.length}`);
  console.log(`    deactivate proposed: ${plan.deactivate.length}`);
  console.log(`    ambiguous (skipped): ${plan.ambiguous.length}${plan.ambiguous.length ? c('r', ' <-- REVIEW') : ''}`);
  console.log(`    unresolved:          ${plan.unresolved.length}${plan.unresolved.length ? c('r', ' <-- REVIEW') : ''}`);

  if (!EXECUTE) {
    console.log(c('g', `\n  DRY RUN — nothing written. Re-run with --execute to apply the ${plan.repoint.length} repoint(s) + ${plan.deactivate.length} deactivation(s) above.\n`));
    process.exit(0);
  }

  console.log(c('r', `\n  EXECUTING WRITES…`));
  const backupFile = await backupDeals();

  const batch = db.batch();
  const stamp = { updatedAt: FV.serverTimestamp() };
  plan.repoint.forEach(({ deal, venue, tier, evidence }) => {
    batch.set(db.collection('deals').doc(deal.id), {
      venueId: venue.id,
      venueName: venue.data.name,
      ...stamp,
      repairNote: `Repointed from "${deal.data.venueId}" (${tier}: ${evidence}). Backup: ${path.basename(backupFile)}`,
      repairedAt: FV.serverTimestamp(),
    }, { merge: true });
  });
  plan.deactivate.forEach(({ deal, venue }) => {
    batch.set(db.collection('deals').doc(deal.id), {
      isActive: false,
      ...stamp,
      repairNote: `Deactivated — venueId "${venue.id}" is status=${venue.data.status}. Backup: ${path.basename(backupFile)}`,
      repairedAt: FV.serverTimestamp(),
    }, { merge: true });
  });

  await batch.commit();
  console.log(c('g', `  DONE — ${plan.repoint.length} repointed, ${plan.deactivate.length} deactivated.`));
  console.log(c('d', `  Backup: ${backupFile}\n`));
  process.exit(0);
})().catch(err => {
  console.error(c('r', `\nFATAL: ${err.stack || err}\n`));
  process.exit(1);
});
