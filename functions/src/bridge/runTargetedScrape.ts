// ─────────────────────────────────────────────────────────────────────
// Wugi — runTargetedScrape Cloud Function (on-demand Apify scrape by IG handle)
//
// The venue-intel pipeline normally scrapes a fixed seed list Mondays via
// Apify task lvZ1xWR4pePALeIco -> apifyWebhook -> venueIntel staging. This
// function lets an admin trigger an on-demand DIRECT actor run against any
// single IG handle (venue, event page, influencer) instead, feeding the
// exact same ingestion path: it resolves the actor backing the scheduled
// task (read-only — never touches the task itself), starts a direct run
// with an ad-hoc webhook pointed at the deployed apifyWebhook, and records
// the request in targetedScrapes/{runId} for tracking. apifyWebhook needs
// ZERO changes — the ad-hoc webhook's payload template mirrors the exact
// shape it already expects from the scheduled task's webhook.
//
// AUTH: mirrors the dashboard's established Bearer-token pattern (see
// dashboard/lib/appConfigAuth.ts) — verify the Firebase ID token, then
// require users/{uid}.role === 'super_admin'. No custom claims or
// hardcoded identity exist anywhere in this codebase; this is the one
// established scheme, just re-implemented with firebase-admin directly
// instead of the Next.js API-route wrapper.
//
// SECRETS REQUIRED (Firebase Secret Manager):
//   APIFY_TOKEN — Apify API token (already in use by apifyWebhook).
// ─────────────────────────────────────────────────────────────────────

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

const apifyToken = defineSecret('APIFY_TOKEN');

const APIFY_API = 'https://api.apify.com/v2';

// The scheduled seed-list task this endpoint piggybacks on. Only ever read
// (task lookup + input lookup) — never modified.
export const SCHEDULED_TASK_ID = 'lvZ1xWR4pePALeIco';

// The deployed apifyWebhook function this run's ad-hoc webhook targets.
export const APIFY_WEBHOOK_URL = 'https://us-central1-wugi-prod.cloudfunctions.net/apifyWebhook';

export const DEFAULT_RESULTS_LIMIT = 30;
// Fallback if the scheduled task's stored input has no resultsType — matches
// the Apify Instagram-scraper actor's own default.
const DEFAULT_RESULTS_TYPE = 'posts';

const TARGETED_SCRAPES_COLLECTION = 'targetedScrapes';

// ── Pure: handle + input normalization ──────────────────────────────

// Instagram usernames: letters, digits, periods, underscores, max 30 chars.
const IG_USERNAME_REGEX = /^[A-Za-z0-9._]{1,30}$/;

function extractHandleFromProfileUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) return null;
  const [username] = parsed.pathname.split('/').filter(Boolean);
  return username ?? null;
}

/**
 * Normalizes a raw handle field into a bare IG username: trims, strips a
 * leading @, and extracts the username out of a pasted full profile URL.
 * Returns null for anything that doesn't pass the IG username charset —
 * the caller treats that as a 400.
 */
export function normalizeInstagramHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let candidate: string;
  if (/^https?:\/\//i.test(trimmed)) {
    const fromUrl = extractHandleFromProfileUrl(trimmed);
    if (!fromUrl) return null;
    candidate = fromUrl;
  } else {
    candidate = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  }

  return IG_USERNAME_REGEX.test(candidate) ? candidate : null;
}

export const VALID_TARGET_TYPES = ['venue', 'event', 'influencer', 'other'] as const;
export type TargetType = (typeof VALID_TARGET_TYPES)[number];

/** Unrecognized/missing targetType defaults to 'other' rather than rejecting the request. */
export function normalizeTargetType(raw: unknown): TargetType {
  return typeof raw === 'string' && (VALID_TARGET_TYPES as readonly string[]).includes(raw)
    ? (raw as TargetType)
    : 'other';
}

/** venueId is an opaque passthrough — any non-empty string, else null. */
export function normalizeVenueId(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}

// ── Pure: direct-run request construction ───────────────────────────

export interface BuildRunRequestParams {
  handle: string;
  actorId: string;
  resultsType: string;
  webhookTargetUrl: string;
  resultsLimit?: number;
}

export interface ApifyRunRequest {
  url: string;
  body: { directUrls: string[]; resultsType: string; resultsLimit: number };
}

/**
 * Builds the POST /v2/acts/{actorId}/runs request for a direct, ad-hoc
 * Instagram scrape of one handle — same actor + resultsType as the
 * scheduled task, with an ad-hoc ACTOR.RUN.SUCCEEDED webhook attached via
 * the `webhooks` query param (base64-encoded JSON array, per the Apify
 * API). The payload template mirrors the exact shape apifyWebhook already
 * expects from the scheduled task's own webhook, so ingestion needs zero
 * changes: {"eventType":"ACTOR.RUN.SUCCEEDED","resource":{"id":...,
 * "actId":...,"defaultDatasetId":...}}. Pure/testable — no fetch here.
 */
export function buildTargetedScrapeRunRequest(params: BuildRunRequestParams): ApifyRunRequest {
  const webhookSpec = [
    {
      eventTypes: ['ACTOR.RUN.SUCCEEDED'],
      requestUrl: params.webhookTargetUrl,
      payloadTemplate:
        '{"eventType":"ACTOR.RUN.SUCCEEDED","resource":{"id":"{{resource.id}}","actId":"{{resource.actId}}","defaultDatasetId":"{{resource.defaultDatasetId}}"}}',
    },
  ];
  const webhooksParam = Buffer.from(JSON.stringify(webhookSpec)).toString('base64');

  return {
    url: `${APIFY_API}/acts/${encodeURIComponent(params.actorId)}/runs?webhooks=${encodeURIComponent(webhooksParam)}`,
    body: {
      directUrls: [`https://www.instagram.com/${params.handle}/`],
      resultsType: params.resultsType,
      resultsLimit: params.resultsLimit ?? DEFAULT_RESULTS_LIMIT,
    },
  };
}

// ── Apify API (fetch, no SDK) ────────────────────────────────────────

/** Resolves the actorId backing the scheduled task. Read-only — never touches the task. */
async function fetchScheduledTaskActorId(taskId: string, token: string): Promise<string> {
  const res = await fetch(`${APIFY_API}/actor-tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Apify actor-task lookup failed [${res.status}]`);
  }
  const json = await res.json();
  const actorId = json?.data?.actId;
  if (typeof actorId !== 'string' || !actorId) {
    throw new Error('Apify actor-task response missing actId');
  }
  return actorId;
}

/** Resolves the scheduled task's stored resultsType. Read-only — never touches the task. */
async function fetchScheduledTaskResultsType(taskId: string, token: string): Promise<string> {
  const res = await fetch(`${APIFY_API}/actor-tasks/${encodeURIComponent(taskId)}/input`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Apify actor-task input lookup failed [${res.status}]`);
  }
  const input = await res.json();
  return typeof input?.resultsType === 'string' && input.resultsType ? input.resultsType : DEFAULT_RESULTS_TYPE;
}

async function startApifyRun(runRequest: ApifyRunRequest, token: string): Promise<{ id: string }> {
  const res = await fetch(runRequest.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(runRequest.body),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify run start failed [${res.status}]: ${body}`);
  }
  const json = await res.json();
  const runId = json?.data?.id;
  if (typeof runId !== 'string' || !runId) {
    throw new Error('Apify run start response missing run id');
  }
  return { id: runId };
}

// ── Auth ──────────────────────────────────────────────────────────────

async function verifySuperAdmin(authHeader: string | undefined): Promise<{ uid: string } | null> {
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch {
    return null;
  }

  const userSnap = await admin.firestore().collection('users').doc(decoded.uid).get();
  const role = userSnap.exists ? (userSnap.data()?.role as string | undefined) : undefined;
  if (role !== 'super_admin') return null;

  return { uid: decoded.uid };
}

// ── Main Cloud Function ──────────────────────────────────────────────

export const runTargetedScrape = onRequest(
  {
    secrets: [apifyToken],
    region: 'us-central1',
  },
  async (req, res) => {
    const authResult = await verifySuperAdmin(req.headers.authorization);
    if (!authResult) {
      logger.warn('runTargetedScrape: unauthenticated or non-admin request rejected');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = req.body ?? {};
    const handle = normalizeInstagramHandle(body.handle);
    if (!handle) {
      res.status(400).json({ error: 'Invalid or missing handle' });
      return;
    }
    const targetType = normalizeTargetType(body.targetType);
    const venueId = normalizeVenueId(body.venueId);

    const token = apifyToken.value();

    try {
      const actorId = await fetchScheduledTaskActorId(SCHEDULED_TASK_ID, token);
      logger.info('runTargetedScrape: resolved actor', { actorId, taskId: SCHEDULED_TASK_ID });

      const resultsType = await fetchScheduledTaskResultsType(SCHEDULED_TASK_ID, token);

      const runRequest = buildTargetedScrapeRunRequest({
        handle,
        actorId,
        resultsType,
        webhookTargetUrl: APIFY_WEBHOOK_URL,
      });
      const run = await startApifyRun(runRequest, token);

      await admin
        .firestore()
        .collection(TARGETED_SCRAPES_COLLECTION)
        .doc(run.id)
        .set({
          handle,
          targetType,
          venueId,
          requestedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'started',
          apifyRunId: run.id,
        });

      logger.info('runTargetedScrape: run started', { handle, targetType, runId: run.id });
      res.status(200).json({ runId: run.id });
    } catch (err) {
      logger.error('runTargetedScrape: handler failed', { handle, targetType, err: String(err) });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);
