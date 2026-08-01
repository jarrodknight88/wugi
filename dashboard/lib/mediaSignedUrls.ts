import { getAdminStorage, STORAGE_BUCKET } from "@/lib/firebase-admin"

export function normalizeRightsStatus(value: unknown): "unverified" | "permission_granted" | "wugi_partner" {
  return value === "permission_granted" || value === "wugi_partner" ? value : "unverified"
}

export type ModerationStatus = "clear" | "flagged" | "unscanned"

function normalizeModerationStatus(value: unknown): ModerationStatus {
  return value === "clear" || value === "flagged" ? value : "unscanned"
}

export type MediaAssetEntry = { path: string; type: "image" | "video"; posterPath?: string; moderationStatus: ModerationStatus }

// Schema evolution (video assets, scope item 2; moderation, issue #170):
// mediaAssets docs written after this deploy carry a typed `assets` array
// with a per-asset moderationStatus; the 227 docs that predate it only have
// `storagePaths` (images only, never scanned) and docs written between the
// two deploys have `assets` without moderationStatus. All three degrade to
// moderationStatus: 'unscanned' here — normalizeModerationStatus is the only
// place that decides that default, so callers never need their own
// backward-compat branch.
export function assetEntriesFromMediaDoc(data: unknown): MediaAssetEntry[] {
  const record = data as { assets?: unknown; storagePaths?: unknown } | null | undefined
  if (Array.isArray(record?.assets) && record.assets.length > 0) {
    return record.assets
      .filter((a): a is { path: string; type?: unknown; posterPath?: unknown; moderationStatus?: unknown } => typeof (a as { path?: unknown })?.path === "string" && !!(a as { path?: unknown }).path)
      .map((a) => ({
        path: a.path,
        type: a.type === "video" ? "video" : "image",
        posterPath: typeof a.posterPath === "string" && a.posterPath ? a.posterPath : undefined,
        moderationStatus: normalizeModerationStatus(a.moderationStatus),
      }))
  }
  if (Array.isArray(record?.storagePaths)) {
    return record.storagePaths
      .filter((p): p is string => typeof p === "string" && !!p)
      .map((path) => ({ path, type: "image" as const, moderationStatus: "unscanned" as const }))
  }
  return []
}

export type SignedMediaAsset = { url: string; thumbUrl: string; type: "image" | "video"; moderationStatus: ModerationStatus }

// Shared by every route that mints v4 read signed URLs for mediaAssets
// entries (draft-events publish context, venue-wide asset browse, and the
// published-event media editor). Storage objects here are deny-all to
// clients (firebase/storage.rules), so this always runs server-side via the
// Admin SDK. A path that fails to sign degrades to being dropped rather than
// failing the whole request. For a video asset, `thumbUrl` is the signed
// poster URL (so the picker never has to render a <video> just to show a
// thumbnail) — it falls back to the video URL itself only if there's no
// posterPath, which shouldn't happen in practice (the ingest side always
// pairs a video with its poster) but keeps the picker from rendering nothing.
export async function signMediaAssets(entries: MediaAssetEntry[]): Promise<SignedMediaAsset[]> {
  const bucket = getAdminStorage().bucket(STORAGE_BUCKET)

  async function sign(path: string): Promise<string | null> {
    try {
      const [url] = await bucket.file(path).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 60 * 60 * 1000, // 60 min
      })
      return url
    } catch (err) {
      console.warn(`signMediaAssets: signed URL failed for ${path}`, err)
      return null
    }
  }

  const signed = await Promise.all(
    entries.map(async (entry): Promise<SignedMediaAsset | null> => {
      const [url, posterUrl] = await Promise.all([
        sign(entry.path),
        entry.type === "video" && entry.posterPath ? sign(entry.posterPath) : Promise.resolve(null),
      ])
      if (!url) return null
      return { url, thumbUrl: posterUrl || url, type: entry.type, moderationStatus: entry.moderationStatus }
    })
  )
  return signed.filter((x): x is SignedMediaAsset => Boolean(x))
}
