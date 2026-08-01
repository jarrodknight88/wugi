import { randomUUID } from "crypto"
import { getAdminStorage, STORAGE_BUCKET } from "@/lib/firebase-admin"

// ─────────────────────────────────────────────────────────────────────
// Wugi — copy-on-publish media materialization (issue #159)
//
// Scraped intel-media/** assets are staged behind 60-minute v4 signed URLs
// (firebase/storage.rules: intel-media/** is `allow read, write: if false`).
// The dashboard picker hands those signed URLs straight to publish/route.ts
// and media/route.ts, so once the signature expires the published event's
// media 404s forever. This module copies any such asset to a permanent
// tokenized location BEFORE it's written to Firestore.
//
// Destination mirrors the source path 1:1 (published-media/{venueIntelDocId}
// /{index}.{ext} for published-media/{venueIntelDocId}/{index}.{ext}) rather
// than being keyed by eventId — a flyer reused across N series occurrences
// stays ONE object with ONE token, so a rights takedown revokes it
// everywhere at once, and the path segment doubles as the mediaAssets doc id
// for provenance. Stable URLs (venues/**, galleries, unsplash/picsum seeds)
// never match the deny-all-signed-URL shape below and pass through
// untouched.
//
// Tokenized (not public) download URLs, matching the existing pattern at
// functions/src/lens/ingestLensUpload.ts's downloadUrl() — every intel-media
// asset starts rightsStatus 'unverified', so token rotation keeps
// per-asset revocation available once the rights-grant story lands.
// ─────────────────────────────────────────────────────────────────────

const INTEL_MEDIA_PREFIX = "intel-media/"
const PUBLISHED_MEDIA_PREFIX = "published-media/"

export type PublishMediaInput = { uri: string; type: "image" | "video"; rightsStatus?: string }
export type PublishMediaOutput = { uri: string; type: "image" | "video" }

// Minimal duck-typed subset of @google-cloud/storage's File/Bucket, injected
// so tests can run against an in-memory fake — same split as
// functions/src/intel/intelMedia.ts's IntelMediaBucket.
export interface PublishMediaBucketFile {
  exists(): Promise<[boolean]>
  getMetadata(): Promise<[{ contentType?: string; metadata?: Record<string, unknown> }]>
  copy(destination: PublishMediaBucketFile, options: { contentType?: string; metadata?: Record<string, string> }): Promise<unknown>
}
export interface PublishMediaBucket {
  file(path: string): PublishMediaBucketFile
}

function defaultBucket(): PublishMediaBucket {
  return getAdminStorage().bucket(STORAGE_BUCKET) as unknown as PublishMediaBucket
}

// Detects a v4 read-signed URL (has X-Goog-Expires) over an intel-media/**
// object and returns that object's storage path, or null if this uri isn't
// one (stable URLs, already-published URLs, malformed input, etc).
function parseSignedIntelMediaPath(uri: string): string | null {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  if (!url.searchParams.has("X-Goog-Expires")) return null

  const bucketPrefix = `/${STORAGE_BUCKET}/`
  if (!url.pathname.startsWith(bucketPrefix)) return null

  const objectPath = decodeURIComponent(url.pathname.slice(bucketPrefix.length))
  return objectPath.startsWith(INTEL_MEDIA_PREFIX) ? objectPath : null
}

function publishedPathFor(sourcePath: string): string {
  return PUBLISHED_MEDIA_PREFIX + sourcePath.slice(INTEL_MEDIA_PREFIX.length)
}

// A video's poster follows the same index-based naming
// functions/src/intel/intelMedia.ts uses at ingest (buildIntelMediaPath /
// buildIntelMediaVideoPath): intel-media/{docId}/video{N}.mp4 pairs with
// intel-media/{docId}/{N}.jpg.
function posterPathFor(videoPath: string): string | null {
  const m = videoPath.match(/^(.*\/)video(\d+)\.(?:mp4)$/)
  return m ? `${m[1]}${m[2]}.jpg` : null
}

function downloadUrl(objectPath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`
}

function firstToken(tokens: unknown): string | null {
  if (typeof tokens !== "string" || !tokens) return null
  return tokens.split(",")[0] || null
}

// Copies sourcePath to its published-media mirror if it isn't already
// there, minting a fresh download token. Idempotent: a pre-existing
// destination reuses its existing token rather than re-copying, so series
// reuse of the same flyer dedupes for free.
async function ensurePublished(bucket: PublishMediaBucket, sourcePath: string): Promise<string> {
  const destPath = publishedPathFor(sourcePath)
  const destFile = bucket.file(destPath)

  const [destExists] = await destFile.exists()
  if (destExists) {
    const [destMetadata] = await destFile.getMetadata()
    const existingToken = firstToken(destMetadata.metadata?.firebaseStorageDownloadTokens)
    if (existingToken) return downloadUrl(destPath, existingToken)
  }

  const srcFile = bucket.file(sourcePath)
  const [srcMetadata] = await srcFile.getMetadata()
  const token = randomUUID()
  await srcFile.copy(destFile, {
    contentType: srcMetadata.contentType,
    metadata: { firebaseStorageDownloadTokens: token },
  })
  return downloadUrl(destPath, token)
}

// materializePublishedMedia — copies any staged intel-media/** signed URL
// among `items` to a permanent tokenized published-media/** URL, and
// returns the same list shape with rewritten uris. Anything that isn't a
// deny-all-signed intel-media URL passes through byte-identical. A per-item
// copy failure is logged and degrades to keeping that item's original uri —
// it never fails the whole publish.
export async function materializePublishedMedia(
  items: PublishMediaInput[],
  bucket: PublishMediaBucket = defaultBucket()
): Promise<PublishMediaOutput[]> {
  return Promise.all(
    items.map(async (item): Promise<PublishMediaOutput> => {
      const original: PublishMediaOutput = { uri: item.uri, type: item.type }
      const sourcePath = parseSignedIntelMediaPath(item.uri)
      if (!sourcePath) return original

      try {
        const uri = await ensurePublished(bucket, sourcePath)

        const posterPath = item.type === "video" ? posterPathFor(sourcePath) : null
        if (posterPath) {
          await ensurePublished(bucket, posterPath).catch((err) => {
            console.warn(`materializePublishedMedia: poster copy failed for ${posterPath}`, err)
          })
        }

        return { uri, type: item.type }
      } catch (err) {
        console.warn(`materializePublishedMedia: copy failed for ${sourcePath}`, err)
        return original
      }
    })
  )
}
