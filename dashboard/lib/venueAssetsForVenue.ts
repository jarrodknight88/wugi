import { getAdminDb } from "@/lib/firebase-admin"
import { signMediaAssets, assetEntriesFromMediaDoc, normalizeRightsStatus } from "@/lib/mediaSignedUrls"

export type VenueAssetOption = {
  url: string
  thumbUrl: string
  rightsStatus?: "unverified" | "permission_granted" | "wugi_partner"
  type?: "image" | "video"
  path?: string
  moderationStatus?: "clear" | "flagged" | "unscanned"
}

const DEFAULT_CAP = 30

// venueAssetsForVenue — the staged-scraped-assets query + signing shared by
// every "select from scraped assets" picker (draft-events, series, and now
// events' venue-assets routes each queried mediaAssets by venueId and signed
// the results byte-for-byte identically — issue #187 folds a third copy into
// one helper instead of adding a fourth). Storage objects here are deny-all
// to clients (firebase/storage.rules), so this always runs server-side via
// the Admin SDK.
export async function venueAssetsForVenue(venueId: string, cap: number = DEFAULT_CAP): Promise<VenueAssetOption[]> {
  if (!venueId) return []

  const snap = await getAdminDb()
    .collection("mediaAssets")
    .where("venueId", "==", venueId)
    .orderBy("createdAt", "desc")
    .limit(cap)
    .get()

  const assets: VenueAssetOption[] = []
  for (const doc of snap.docs) {
    if (assets.length >= cap) break
    const data = doc.data()
    const entries = assetEntriesFromMediaDoc(data)
    if (!entries.length) continue
    const rightsStatus = normalizeRightsStatus(data?.rightsStatus)
    const signedAssets = await signMediaAssets(entries.slice(0, cap - assets.length))
    for (const asset of signedAssets) {
      assets.push({ url: asset.url, thumbUrl: asset.thumbUrl, rightsStatus, type: asset.type, path: asset.path, moderationStatus: asset.moderationStatus })
      if (assets.length >= cap) break
    }
  }
  return assets
}
