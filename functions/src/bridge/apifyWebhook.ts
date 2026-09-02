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
import { ImageAnnotatorClient } from '@google-cloud/vision';
import {
  selectCandidateMediaUrls,
  selectCandidateSlideVideos,
  downloadAndStoreIntelMedia,
  downloadAndStoreIntelVideo,
  buildMediaAssetDoc,
  MediaAsset,
} from '../intel/intelMedia';
import { moderateImagesForPost, ModerationResult } from '../intel/mediaModeration';

const apifyToken = defineSecret('APIFY_TOKEN');

// Lazy singleton — reused across warm invocations of this function, same
// rationale as any other cold-start-expensive client in a Cloud Function.
let visionClient: ImageAnnotatorClient | null = null;
function getVisionClient(): ImageAnnotatorClient {
  if (!visionClient) visionClient = new ImageAnnotatorClient();
  return visionClient;
}

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
  // video (videoUrl / type video)") for a non-carousel post. mediaUrls
  // already carries the post's cover-frame image regardless of this field,
  // so a video post never loses its poster even when videoUrl download
  // fails. Per-slide carousel videos (issue #240) are a different case —
  // see MappedVenueIntelItem.childVideoUrls below; they're deliberately not
  // stored on this field or persisted to Firestore, since by the time a
  // human reviews the venueIntel doc the mediaAssets/{docId} doc (built
  // from childVideoUrls during ingest) already holds the downloaded video,
  // and the raw IG CDN URL would just be another expiring link.
  videoUrl: string | null;
  runId: string;
  // Structured tag/mention data straight from the Apify item — issue #236
  // (venue-intel: match venues via caption @mentions + tagged users).
  // Additive only: union of item.taggedUsers[].username (people/accounts IG
  // -tagged on the post) and item.mentions (usernames the actor already
  // parsed out of the caption), raw/un-normalized, deduped. Consumed by
  // eventTransformRouting.ts's resolveVenue as the structured half of its
  // mention-match fallback — caption text is re-scanned separately there via
  // extractMentionsFromCaption, so this never needs to duplicate that work.
  mentionedHandles: string[];
  // Set only by the gallery-site ingest path (apifyGalleryWebhook.ts, issue
  // #267) — undefined/absent for every Instagram-scrape doc, so existing
  // venueIntel docs and current dashboard rendering are unaffected. Lets a
  // reviewer (and any future source-specific handling) tell an
  // atlpics.net/nightlifelink.com gallery recap apart from an IG post
  // without sniffing sourceAccount.
  source?: 'atlpics' | 'nightlifelink';
}

export interface MappedVenueIntelItem {
  docId: string;
  doc: VenueIntelDoc;
  // Per-slide video URLs (issue #240), index-aligned to doc.mediaUrls —
  // null for a slide with no video of its own. Empty when the item isn't a
  // childPosts carousel at all (images-array or single-media items never
  // set this). Deliberately kept off VenueIntelDoc: it's only needed for
  // the in-memory media persistence pass that runs right after this same
  // webhook invocation writes the venueIntel doc (see persistNewIntelMedia
  // below), not for the doc itself.
  childVideoUrls: (string | null)[];
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

/**
 * Structured tag/mention data from one Apify Instagram-scraper item (issue
 * #236). taggedUsers is the actor's IG-tag data — an array of objects, each
 * carrying a `username` — while mentions is a flat array of caption
 * @-mention strings the actor already extracts itself. Both are optional
 * (older items / non-Instagram sources may lack either); union + dedupe by
 * exact string, leaving handle normalization to the matcher
 * (matchVenueByMentions) rather than duplicating it here.
 */
function extractStructuredMentions(item: any): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v === 'string' && v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };
  if (Array.isArray(item?.taggedUsers)) {
    for (const t of item.taggedUsers) push(typeof t === 'string' ? t : t?.username);
  }
  if (Array.isArray(item?.mentions)) {
    for (const m of item.mentions) push(m);
  }
  return out;
}

interface ExtractedMedia {
  mediaUrls: string[];
  // Index-aligned to mediaUrls (see MappedVenueIntelItem.childVideoUrls);
  // only ever populated by the childPosts branch below.
  childVideoUrls: (string | null)[];
}

/**
 * item.images (a pre-flattened list some scrapes carry) takes priority when
 * present — unchanged from pre-#240 behavior. childPosts is Apify's raw
 * Instagram-scraper carousel shape: each entry carries its own displayUrl
 * (the slide's cover/poster) and, for a video slide, its own videoUrl (issue
 * #240 scope item 2) and optionally a `type` ('Video'/'Image'/'Sidecar') —
 * `type` is read for parity with the top-level item.videoUrl/item.type pair
 * but isn't required to gate extraction, same as the top-level case never
 * checks item.type either; a present videoUrl is the sole, sufficient
 * signal. mediaUrls and childVideoUrls are built together in one pass so a
 * childPosts entry missing displayUrl is skipped from BOTH arrays at once —
 * two separate .map()/.filter() passes could silently drift out of index
 * alignment whenever an entry got filtered.
 */
function extractMedia(item: any): ExtractedMedia {
  if (Array.isArray(item?.images) && item.images.length > 0) {
    return { mediaUrls: item.images.filter((u: unknown) => typeof u === 'string'), childVideoUrls: [] };
  }
  if (Array.isArray(item?.childPosts) && item.childPosts.length > 0) {
    const mediaUrls: string[] = [];
    const childVideoUrls: (string | null)[] = [];
    for (const c of item.childPosts) {
      if (typeof c?.displayUrl !== 'string') continue;
      mediaUrls.push(c.displayUrl);
      childVideoUrls.push(typeof c?.videoUrl === 'string' && c.videoUrl.trim().length > 0 ? c.videoUrl : null);
    }
    if (mediaUrls.length > 0) return { mediaUrls, childVideoUrls };
  }
  return {
    mediaUrls: [item?.displayUrl, item?.videoUrl].filter((u: unknown) => typeof u === 'string'),
    childVideoUrls: [],
  };
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

  const { mediaUrls, childVideoUrls } = extractMedia(item);

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
      mediaUrls,
      videoUrl: firstNonEmptyString(item?.videoUrl),
      runId,
      mentionedHandles: extractStructuredMentions(item),
    },
    childVideoUrls,
  };
}

// ── Apify API (fetch, no SDK) ────────────────────────────────────────

/**
 * Looks the run up under our own account. Throws on any non-2xx or network
 * failure. Exported for reuse by apifyGalleryWebhook.ts (issue #267) — same
 * "no shared webhook secret, verify via our own token instead" auth model.
 */
export async function fetchApifyRun(runId: string, token: string): Promise<{ id: string } | null> {
  const res = await fetch(`${APIFY_API}/actor-runs/${encodeURIComponent(runId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Apify actor-runs lookup failed [${res.status}]`);
  }
  const json = await res.json();
  return json?.data ?? null;
}

/** Exported for reuse by apifyGalleryWebhook.ts (issue #267) — identical dataset-pagination contract regardless of what actor produced the items. */
export async function fetchDatasetItems(datasetId: string, token: string): Promise<any[]> {
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
 *
 * Exported for reuse by apifyGalleryWebhook.ts (issue #267) — the dedupe/
 * merge/new-item-detection contract is identical for a gallery-crawl doc,
 * since both ingest paths write into the same venueIntel collection.
 */
export async function writeVenueIntelDocs(
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
 * Attaches this post's moderation result to one asset, keyed by the asset's
 * own path (images) or its posterPath (video — the pragmatic v1 scans only
 * the cover frame, never the mp4 itself). An asset whose path/posterPath
 * isn't in the map (nothing to scan, or the moderation pass never ran) is
 * returned unchanged rather than defaulted here — dashboard readers treat a
 * missing moderationStatus the same as 'unscanned'.
 */
function withModeration(asset: MediaAsset, moderationByPath: Map<string, ModerationResult>): MediaAsset {
  const lookupPath = asset.type === 'video' ? asset.posterPath : asset.path;
  const mod = lookupPath ? moderationByPath.get(lookupPath) : undefined;
  if (!mod) return asset;
  return { ...asset, moderationStatus: mod.moderationStatus, ...(mod.safeSearch ? { safeSearch: mod.safeSearch } : {}) };
}

/**
 * Media persistence for newly-ingested posts (scope item 1-2): downloads
 * every carousel slide's image (up to the MAX_MEDIA_PER_POST safety
 * ceiling, issue #240), plus any video the item carries — a single
 * top-level videoUrl for a non-carousel post, or a per-slide videoUrl for
 * each carousel slide that has one — to Storage, and writes the
 * mediaAssets/{docId} tracking doc (typed `assets`, see intelMedia.ts).
 * Runs after the venueIntel batch write commits, entirely best-effort —
 * every failure (a single post's media, or the whole pass) is caught and
 * logged here so it can never affect the webhook's response to Apify.
 *
 * Non-carousel posts keep the pre-#240 asset shape exactly: the poster is
 * always its own image asset, and a successfully-downloaded video is
 * appended alongside it (so a video post yields 2 assets referencing the
 * same cover frame). Carousels instead yield exactly one asset per
 * successfully-downloaded slide — a video slide's asset takes over that
 * slide's position (posterPath pointing at the slide's own downloaded
 * image) rather than adding a second entry, which is what keeps an N-slide
 * carousel at N assets in slide order regardless of how many slides are
 * video. Either way, a failed/oversized video degrades that slide to a
 * plain image asset (the poster survives) — per-slide isolation, so one bad
 * slide never drops or fails the rest of the post.
 *
 * SafeSearch moderation (issue #170) runs here too, batched per post (one
 * Vision request covers every image in the post, including every video
 * poster) — see mediaModeration.ts. It's on the same best-effort footing as
 * the rest of this function: moderateImagesForPost never throws (fails open
 * to 'unscanned' internally), so a Vision outage degrades the flag, never
 * blocks the write.
 *
 * `rightsStatus` defaults to 'unverified' (the Instagram-scrape case).
 * Exported so apifyGalleryWebhook.ts (issue #267) can reuse this same
 * download/moderate/asset-build pipeline while passing 'permission_granted'
 * for its already-rights-cleared sources (atlpics.net, nightlifelink.com).
 */
export async function persistNewIntelMedia(
  newItems: MappedVenueIntelItem[],
  rightsStatus?: 'unverified' | 'permission_granted'
): Promise<void> {
  if (newItems.length === 0) return;

  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  for (const item of newItems) {
    const isCarousel = item.childVideoUrls.length > 0;
    const candidateUrls = selectCandidateMediaUrls(item.doc.mediaUrls);
    const slideVideoUrls = isCarousel
      ? selectCandidateSlideVideos(item.doc.mediaUrls, item.childVideoUrls)
      : [];
    if (candidateUrls.length === 0 && !item.doc.videoUrl) continue;

    try {
      const { storagePaths, storagePathsByIndex } =
        candidateUrls.length > 0
          ? await downloadAndStoreIntelMedia(bucket, item.docId, candidateUrls)
          : { storagePaths: [] as string[], storagePathsByIndex: [] as (string | null)[] };

      let assets: MediaAsset[] = [];
      let slidesStored = 0;
      let slidesSkipped = 0;

      if (isCarousel) {
        for (let i = 0; i < storagePathsByIndex.length; i++) {
          const posterPath = storagePathsByIndex[i];
          if (posterPath === null) {
            // This slide's own image failed to download — nothing to
            // attach a video or image asset to, skip the whole slide.
            slidesSkipped++;
            continue;
          }
          const videoUrl = slideVideoUrls[i];
          if (videoUrl) {
            const videoResult = await downloadAndStoreIntelVideo(bucket, item.docId, videoUrl, i);
            if (videoResult.path) {
              assets.push({ path: videoResult.path, type: 'video', posterPath });
              slidesStored++;
              continue;
            }
            slidesSkipped++;
          }
          assets.push({ path: posterPath, type: 'image' });
          slidesStored++;
        }
      } else {
        assets = storagePaths.map((path): MediaAsset => ({ path, type: 'image' }));
        slidesStored = assets.length;
        if (item.doc.videoUrl) {
          const videoResult = await downloadAndStoreIntelVideo(bucket, item.docId, item.doc.videoUrl, 0);
          if (videoResult.path) {
            assets.push({ path: videoResult.path, type: 'video', posterPath: storagePaths[0] });
          }
        }
      }

      if (assets.length === 0) continue;

      const moderationByPath = await moderateImagesForPost(getVisionClient(), bucket.name, storagePaths);
      const moderatedAssets = assets.map((asset) => withModeration(asset, moderationByPath));

      // Vision/Storage cost scales with slide count — logged per post so
      // the nightly report can track spend as carousels get fully ingested.
      logger.info('apifyWebhook: media persistence summary', {
        docId: item.docId,
        slidesSeen: candidateUrls.length,
        slidesStored,
        slidesSkipped,
      });

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
              assets: moderatedAssets,
              rightsStatus,
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
    // persistence landed, and since issue #240 raised the per-post image
    // cap to a full carousel) downloading/uploading up to MAX_MEDIA_PER_POST
    // (20) slide images and any number of per-slide videos (each up to
    // MAX_VIDEO_BYTES, ~60MB) per new post, can take a while for a large
    // scrape run of carousel-heavy accounts. Memory bumped from 512MiB
    // alongside the video path — media is downloaded sequentially (one
    // buffer in flight at a time), but a 60MB video buffer plus the full
    // dataset items array needs headroom.
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
