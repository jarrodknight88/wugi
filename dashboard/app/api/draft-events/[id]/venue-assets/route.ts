import { NextRequest, NextResponse } from "next/server"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { venueAssetsForVenue } from "@/lib/venueAssetsForVenue"

export const dynamic = "force-dynamic"

// GET /api/draft-events/[id]/venue-assets — "All venue assets" tab of the
// staged-assets picker section. Unlike the default GET /api/draft-events/[id]
// context (which only surfaces the mediaAssets doc tied to this draft's own
// source post), this queries every mediaAssets doc backfilled with this
// draft's venueId — so a flyer staged under a different IG post for the same
// venue is still findable and attachable. The query+signing itself now lives
// in lib/venueAssetsForVenue.ts, shared with the events Media tab's identical
// picker (issue #187) — this route just resolves the draft's venueId first.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const draftSnap = await getAdminDb().collection("draftEvents").doc(id).get()
  if (!draftSnap.exists) return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  const venueId: string = draftSnap.data()?.venueId || ""

  const assets = await venueAssetsForVenue(venueId)
  return NextResponse.json({ assets })
}
