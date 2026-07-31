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

export const INTEL_MEDIA_PREFIX = 'intel-media';
export const MAX_MEDIA_PER_POST = 3;
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

/**
 * Pure pre-filter: strings only, drop obvious video URLs, cap to the first
 * N (scope: first 3 per post). Order preserved — mediaUrls is already in
 * post order, and storagePaths index must match what actually got fetched.
 */
export function selectCandidateMediaUrls(mediaUrls: unknown, cap: number = MAX_MEDIA_PER_POST): string[] {
  if (!Array.isArray(mediaUrls)) return [];
  const strings = mediaUrls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
  const imagesOnly = strings.filter((u) => !VIDEO_EXTENSION_RE.test(u));
  return imagesOnly.slice(0, cap);
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
    rightsStatus: 'unverified' as const,
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
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const storagePath = buildIntelMediaPath(venueIntelDocId, index);
      await bucket.file(storagePath).save(buffer, { contentType: 'image/jpeg' });
      storagePaths.push(storagePath);
    } catch (err) {
      failed++;
      logger.warn('intelMedia: media download/store failed', { venueIntelDocId, index, url, err: String(err) });
    }
  }

  return { storagePaths, attempted: candidateUrls.length, failed };
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
