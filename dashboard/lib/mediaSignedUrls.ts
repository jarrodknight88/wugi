import { getAdminStorage, STORAGE_BUCKET } from "@/lib/firebase-admin"

// Shared by every route that mints v4 read signed URLs for mediaAssets
// storagePaths (draft-events publish context, venue-wide asset browse, and
// the published-event media editor). Storage objects here are deny-all to
// clients (firebase/storage.rules), so this always runs server-side via the
// Admin SDK. A path that fails to sign degrades to being dropped rather than
// failing the whole request.
export async function signStoragePaths(storagePaths: unknown[]): Promise<string[]> {
  const bucket = getAdminStorage().bucket(STORAGE_BUCKET)
  const signedUrls = await Promise.all(
    storagePaths.map(async (storagePath) => {
      if (typeof storagePath !== "string" || !storagePath) return null
      try {
        const [url] = await bucket.file(storagePath).getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + 60 * 60 * 1000, // 60 min
        })
        return url
      } catch (err) {
        console.warn(`signStoragePaths: signed URL failed for ${storagePath}`, err)
        return null
      }
    })
  )
  return signedUrls.filter((url): url is string => Boolean(url))
}

export function normalizeRightsStatus(value: unknown): "unverified" | "permission_granted" | "wugi_partner" {
  return value === "permission_granted" || value === "wugi_partner" ? value : "unverified"
}
