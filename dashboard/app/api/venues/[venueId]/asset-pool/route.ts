import { NextRequest, NextResponse } from "next/server"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueWrite } from "@/lib/venueWriteAuth"

export const dynamic = "force-dynamic"

const LIST_CAP = 200

export type VenueAssetPoolItem = {
  id: string
  type: "image" | "video"
  url: string
  thumbnailUrl: string
  approved: boolean
  tags: string[]
  sourceUrl: string | null
  approvedBy: string | null
  createdAt: string | null
  lastUsedAt: string | null
}

// GET /api/venues/[venueId]/asset-pool — the venue asset manager's full list
// (approved AND unapproved — staff need to see the unapproved queue to
// action it). Distinct from the pre-existing events/[eventId]/venue-assets
// and draft-events/[id]/venue-assets routes, which serve staged mediaAssets
// (scraped, rights-unverified) for the media picker — this serves the
// approved-evergreen venueAssets pool (issue #269) that
// functions/src/venues/venueAssetGallery.ts draws from automatically. Gated
// the same as the Media tab (requireVenueWrite): this is a management
// surface, not a public read.
export async function GET(req: NextRequest, { params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params
  const auth = await requireVenueWrite(req, venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getAdminDb()
  const venueSnap = await db.collection("venues").doc(venueId).get()
  if (!venueSnap.exists) return NextResponse.json({ error: "Venue not found" }, { status: 404 })

  const snap = await db.collection("venueAssets")
    .where("venueId", "==", venueId)
    .orderBy("createdAt", "desc")
    .limit(LIST_CAP)
    .get()

  const assets: VenueAssetPoolItem[] = snap.docs.map((doc) => {
    const d = doc.data()
    return {
      id: doc.id,
      type: d.type === "video" ? "video" : "image",
      url: d.url || "",
      thumbnailUrl: d.thumbnailUrl || d.url || "",
      approved: d.approved === true,
      tags: Array.isArray(d.tags) ? d.tags : [],
      sourceUrl: d.sourceUrl || null,
      approvedBy: d.approvedBy || null,
      createdAt: d.createdAt?.toDate?.().toISOString() ?? null,
      lastUsedAt: d.lastUsedAt?.toDate?.().toISOString() ?? null,
    }
  })

  return NextResponse.json({ assets })
}
