// ─────────────────────────────────────────────────────────────────────
// Wugi — Intel media persistence helpers (apifyWebhook post-ingest)
//
// IG CDN URLs on scraped mediaUrls expire, so newly-ingested venueIntel
// posts get their media downloaded server-side and staged in Storage —
// attachable at event publish once a human clears rights. This module is
// the shared core between apifyWebhook (new scrapes, live) and
// scripts/backfill-intel-media.js (the existing backlog, one-time).
//
// Split deliberately: the pure functions (selectCandidateMediaUrls,
// buildIntelMediaPath, buildMediaAssetDoc) are unit-tested directly
// against compiled lib/ output (see scripts/test-intel-media.js — no
// network, no Storage emulator needed). downloadAndStoreIntelMedia is the
// effectful boundary (fetch + Storage write) and is exercised only
// indirectly (manual/staging verification), same as the rest of this
// ingest pipeline.
// ─────────────────────────────────────────────────────────────────────
import * as logger from 'firebase-functions/logger';
import type { ModerationStatus, SafeSearchLikelihoods } from './mediaModeration';

export const INTEL_MEDIA_PREFIX = 'intel-media';
// Issue #240: raised from the original 3-image cap to a hard safety ceiling
// matching Instagram's own carousel max (20 slides) — in practice this means
// every slide of a real post gets downloaded; the ceiling only exists to
// bound a malformed/future-expanded payload rather than to reflect a
// realistic slide count.
export const MAX_MEDIA_PER_POST = 20;
// Video posts' CDN URLs expire within hours (vs. images, which last much
// longer) — capturing the video at ingest is the only chance to keep it.
// Anything over this cap is skipped (poster still stored) rather than risk a
// runaway download in a 512MiB function.
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // ~60MB

// Obvious video files never make it to the fetch step at all — the real
// images-only gate is the response Content-Type check in
// downloadAndStoreIntelMedia (scope item 1: "skip videos v1 — images only
// by content-type"), since IG CDN URLs rarely carry a trustworthy
// extension either way.
const VIDEO_EXTENSION_RE = /\.(mp4|mov|m4v|webm|m3u8)(\?|$)/i;

/**
 * Minimal shape of the Storage bucket File API this module needs — lets
 * callers pass admin.storage().bucket() without this file depending on
 * firebase-admin's types directly.
 */
export interface IntelMediaBucket {
  file(path: string): {
    save(data: Buffer, options: { contentType: string; metadata?: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface DownloadedIntelMedia {
  storagePaths: string[];
  // Same length as the input candidateUrls, aligned by index — null where
  // that candidate's download failed. storagePaths above is compacted
  // (success order only), which is fine for plain image display but is the
  // wrong thing to pair against a parallel per-slide array (e.g. carousel
  // video URLs): an earlier failure would silently shift every later
  // slide's pairing by one. Carousel video handling in apifyWebhook.ts
  // pairs against this field instead.
  storagePathsByIndex: (string | null)[];
  attempted: number;
  failed: number;
}

/** Storage object path for the Nth (0-indexed) image downloaded for a venueIntel doc. */
export function buildIntelMediaPath(venueIntelDocId: string, index: number): string {
  return `${INTEL_MEDIA_PREFIX}/${venueIntelDocId}/${index}.jpg`;
}

/** Storage object path for the Nth (0-indexed) video downloaded for a venueIntel doc. */
export function buildIntelMediaVideoPath(venueIntelDocId: string, index: number): string {
  return `${INTEL_MEDIA_PREFIX}/${venueIntelDocId}/video${index}.mp4`;
}

interface FilteredMediaUrlEntry {
  url: string;
  originalIndex: number;
}

/**
 * Shared filter step behind selectCandidateMediaUrls and
 * selectCandidateSlideVideos: strings only, drop obvious video URLs, keep
 * each survivor's original array index. Sharing this (rather than each
 * function re-deriving its own filtered list) is what keeps the two
 * functions provably index-aligned with each other.
 */
function filterMediaUrlEntries(mediaUrls: unknown): FilteredMediaUrlEntry[] {
  if (!Array.isArray(mediaUrls)) return [];
  const out: FilteredMediaUrlEntry[] = [];
  mediaUrls.forEach((u, originalIndex) => {
    if (typeof u === 'string' && u.trim().length > 0 && !VIDEO_EXTENSION_RE.test(u)) {
      out.push({ url: u, originalIndex });
    }
  });
  return out;
}

/**
 * Pure pre-filter: strings only, drop obvious video URLs, cap to the first
 * N (scope #240: raised from a fixed first-3 to a parameterized cap,
 * default MAX_MEDIA_PER_POST — see that constant). Order preserved —
 * mediaUrls is already in post order, and storagePaths index must match
 * what actually got fetched.
 */
export function selectCandidateMediaUrls(mediaUrls: unknown, cap: number = MAX_MEDIA_PER_POST): string[] {
  return filterMediaUrlEntries(mediaUrls)
    .slice(0, cap)
    .map((e) => e.url);
}

/**
 * Per-slide video URL selection for carousels (issue #240 scope item 2),
 * index-aligned to selectCandidateMediaUrls' output: call it with the SAME
 * `mediaUrls` and `cap` used for the sibling selectCandidateMediaUrls call
 * so that result[i] and storagePaths[i] refer to the same carousel slide.
 * `slideVideoUrls` must be index-aligned to `mediaUrls` itself (same length,
 * one entry per slide; null/non-string for a slide with no video of its
 * own). Returns exactly one entry per selected image candidate.
 */
export function selectCandidateSlideVideos(
  mediaUrls: unknown,
  slideVideoUrls: unknown,
  cap: number = MAX_MEDIA_PER_POST
): (string | null)[] {
  const entries = filterMediaUrlEntries(mediaUrls).slice(0, cap);
  const videos = Array.isArray(slideVideoUrls) ? slideVideoUrls : [];
  return entries.map((e) => {
    const v = videos[e.originalIndex];
    return typeof v === 'string' && v.trim().length > 0 ? v : null;
  });
}

/**
 * Typed media entry (schema evolution, scope item 2). `path`/`posterPath` are
 * Storage object paths, not URLs — dashboard readers mint short-lived signed
 * URLs from these at request time, same as the legacy `storagePaths` shape.
 */
export interface MediaAsset {
  path: string;
  type: 'image' | 'video';
  posterPath?: string;
  // SafeSearch moderation (issue #170) — for a video asset, these describe
  // its posterPath (the pragmatic v1: no full-video scan). Absent when the
  // moderation pass never ran for this asset (e.g. no image to scan, or
  // deploys prior to this feature) — dashboard readers treat that the same
  // as 'unscanned'.
  moderationStatus?: ModerationStatus;
  safeSearch?: SafeSearchLikelihoods;
}

export interface MediaAssetDocInput {
  venueIntelId: string;
  sourceAccount: string;
  seedAccount: string;
  postUrl: string;
  // Images only — kept as-is for backward compatibility with readers that
  // haven't migrated to `assets` yet (dashboard/lib/mediaSignedUrls.ts and
  // its two callers HAVE migrated, in this same PR; storagePaths is kept as
  // the on-disk source of truth for images either way).
  storagePaths: string[];
  // Typed superset of storagePaths, plus any video. Optional on input:
  // callers that only ever produced images (e.g. the one-time
  // scripts/backfill-intel-media.js, which never got a video code path)
  // don't need updating — buildMediaAssetDoc derives it from storagePaths
  // when omitted, so every doc still ends up with a usable `assets` array.
  assets?: MediaAsset[];
  // Defaults to 'unverified' (the Instagram-scrape case — a human has to
  // clear rights before publish, see docs/VENUE-INTEL-SOP.md §6). Callers
  // ingesting from a source with a standing permission grant (e.g. the
  // atlpics.net/nightlifelink.com gallery crawler — issue #267) pass
  // 'permission_granted' so those assets skip the publish-blocking gate
  // that dashboard code already applies to 'unverified' media.
  rightsStatus?: 'unverified' | 'permission_granted';
}

/** The `createdAt` value is left to the caller (FieldValue.serverTimestamp() in prod, a fixed value in tests). */
export function buildMediaAssetDoc(input: MediaAssetDocInput, createdAt: unknown) {
  const assets: MediaAsset[] =
    input.assets ?? input.storagePaths.map((path) => ({ path, type: 'image' as const }));
  return {
    venueIntelId: input.venueIntelId,
    sourceAccount: input.sourceAccount,
    seedAccount: input.seedAccount,
    postUrl: input.postUrl,
    storagePaths: input.storagePaths,
    assets,
    rightsStatus: input.rightsStatus ?? ('unverified' as const),
    venueId: null,
    createdAt,
  };
}

/**
 * Fetches each candidate URL and uploads any that come back as an image
 * (by Content-Type — the v1 images-only gate) to
 * intel-media/{venueIntelDocId}/{index}.jpg. Per-URL failures (network
 * error, non-2xx, non-image content-type) are logged and skipped; they
 * never throw, so a bad post never fails the caller's batch.
 */
export async function downloadAndStoreIntelMedia(
  bucket: IntelMediaBucket,
  venueIntelDocId: string,
  candidateUrls: string[]
): Promise<DownloadedIntelMedia> {
  const storagePaths: string[] = [];
  const storagePathsByIndex: (string | null)[] = [];
  let failed = 0;

  for (let index = 0; index < candidateUrls.length; index++) {
    const url = candidateUrls[index];
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`fetch failed [${res.status}]`);
      }
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        logger.warn('intelMedia: skipping non-image media', { venueIntelDocId, index, contentType });
        failed++;
        storagePathsByIndex.push(null);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const storagePath = buildIntelMediaPath(venueIntelDocId, index);
      await bucket.file(storagePath).save(buffer, { contentType: 'image/jpeg' });
      storagePaths.push(storagePath);
      storagePathsByIndex.push(storagePath);
    } catch (err) {
      failed++;
      storagePathsByIndex.push(null);
      logger.warn('intelMedia: media download/store failed', { venueIntelDocId, index, url, err: String(err) });
    }
  }

  return { storagePaths, storagePathsByIndex, attempted: candidateUrls.length, failed };
}

export type IntelVideoSkipReason = 'too_large' | 'fetch_failed' | 'bad_content_type';

export interface DownloadedIntelVideo {
  path: string | null;
  sizeBytes?: number;
  skippedReason?: IntelVideoSkipReason;
}

/**
 * Fetches a single video URL and, if it's under MAX_VIDEO_BYTES, uploads it
 * to intel-media/{venueIntelDocId}/video{index}.mp4. The Content-Length
 * header is checked first so an oversized file is skipped without buffering
 * it into memory; if the CDN omits that header, the downloaded buffer's
 * actual size is checked as a fallback before the Storage write. Never
 * throws — a failed/oversized video degrades to { path: null }, and the
 * poster (downloaded separately via downloadAndStoreIntelMedia) is
 * unaffected either way.
 */
export async function downloadAndStoreIntelVideo(
  bucket: IntelMediaBucket,
  venueIntelDocId: string,
  videoUrl: string,
  index: number = 0
): Promise<DownloadedIntelVideo> {
  try {
    const res = await fetch(videoUrl);
    if (!res.ok) {
      logger.warn('intelMedia: video fetch failed', { venueIntelDocId, index, status: res.status });
      return { path: null, skippedReason: 'fetch_failed' };
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType && !contentType.startsWith('video/') && !contentType.startsWith('application/octet-stream')) {
      logger.warn('intelMedia: skipping non-video media', { venueIntelDocId, index, contentType });
      return { path: null, skippedReason: 'bad_content_type' };
    }

    const declaredSize = Number(res.headers.get('content-length') || NaN);
    if (Number.isFinite(declaredSize) && declaredSize > MAX_VIDEO_BYTES) {
      logger.info('intelMedia: skipping oversized video', {
        venueIntelDocId,
        index,
        sizeBytes: declaredSize,
        capBytes: MAX_VIDEO_BYTES,
      });
      return { path: null, sizeBytes: declaredSize, skippedReason: 'too_large' };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_VIDEO_BYTES) {
      logger.info('intelMedia: skipping oversized video (measured after download — no usable Content-Length)', {
        venueIntelDocId,
        index,
        sizeBytes: buffer.byteLength,
        capBytes: MAX_VIDEO_BYTES,
      });
      return { path: null, sizeBytes: buffer.byteLength, skippedReason: 'too_large' };
    }

    const storagePath = buildIntelMediaVideoPath(venueIntelDocId, index);
    await bucket.file(storagePath).save(buffer, { contentType: 'video/mp4' });
    return { path: storagePath, sizeBytes: buffer.byteLength };
  } catch (err) {
    logger.warn('intelMedia: video download/store failed', { venueIntelDocId, index, url: videoUrl, err: String(err) });
    return { path: null, skippedReason: 'fetch_failed' };
  }
}
