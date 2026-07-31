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

export interface MediaAssetDocInput {
  venueIntelId: string;
  sourceAccount: string;
  seedAccount: string;
  postUrl: string;
  storagePaths: string[];
}

/** The `createdAt` value is left to the caller (FieldValue.serverTimestamp() in prod, a fixed value in tests). */
export function buildMediaAssetDoc(input: MediaAssetDocInput, createdAt: unknown) {
  return {
    venueIntelId: input.venueIntelId,
    sourceAccount: input.sourceAccount,
    seedAccount: input.seedAccount,
    postUrl: input.postUrl,
    storagePaths: input.storagePaths,
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
