import { NextRequest, NextResponse } from "next/server"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { signMediaAssets, assetEntriesFromMediaDoc, normalizeRightsStatus } from "@/lib/mediaSignedUrls"
import type { MediaOption } from "@/app/api/draft-events/[id]/route"

export const dynamic = "force-dynamic"

const VENUE_ASSET_CAP = 30

// GET /api/draft-events/[id]/venue-assets — "All venue assets" tab of the
// staged-assets picker section. Unlike the default GET /api/draft-events/[id]
// context (which only surfaces the mediaAssets doc tied to this draft's own
// source post), this queries every mediaAssets doc backfilled with this
// draft's venueId — so a flyer staged under a different IG post for the same
// venue is still findable and attachable.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const db = getAdminDb()

  const draftSnap = await db.collection("draftEvents").doc(id).get()
  if (!draftSnap.exists) return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  const venueId: string = draftSnap.data()?.venueId || ""
  if (!venueId) return NextResponse.json({ assets: [] })

  const snap = await db
    .collection("mediaAssets")
    .where("venueId", "==", venueId)
    .orderBy("createdAt", "desc")
    .limit(VENUE_ASSET_CAP)
    .get()

  const assets: MediaOption[] = []
  for (const doc of snap.docs) {
    if (assets.length >= VENUE_ASSET_CAP) break
    const data = doc.data()
    const entries = assetEntriesFromMediaDoc(data)
    if (!entries.length) continue
    const rightsStatus = normalizeRightsStatus(data?.rightsStatus)
    const signedAssets = await signMediaAssets(entries.slice(0, VENUE_ASSET_CAP - assets.length))
    for (const asset of signedAssets) {
      assets.push({ url: asset.url, thumbUrl: asset.thumbUrl, rightsStatus, type: asset.type })
      if (assets.length >= VENUE_ASSET_CAP) break
    }
  }

  return NextResponse.json({ assets })
}
