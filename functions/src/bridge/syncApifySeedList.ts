// ─────────────────────────────────────────────────────────────────────
// Wugi — syncApifySeedList Cloud Function (auto-grow the Apify seed list)
//
// The venue-intel pipeline scrapes a fixed seed list of Instagram accounts
// Mondays via Apify task lvZ1xWR4pePALeIco -> apifyWebhook -> venueIntel
// staging (see runTargetedScrape.ts for the on-demand counterpart). Until
// now that seed list only grew by someone manually editing Apify's task
// config. This function closes the loop: every account a human approves in
// the dashboard's venue-intel review flow (venueIntelAccounts/{handle}.
// status == 'approved' — see dashboard/app/api/venue-intel-accounts/
// route.ts) is automatically unioned into the task's directUrls, so a
// promising account surfaced by the scrape itself gets scraped going
// forward without a manual Apify edit.
//
// Runs daily (idempotent — recomputes base ∪ approved from scratch every
// time) at 09:30 UTC, 30 minutes ahead of the Monday scrape. Approved by
// Jarrod 2026-07-30: NO cap on growth — quality of the approval gate (a
// human still has to approve each account) is what keeps this sane, not a
// count limit.
//
// config/apifySeed.baseHandles bootstraps itself from Apify's OWN live
// task input on its very first run (not a hardcoded list — see
// INITIAL_BASE_HANDLES for why that would be risky), so this function can
// never silently shrink the real scrape on day one. After that first run,
// the Firestore doc is the base of record going forward.
//
// SCOPE: functions/ only. Does not modify runTargetedScrape.ts, which reads
// the same task id but only to resolve its actorId/resultsType — this file
// is the only one that ever writes the task's input.
//
// SECRETS REQUIRED (Firebase Secret Manager):
//   APIFY_TOKEN — Apify API token (same secret apifyWebhook/
//                 runTargetedScrape already use).
// ─────────────────────────────────────────────────────────────────────

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

const apifyToken = defineSecret('APIFY_TOKEN');

const APIFY_API = 'https://api.apify.com/v2';

// The scheduled seed-list task this function maintains. Mirrors
// runTargetedScrape's SCHEDULED_TASK_ID — same task, different concern
// (that file only ever reads it; this one is the sole writer of its input).
export const SEED_TASK_ID = 'lvZ1xWR4pePALeIco';

const CONFIG_COLLECTION = 'config';
const APIFY_SEED_CONFIG_DOC = 'apifySeed';
const VENUE_INTEL_ACCOUNTS_COLLECTION = 'venueIntelAccounts';

// Last-resort fallback only — see fetchOrSeedBaseHandles. dashboard's
// SEED_ACCOUNTS (app/api/venue-intel-accounts/route.ts) lists these same 15
// as a "v1 hardcode," but docs/VENUE-INTEL-SOP.md (2026-08-01, more
// recently maintained) describes the *live* Apify task as scraping 19
// accounts — so this constant is very likely stale by ~4 handles. Trusting
// it as the real base list on first run would silently drop those 4 real
// accounts the first time this function PUTs directUrls. Apify's own task
// input is the actual source of truth and is used instead whenever
// reachable; this list only fires if that live read comes back empty.
export const INITIAL_BASE_HANDLES = [
  'officialopiumatlanta',
  'revelatlanta',
  'tabuatlanta',
  'teranga.atl',
  'babaskitchenatl',
  'midtownsocialatl',
  'districtatlanta',
  'domaineatl',
  'rocksteadyatlanta',
  'bambooatlanta',
  'vibesatl',
  'atlpics',
  'chuckyfoto',
  'embrloungeatlanta',
  'lokeeatl',
];

// ── Pure: seed-list merge ────────────────────────────────────────────

export interface SeedMergeResult {
  merged: string[];
  added: string[];
}

/**
 * Unions the base (manually-curated) handle list with newly-approved
 * handles. Trims and drops empties, dedupes exact-match (handles are
 * treated case-sensitively everywhere else in this codebase — e.g.
 * onVenueIntelApproved's venueIntelAccounts lookup — so this stays
 * consistent rather than introducing its own casing rule), and preserves
 * base-list order first so the diff a human sees is just "added" appended
 * at the end. Pure/testable — no I/O.
 */
export function mergeSeedHandles(baseHandles: string[], approvedHandles: string[]): SeedMergeResult {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const raw of baseHandles) {
    const h = raw.trim();
    if (!h || seen.has(h)) continue;
    seen.add(h);
    merged.push(h);
  }

  const added: string[] = [];
  for (const raw of approvedHandles) {
    const h = raw.trim();
    if (!h || seen.has(h)) continue;
    seen.add(h);
    merged.push(h);
    added.push(h);
  }

  return { merged, added };
}

/** Builds the Instagram profile URLs Apify's directUrls input expects, same format as runTargetedScrape.ts. */
export function handlesToDirectUrls(handles: string[]): string[] {
  return handles.map((h) => `https://www.instagram.com/${h}/`);
}

/** Inverse of handlesToDirectUrls — extracts the bare username back out of a profile URL. */
export function directUrlToHandle(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) return null;
  const [username] = parsed.pathname.split('/').filter(Boolean);
  return username ?? null;
}

// ── Firestore reads ──────────────────────────────────────────────────

/**
 * Reads config/apifySeed.baseHandles, self-seeding the doc the first time
 * this ever runs (no doc, or a doc missing/malformed baseHandles) from
 * Apify's OWN currently-configured directUrls — the real source of truth —
 * rather than the hardcoded INITIAL_BASE_HANDLES fallback. Every run after
 * that reads back exactly what's stored in Firestore.
 */
async function fetchOrSeedBaseHandles(
  db: admin.firestore.Firestore,
  currentTaskInput: Record<string, unknown>
): Promise<string[]> {
  const ref = db.collection(CONFIG_COLLECTION).doc(APIFY_SEED_CONFIG_DOC);
  const snap = await ref.get();
  const stored = snap.data()?.baseHandles;
  if (Array.isArray(stored) && stored.every((h) => typeof h === 'string')) {
    return stored;
  }

  const liveDirectUrls = Array.isArray(currentTaskInput.directUrls)
    ? currentTaskInput.directUrls.filter((u): u is string => typeof u === 'string')
    : [];
  const liveHandles = liveDirectUrls
    .map(directUrlToHandle)
    .filter((h): h is string => h !== null);

  let baseHandles = liveHandles;
  if (baseHandles.length === 0) {
    logger.warn(
      'syncApifySeedList: bootstrap found no readable directUrls on the live Apify task, falling back to hardcoded INITIAL_BASE_HANDLES (may be stale)',
      { fallbackCount: INITIAL_BASE_HANDLES.length }
    );
    baseHandles = INITIAL_BASE_HANDLES;
  }

  await ref.set({ baseHandles }, { merge: true });
  return baseHandles;
}

/** venueIntelAccounts doc id IS the handle (see onVenueIntelApproved.ts). */
async function fetchApprovedHandles(db: admin.firestore.Firestore): Promise<string[]> {
  const snap = await db.collection(VENUE_INTEL_ACCOUNTS_COLLECTION).where('status', '==', 'approved').get();
  return snap.docs.map((d) => d.id);
}

// ── Apify API (fetch, no SDK — same as runTargetedScrape.ts/apifyWebhook.ts) ──

async function fetchTaskInput(taskId: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${APIFY_API}/actor-tasks/${encodeURIComponent(taskId)}/input`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Apify actor-task input lookup failed [${res.status}]`);
  }
  return res.json();
}

/**
 * Replaces only directUrls on the task's stored input, spreading the
 * existing input first so every other field — resultsType, resultsLimit,
 * anything else configured in Apify — passes through unchanged, per scope.
 */
async function putTaskDirectUrls(
  taskId: string,
  token: string,
  currentInput: Record<string, unknown>,
  directUrls: string[]
): Promise<void> {
  const res = await fetch(`${APIFY_API}/actor-tasks/${encodeURIComponent(taskId)}/input`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...currentInput, directUrls }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify task input update failed [${res.status}]: ${body}`);
  }
}

// ── Main Cloud Function ──────────────────────────────────────────────

export const syncApifySeedList = onSchedule(
  {
    schedule: '30 9 * * *',
    timeZone: 'UTC',
    secrets: [apifyToken],
    region: 'us-central1',
  },
  async () => {
    const db = admin.firestore();
    const token = apifyToken.value();

    try {
      const currentInput = await fetchTaskInput(SEED_TASK_ID, token);

      const [baseHandles, approvedHandles] = await Promise.all([
        fetchOrSeedBaseHandles(db, currentInput),
        fetchApprovedHandles(db),
      ]);

      const { merged, added } = mergeSeedHandles(baseHandles, approvedHandles);

      await putTaskDirectUrls(SEED_TASK_ID, token, currentInput, handlesToDirectUrls(merged));

      logger.info('syncApifySeedList: seed sync complete', {
        beforeCount: baseHandles.length,
        afterCount: merged.length,
        approvedCount: approvedHandles.length,
        added,
      });
    } catch (err) {
      logger.error('syncApifySeedList: sync failed', { err: String(err) });
      throw err;
    }
  }
);
