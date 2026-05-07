#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────
 * Wugi — backfill missing query-critical fields on events + venues
 *
 * Why: feed queries use orderBy() and where() clauses on fields that
 *      Firestore treats specially when missing — orderBy excludes the
 *      doc entirely, where('==', X) excludes anything without the field.
 *      Any legacy/seeded doc lacking these fields silently disappears
 *      from Home/Discover/ForYou/etc.
 *
 * What it does:
 *   WRITES (idempotent — never overwrites an existing value):
 *     - events.isFeatured     → false  (where missing)
 *     - events.isSeriesAnchor → true   (where missing — single occurrence
 *                                       is its own anchor; run
 *                                       backfill-series-ids.js as a
 *                                       follow-up to refine for real
 *                                       multi-occurrence series)
 *     - venues.isFeatured     → false  (where missing)
 *
 *   AUDIT-ONLY (counts, no writes):
 *     - events.createdAt missing
 *     - events.vibes     missing
 *     - venues.createdAt missing
 *     - venues.vibes     missing
 *
 * Targets wugi-prod via scripts/serviceAccount.json. Safe to re-run.
 * ───────────────────────────────────────────────────────────────────── */
'use strict';

const path = require('path');
const admin = require('firebase-admin');
const sa = require(path.resolve(__dirname, 'serviceAccount.json'));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'wugi-prod' });
const db = admin.firestore();

const PAGE_SIZE  = 1000;   // read pagination
const BATCH_SIZE = 500;    // Firestore writeBatch hard cap

// `--dry-run` (or DRY_RUN=1) skips all writes; counts and reports only.
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
// `--list` captures + prints doc IDs + key fields for each audit-missing doc,
// for manual triage. Implies dry-run-style read (no writes triggered by listing).
const LIST_MODE = process.argv.includes('--list');

// Fields to surface in --list output, regardless of which audit field is missing.
// Picked so the operator can synthesize createdAt from existing timestamps if needed.
const LIST_FIELDS = ['title', 'name', 'venueId', 'status', 'dateISO', 'scrapedAt', 'updatedAt'];

function pct(part, whole) {
  if (!whole) return '0.0%';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

// Render Firestore Timestamps / Date / unknowns as readable strings.
function fmtVal(v) {
  if (v === undefined) return '<missing>';
  if (v === null)      return 'null';
  if (typeof v?.toDate === 'function') {
    try { return v.toDate().toISOString(); } catch { /* fall through */ }
  }
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

// ── Per-collection scan + targeted backfill ──────────────────────────
//
// `writes` is { fieldName: defaultValue, ... } — each is written only
// to docs where the field is genuinely missing (hasOwnProperty check).
// `audit` is [fieldName, ...] — counted only.
async function processCollection(name, writes, audit) {
  console.log(`\n── ${name} ──────────────────────────────────────────────`);

  let scanned = 0;
  // Per-write-field: list of refs where the field is missing.
  const writeQueue = {};
  for (const f of Object.keys(writes)) writeQueue[f] = [];
  // Per-audit-field: count only (+ per-doc detail when LIST_MODE is on).
  const auditCounts = {};
  const auditMissingDocs = {};   // { fieldName: [{ id, ...LIST_FIELDS }] }
  for (const f of audit) {
    auditCounts[f] = 0;
    auditMissingDocs[f] = [];
  }

  let cursor = null;
  // Paginate by document id (__name__) — no orderBy on the target fields,
  // because docs missing those would be excluded from such a query.
  while (true) {
    let q = db.collection(name).orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      const data = doc.data();
      for (const f of Object.keys(writes)) {
        if (!Object.prototype.hasOwnProperty.call(data, f)) {
          writeQueue[f].push(doc.ref);
        }
      }
      for (const f of audit) {
        if (!Object.prototype.hasOwnProperty.call(data, f)) {
          auditCounts[f] += 1;
          if (LIST_MODE) {
            const detail = { id: doc.id };
            for (const lf of LIST_FIELDS) detail[lf] = data[lf];
            auditMissingDocs[f].push(detail);
          }
        }
      }
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE_SIZE) break;
  }

  console.log(`  scanned: ${scanned}`);

  // Write per field, one batch sequence per field. Keeps each field's
  // operation isolated for clearer logging and cleaner failure modes.
  const updated = {};
  for (const f of Object.keys(writes)) {
    const refs = writeQueue[f];
    updated[f] = 0;
    console.log(`  missing ${f}: ${refs.length} (${pct(refs.length, scanned)} of scanned)`);
    if (DRY_RUN) {
      console.log(`    [dry-run] would write ${refs.length} ${f} updates — skipping`);
      continue;
    }
    for (let i = 0; i < refs.length; i += BATCH_SIZE) {
      const slice = refs.slice(i, i + BATCH_SIZE);
      const batch = db.batch();
      for (const ref of slice) batch.update(ref, { [f]: writes[f] });
      await batch.commit();
      updated[f] += slice.length;
      process.stdout.write(`    committed batch ${Math.floor(i / BATCH_SIZE) + 1} (${slice.length} docs, total ${updated[f]}/${refs.length}) — ${f}\n`);
    }
  }

  for (const f of audit) {
    console.log(`  [audit] missing ${f}: ${auditCounts[f]} (${pct(auditCounts[f], scanned)} of scanned) — read-only, no write`);
  }

  return { scanned, updated, audit: auditCounts, writeQueue, auditMissingDocs };
}

function printTriageList(collectionName, auditMissingDocs) {
  for (const f of Object.keys(auditMissingDocs)) {
    const docs = auditMissingDocs[f];
    if (!docs || docs.length === 0) continue;
    console.log(`\n── Triage list — ${collectionName} missing ${f} (${docs.length}) ──`);
    for (const d of docs) {
      console.log(`  ${d.id}`);
      for (const lf of LIST_FIELDS) {
        console.log(`    ${lf.padEnd(10)}: ${fmtVal(d[lf])}`);
      }
    }
  }
}

(async function main() {
  const startedAt = Date.now();
  console.log(`Missing-fields backfill — wugi-prod — ${new Date().toISOString()}`);
  if (DRY_RUN)   console.log(`** DRY RUN — no writes will be committed **`);
  if (LIST_MODE) console.log(`** LIST MODE — per-doc triage detail will be printed **`);

  const events = await processCollection(
    'events',
    { isFeatured: false, isSeriesAnchor: true },
    ['createdAt', 'vibes'],
  );
  const venues = await processCollection(
    'venues',
    { isFeatured: false },
    ['createdAt', 'vibes'],
  );

  // In dry-run, "updated" is 0 by construction. Show would-write counts
  // (queue length) instead so the summary remains informative.
  const evWouldWrite = (f) => events.writeQueue[f].length;
  const vnWouldWrite = (f) => venues.writeQueue[f].length;
  const evShown = (f) => DRY_RUN ? `would-write ${evWouldWrite(f)}` : `updated ${events.updated[f]}`;
  const vnShown = (f) => DRY_RUN ? `would-write ${vnWouldWrite(f)}` : `updated ${venues.updated[f]}`;

  console.log(`\n── Summary ──────────────────────────────────────────────`);
  if (DRY_RUN) console.log(`(dry-run — counts only, no writes committed)`);
  console.log(`events:`);
  console.log(`  scanned:                ${events.scanned}`);
  console.log(`  isFeatured     ${evShown('isFeatured')}     (${pct(evWouldWrite('isFeatured'), events.scanned)} of scanned)`);
  console.log(`  isSeriesAnchor ${evShown('isSeriesAnchor')} (${pct(evWouldWrite('isSeriesAnchor'), events.scanned)} of scanned)`);
  console.log(`  [audit] createdAt missing: ${events.audit.createdAt} (${pct(events.audit.createdAt, events.scanned)} of scanned)`);
  console.log(`  [audit] vibes     missing: ${events.audit.vibes} (${pct(events.audit.vibes, events.scanned)} of scanned)`);
  console.log(`venues:`);
  console.log(`  scanned:                ${venues.scanned}`);
  console.log(`  isFeatured     ${vnShown('isFeatured')}     (${pct(vnWouldWrite('isFeatured'), venues.scanned)} of scanned)`);
  console.log(`  [audit] createdAt missing: ${venues.audit.createdAt} (${pct(venues.audit.createdAt, venues.scanned)} of scanned)`);
  console.log(`  [audit] vibes     missing: ${venues.audit.vibes} (${pct(venues.audit.vibes, venues.scanned)} of scanned)`);
  console.log(`elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  if (LIST_MODE) {
    printTriageList('events', events.auditMissingDocs);
    printTriageList('venues', venues.auditMissingDocs);
  }

  if (!DRY_RUN) {
    console.log(`\nFollow-up: run backfill-series-ids.js to refine isSeriesAnchor for real multi-occurrence series.`);
  }

  process.exit(0);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
