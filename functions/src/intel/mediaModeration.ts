// ─────────────────────────────────────────────────────────────────────
// Wugi — Cloud Vision SafeSearch moderation for intel media (issue #170)
//
// Runs after media lands in Storage (functions/src/intel/intelMedia.ts) —
// this is the ingest-time moderation pass so Jarrod reviews the venue-intel
// queue with eyes open, before anything reaches a published event. Poster-
// frame moderation is the pragmatic v1 for video (scope): the full Video
// Intelligence API is out of scope/cost, so a video's cover-frame image
// (already downloaded as a normal image asset — see apifyWebhook.ts's
// persistNewIntelMedia) stands in for the whole clip.
//
// Fail-open by design: a Vision outage, quota error, or malformed response
// degrades to 'unscanned' + a log line, never a thrown error — a moderation
// failure must never block ingest.
// ─────────────────────────────────────────────────────────────────────
import * as logger from 'firebase-functions/logger';

export type Likelihood = 'UNKNOWN' | 'VERY_UNLIKELY' | 'UNLIKELY' | 'POSSIBLE' | 'LIKELY' | 'VERY_LIKELY';

export interface SafeSearchLikelihoods {
  adult: Likelihood;
  racy: Likelihood;
  violence: Likelihood;
  medical: Likelihood;
  spoof: Likelihood;
}

export type ModerationStatus = 'clear' | 'flagged' | 'unscanned';

export interface ModerationResult {
  moderationStatus: ModerationStatus;
  safeSearch?: SafeSearchLikelihoods;
}

const LIKELIHOOD_RANK: Record<Likelihood, number> = {
  UNKNOWN: 0,
  VERY_UNLIKELY: 1,
  UNLIKELY: 2,
  POSSIBLE: 3,
  LIKELY: 4,
  VERY_LIKELY: 5,
};

function atLeast(value: Likelihood, threshold: Likelihood): boolean {
  return LIKELIHOOD_RANK[value] >= LIKELIHOOD_RANK[threshold];
}

/**
 * Pure flagging decision (scope): adult or violence at LIKELY+ flags this
 * asset. Nightlife content is inherently racy-adjacent, so racy alone only
 * flags at VERY_LIKELY — LIKELY would flag nearly everything in the queue
 * and defeat the point of the signal.
 */
export function computeModerationStatus(safeSearch: SafeSearchLikelihoods): 'clear' | 'flagged' {
  if (atLeast(safeSearch.adult, 'LIKELY')) return 'flagged';
  if (atLeast(safeSearch.violence, 'LIKELY')) return 'flagged';
  if (atLeast(safeSearch.racy, 'VERY_LIKELY')) return 'flagged';
  return 'clear';
}

function toLikelihood(value: unknown): Likelihood {
  return typeof value === 'string' && value in LIKELIHOOD_RANK ? (value as Likelihood) : 'UNKNOWN';
}

/**
 * Minimal duck-typed subset of @google-cloud/vision's ImageAnnotatorClient
 * this module needs — lets callers inject the real client (apifyWebhook.ts)
 * or a fake (tests) without this file depending on the SDK's full type
 * surface, same split as intelMedia.ts's IntelMediaBucket.
 */
export interface VisionBatchClient {
  batchAnnotateImages(request: {
    requests: Array<{
      image: { source: { imageUri: string } };
      features: Array<{ type: 'SAFE_SEARCH_DETECTION' }>;
    }>;
  }): Promise<
    [
      {
        responses?:
          | Array<{
              safeSearchAnnotation?: {
                adult?: unknown;
                racy?: unknown;
                violence?: unknown;
                medical?: unknown;
                spoof?: unknown;
              } | null;
              error?: { message?: string | null } | null;
            }>
          | null;
      },
      ...unknown[],
    ]
  >;
}

/**
 * Runs SafeSearch on every gs:// path for one post in a single batched
 * Vision request (scope: "batch per post, not per pixel" — one round-trip
 * covers every image in the post plus the video poster, rather than N
 * separate calls), keyed back to path so callers can attach results to the
 * matching mediaAssets entry.
 *
 * Fail-open at two levels: a request-level failure (network, auth, quota)
 * degrades every path in the batch to 'unscanned'; a per-image error inside
 * an otherwise-successful response degrades just that one path. Never
 * throws.
 */
export async function moderateImagesForPost(
  client: VisionBatchClient,
  bucketName: string,
  paths: string[]
): Promise<Map<string, ModerationResult>> {
  const results = new Map<string, ModerationResult>();
  if (paths.length === 0) return results;

  try {
    const [response] = await client.batchAnnotateImages({
      requests: paths.map((path) => ({
        image: { source: { imageUri: `gs://${bucketName}/${path}` } },
        features: [{ type: 'SAFE_SEARCH_DETECTION' }],
      })),
    });

    const responses = response.responses || [];
    paths.forEach((path, i) => {
      const r = responses[i];
      if (!r || r.error || !r.safeSearchAnnotation) {
        if (r?.error) {
          logger.warn('mediaModeration: per-image annotation error — failing open to unscanned', { path, error: r.error.message });
        }
        results.set(path, { moderationStatus: 'unscanned' });
        return;
      }
      const safeSearch: SafeSearchLikelihoods = {
        adult: toLikelihood(r.safeSearchAnnotation.adult),
        racy: toLikelihood(r.safeSearchAnnotation.racy),
        violence: toLikelihood(r.safeSearchAnnotation.violence),
        medical: toLikelihood(r.safeSearchAnnotation.medical),
        spoof: toLikelihood(r.safeSearchAnnotation.spoof),
      };
      results.set(path, { moderationStatus: computeModerationStatus(safeSearch), safeSearch });
    });
  } catch (err) {
    logger.warn('mediaModeration: batch SafeSearch call failed — failing open to unscanned', {
      err: String(err),
      count: paths.length,
    });
    for (const path of paths) results.set(path, { moderationStatus: 'unscanned' });
  }

  return results;
}
