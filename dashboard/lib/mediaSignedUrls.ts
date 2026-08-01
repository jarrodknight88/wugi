import { getAdminStorage, STORAGE_BUCKET } from "@/lib/firebase-admin"

export function normalizeRightsStatus(value: unknown): "unverified" | "permission_granted" | "wugi_partner" {
  return value === "permission_granted" || value === "wugi_partner" ? value : "unverified"
}

export type MediaAssetEntry = { path: string; type: "image" | "video"; posterPath?: string }

// Schema evolution (video assets, scope item 2): mediaAssets docs written
// after this deploy carry a typed `assets` array; the 227 docs that predate
// it only have `storagePaths` (images only). Reading both shapes here means
// the two callers (draft-events route + venue-assets route) never need a
// data migration — old docs just never produce a video entry, which matches
// reality (their IG video URLs expired long before this feature existed).
export function assetEntriesFromMediaDoc(data: unknown): MediaAssetEntry[] {
  const record = data as { assets?: unknown; storagePaths?: unknown } | null | undefined
  if (Array.isArray(record?.assets) && record.assets.length > 0) {
    return record.assets
      .filter((a): a is { path: string; type?: unknown; posterPath?: unknown } => typeof (a as { path?: unknown })?.path === "string" && !!(a as { path?: unknown }).path)
      .map((a) => ({
        path: a.path,
        type: a.type === "video" ? "video" : "image",
        posterPath: typeof a.posterPath === "string" && a.posterPath ? a.posterPath : undefined,
      }))
  }
  if (Array.isArray(record?.storagePaths)) {
    return record.storagePaths
      .filter((p): p is string => typeof p === "string" && !!p)
      .map((path) => ({ path, type: "image" as const }))
  }
  return []
}

export type SignedMediaAsset = { url: string; thumbUrl: string; type: "image" | "video" }

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
      return { url, thumbUrl: posterUrl || url, type: entry.type }
    })
  )
  return signed.filter((x): x is SignedMediaAsset => Boolean(x))
}
