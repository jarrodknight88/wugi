// ─────────────────────────────────────────────────────────────────────
// Wugi — apifyWebhook Cloud Function (Apify → Firestore venueIntel ingest)
//
// Receives the webhook Apify fires when a scheduled Instagram scraper run
// finishes (ACTOR.RUN.SUCCEEDED). Verifies the run genuinely belongs to us,
// pulls the dataset, normalizes each item into a venueIntel doc, and stages
// it in Firestore for human review. This function NEVER writes to the
// production venues/ collection — venueIntel is a staging area only.
//
// Webhook validation: there is no shared webhook secret. Instead, we look
// the run up via the Apify API using our own token — if the run doesn't
// exist under our account, the payload is rejected outright.
//
// SECRETS REQUIRED (Firebase Secret Manager):
//   APIFY_TOKEN — Apify API token, used both to verify the run and to
//                 fetch the dataset it produced.
// ─────────────────────────────────────────────────────────────────────

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import {
  selectCandidateMediaUrls,
  downloadAndStoreIntelMedia,
  downloadAndStoreIntelVideo,
  buildMediaAssetDoc,
  MediaAsset,
} from '../intel/intelMedia';

const apifyToken = defineSecret('APIFY_TOKEN');

const APIFY_API = 'https://api.apify.com/v2';
const VENUE_INTEL_COLLECTION = 'venueIntel';
const DATASET_PAGE_SIZE = 1000;
// Stay under Firestore's 500-write batch limit while leaving headroom for
// the paired getAll() read of the same refs.
const WRITE_BATCH_SIZE = 400;

// ── Normalization ────────────────────────────────────────────────────

export interface VenueIntelDoc {
  sourceAccount: string;
  seedAccount: string;
  postUrl: string;
  caption: string;
  postedAt: admin.firestore.Timestamp | null;
  likesCount: number;
  commentsCount: number;
  mediaUrls: string[];
  // Top-level item.videoUrl only (scope item 1: "the Apify item carries a
  // video (videoUrl / type video)") — a per-slide video nested in a
  // childPosts carousel entry is not captured in v1. mediaUrls already
  // carries the post's cover-frame image regardless of this field, so a
  // video post never loses its poster even when videoUrl download fails.
  videoUrl: string | null;
  runId: string;
}

export interface MappedVenueIntelItem {
  docId: string;
  doc: VenueIntelDoc;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return null;
}

function toNonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

/**
 * Instagram collab posts are owned by the co-author, so scraping one seed
 * profile can surface items whose ownerUsername is a different account.
 * seedAccount records which profile the scraper was actually pointed at
 * (item.inputUrl), independent of sourceAccount (the post's owner).
 */
function parseSeedAccountFromInputUrl(inputUrl: unknown): string {
  if (typeof inputUrl !== 'string') return '';
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    return '';
  }
  const [username] = parsed.pathname.split('/').filter(Boolean);
  return username ?? '';
}

function extractMediaUrls(item: any): string[] {
  if (Array.isArray(item?.images) && item.images.length > 0) {
    return item.images.filter((u: unknown) => typeof u === 'string');
  }
  if (Array.isArray(item?.childPosts) && item.childPosts.length > 0) {
    const urls = item.childPosts
      .map((c: any) => c?.displayUrl)
      .filter((u: unknown) => typeof u === 'string');
    if (urls.length > 0) return urls;
  }
  return [item?.displayUrl, item?.videoUrl].filter((u: unknown) => typeof u === 'string');
}

/**
 * Pure item→doc mapper for one Apify Instagram-scraper dataset item.
 * Returns null when the item has no post URL — the field we hash for the
 * dedupe docId, and without which the item can't be normalized at all.
 * Does not decide the `status` field: that depends on whether the doc
 * already exists in Firestore, which is I/O the caller owns (see
 * writeVenueIntelDocs) so re-scrapes never clobber a reviewed status.
 */
export function mapApifyItemToVenueIntelDoc(item: any, runId: string): MappedVenueIntelItem | null {
  const postUrl = firstNonEmptyString(item?.url, item?.postUrl, item?.inputUrl);
  if (!postUrl) return null;

  const docId = crypto.createHash('sha256').update(postUrl).digest('hex').slice(0, 32);

  const postedAtDate = item?.timestamp ? new Date(item.timestamp) : null;
  const postedAt =
    postedAtDate && !Number.isNaN(postedAtDate.getTime())
      ? admin.firestore.Timestamp.fromDate(postedAtDate)
      : null;

  return {
    docId,
    doc: {
      sourceAccount: firstNonEmptyString(item?.ownerUsername, item?.username) ?? '',
      seedAccount: parseSeedAccountFromInputUrl(item?.inputUrl),
      postUrl,
      caption: item?.caption ?? '',
      postedAt,
      likesCount: toNonNegativeInt(item?.likesCount),
      commentsCount: toNonNegativeInt(item?.commentsCount),
      mediaUrls: extractMediaUrls(item),
      videoUrl: firstNonEmptyString(item?.videoUrl),
      runId,
    },
  };
}

// ── Apify API (fetch, no SDK) ────────────────────────────────────────

/** Looks the run up under our own account. Throws on any non-2xx or network failure. */
async function fetchApifyRun(runId: string, token: string): Promise<{ id: string } | null> {
  const res = await fetch(`${APIFY_API}/actor-runs/${encodeURIComponent(runId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Apify actor-runs lookup failed [${res.status}]`);
  }
  const json = await res.json();
  return json?.data ?? null;
}

async function fetchDatasetItems(datasetId: string, token: string): Promise<any[]> {
  const items: any[] = [];
  let offset = 0;
  for (;;) {
    const url = `${APIFY_API}/datasets/${encodeURIComponent(datasetId)}/items?format=json&limit=${DATASET_PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Apify dataset items fetch failed [${res.status}]`);
    }
    const page = (await res.json()) as any[];
    items.push(...page);
    if (page.length < DATASET_PAGE_SIZE) break;
    offset += DATASET_PAGE_SIZE;
  }
  return items;
}

// ── Firestore writes ─────────────────────────────────────────────────

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Writes each mapped item with set(..., { merge: true }) so re-scrapes
 * update engagement counts without duplicating docs. `status` is only
 * included in the write payload for docs that don't exist yet — merge
 * semantics mean an omitted field is left untouched, so an existing
 * reviewed status is never clobbered by a later re-scrape. Also returns
 * the subset of items that were genuinely new in this run — media
 * download only ever runs for those (never on a re-merge of an existing
 * docId), per scope item 1.
 */
async function writeVenueIntelDocs(
  mapped: MappedVenueIntelItem[]
): Promise<{ ingested: number; errors: number; newItems: MappedVenueIntelItem[] }> {
  const db = admin.firestore();
  const collection = db.collection(VENUE_INTEL_COLLECTION);
  let ingested = 0;
  let errors = 0;
  const newItems: MappedVenueIntelItem[] = [];

  for (const batchItems of chunk(mapped, WRITE_BATCH_SIZE)) {
    const refs = batchItems.map((m) => collection.doc(m.docId));
    try {
      const snaps = await db.getAll(...refs);
      const existingIds = new Set(snaps.filter((s) => s.exists).map((s) => s.id));

      const batch = db.batch();
      batchItems.forEach((m, i) => {
        const isNew = !existingIds.has(m.docId);
        if (isNew) newItems.push(m);
        batch.set(
          refs[i],
          {
            ...m.doc,
            scrapedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...(isNew ? { status: 'pending_review' } : {}),
          },
          { merge: true }
        );
      });
      await batch.commit();
      ingested += batchItems.length;
    } catch (err) {
      errors += batchItems.length;
      logger.error('apifyWebhook: batch write failed', { err: String(err), size: batchItems.length });
    }
  }

  return { ingested, errors, newItems };
}

/**
 * Media persistence for newly-ingested posts (scope item 1-2): downloads
 * each post's first few image mediaUrls, plus its video if the item carries
 * one, to Storage and writes the mediaAssets/{docId} tracking doc (typed
 * `assets`, see intelMedia.ts). Runs after the venueIntel batch write
 * commits, entirely best-effort — every failure (a single post's media, or
 * the whole pass) is caught and logged here so it can never affect the
 * webhook's response to Apify. The poster/image path is unaffected by
 * whether the video download succeeds — a skipped/oversized video still
 * leaves the poster stored, per scope item 1.
 */
async function persistNewIntelMedia(newItems: MappedVenueIntelItem[]): Promise<void> {
  if (newItems.length === 0) return;

  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  for (const item of newItems) {
    const candidateUrls = selectCandidateMediaUrls(item.doc.mediaUrls);
    if (candidateUrls.length === 0 && !item.doc.videoUrl) continue;

    try {
      const { storagePaths } =
        candidateUrls.length > 0
          ? await downloadAndStoreIntelMedia(bucket, item.docId, candidateUrls)
          : { storagePaths: [] as string[] };

      let videoAsset: MediaAsset | null = null;
      if (item.doc.videoUrl) {
        const videoResult = await downloadAndStoreIntelVideo(bucket, item.docId, item.doc.videoUrl, 0);
        if (videoResult.path) {
          videoAsset = { path: videoResult.path, type: 'video', posterPath: storagePaths[0] };
        }
      }

      if (storagePaths.length === 0 && !videoAsset) continue;

      const assets: MediaAsset[] = [
        ...storagePaths.map((path): MediaAsset => ({ path, type: 'image' })),
        ...(videoAsset ? [videoAsset] : []),
      ];

      await db
        .collection('mediaAssets')
        .doc(item.docId)
        .set(
          buildMediaAssetDoc(
            {
              venueIntelId: item.docId,
              sourceAccount: item.doc.sourceAccount,
              seedAccount: item.doc.seedAccount,
              postUrl: item.doc.postUrl,
              storagePaths,
              assets,
            },
            admin.firestore.FieldValue.serverTimestamp()
          )
        );
    } catch (err) {
      logger.warn('apifyWebhook: media persistence failed for post', { docId: item.docId, err: String(err) });
    }
  }
}

// ── Main Cloud Function ──────────────────────────────────────────────

export const apifyWebhook = onRequest(
  {
    secrets: [apifyToken],
    region: 'us-central1',
    // Dataset pagination + batched Firestore writes, plus (since media
    // persistence landed) downloading/uploading up to 3 images and one video
    // (up to MAX_VIDEO_BYTES, ~60MB) per new post, can take a while for a
    // large scrape run. Memory bumped from 512MiB alongside the video path —
    // media is downloaded sequentially (one buffer in flight at a time), but
    // a 60MB video buffer plus the full dataset items array needs headroom.
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (req, res) => {
    const payload = req.body ?? {};
    const eventType = payload.eventType;
    const resource = payload.resource ?? {};
    const runId = resource.id;
    const defaultDatasetId = resource.defaultDatasetId;

    if (eventType !== 'ACTOR.RUN.SUCCEEDED' || !runId || !defaultDatasetId) {
      logger.warn('apifyWebhook: malformed payload', { eventType, runId, defaultDatasetId });
      res.status(400).send('Bad Request');
      return;
    }

    const token = apifyToken.value();

    // AUTH: verify the run is genuinely ours before touching Firestore.
    let run: { id: string } | null;
    try {
      run = await fetchApifyRun(runId, token);
    } catch (err) {
      logger.warn('apifyWebhook: run verification failed', { runId, err: String(err) });
      res.status(401).send('Unauthorized');
      return;
    }
    if (!run || run.id !== runId) {
      logger.warn('apifyWebhook: run not found under our account', { runId });
      res.status(401).send('Unauthorized');
      return;
    }

    try {
      const items = await fetchDatasetItems(defaultDatasetId, token);

      const mapped: MappedVenueIntelItem[] = [];
      let unmappable = 0;
      for (const item of items) {
        const m = mapApifyItemToVenueIntelDoc(item, runId);
        if (m) mapped.push(m);
        else unmappable++;
      }

      const { ingested, errors, newItems } = await writeVenueIntelDocs(mapped);
      const skipped = unmappable + errors;

      logger.info('apifyWebhook: run summary', {
        runId,
        itemCount: items.length,
        ingested,
        errors,
        newItems: newItems.length,
      });

      // Best-effort, isolated from the response: media staging failures
      // must never turn a successful ingest into a 5xx for Apify.
      await persistNewIntelMedia(newItems).catch((err) =>
        logger.error('apifyWebhook: media persistence pass failed', { runId, err: String(err) })
      );

      res.status(200).json({ ingested, skipped });
    } catch (err) {
      logger.error('apifyWebhook: handler failed', { runId, err: String(err) });
      res.status(500).send('Internal Server Error');
    }
  }
);
