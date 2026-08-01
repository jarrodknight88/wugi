import { NextRequest, NextResponse } from "next/server"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueWrite } from "@/lib/venueWriteAuth"
import { signMediaAssets, assetEntriesFromMediaDoc, normalizeRightsStatus } from "@/lib/mediaSignedUrls"
import { materializePublishedMedia } from "@/lib/publishMedia"
import type { MediaOption } from "@/app/api/draft-events/[id]/route"

export const dynamic = "force-dynamic"

const VENUE_ASSET_CAP = 30

async function loadSeriesVenueId(id: string): Promise<string | null> {
  const snap = await getAdminDb().collection("eventSeries").doc(id).get()
  if (!snap.exists) return null
  return snap.data()?.venueId || ""
}

// GET /api/series/[id]/venue-assets — the series Media Manager's "select
// from scraped" browser (issue #171 Feature 3a): every mediaAssets doc
// staged for this series' venue, same query + signing as draft-events'
// venue-assets route and venues/[venueId]/media/route.ts. Gated by
// requireVenueWrite (venue-scoped, same as venues/[venueId]/media) rather
// than requireVenueIntelStaff — series editing is venue-admin territory, not
// venue-intel-staff-only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const venueId = await loadSeriesVenueId(id)
  if (venueId === null) return NextResponse.json({ error: "Series not found" }, { status: 404 })

  const auth = await requireVenueWrite(req, venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!venueId) return NextResponse.json({ assets: [] })

  const snap = await getAdminDb()
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
      assets.push({ url: asset.url, thumbUrl: asset.thumbUrl, rightsStatus, type: asset.type, path: asset.path })
      if (assets.length >= VENUE_ASSET_CAP) break
    }
  }

  return NextResponse.json({ assets })
}

type MediaInput = { type?: string; uri?: string; rightsStatus?: string; path?: string }

// POST /api/series/[id]/venue-assets — materializes selected staged assets
// (signed intel-media/** URLs) into permanent published-media/** copies
// BEFORE they're allowed to land in eventSeries.media — the same
// copy-on-publish contract draft-events' publish/media routes enforce
// (issue #160: a signed URL written straight into Firestore recreates the
// dead-media factory once its 60-minute signature expires). This route only
// returns the materialized items; the actual eventSeries.media write stays
// series/page.tsx's existing client-side Firestore save() — this is purely
// the "make it safe to persist" step for the staged-asset path.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const venueId = await loadSeriesVenueId(id)
  if (venueId === null) return NextResponse.json({ error: "Series not found" }, { status: 404 })

  const auth = await requireVenueWrite(req, venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const rawItems: MediaInput[] = Array.isArray(body.items) ? body.items : []
  const hasUnverified = rawItems.some((m) => m?.rightsStatus === "unverified")
  if (hasUnverified && body.confirmedUnverifiedRights !== true) {
    return NextResponse.json({ error: "Selected media includes unverified rights — confirm before adding" }, { status: 400 })
  }

  const filtered = rawItems.filter((m) => typeof m.uri === "string" && m.uri)
  const materialized = await materializePublishedMedia(
    filtered.map((m) => ({ type: m.type === "video" ? ("video" as const) : ("image" as const), uri: m.uri as string, rightsStatus: m.rightsStatus }))
  )
  // path is attached positionally after materialization — the stable
  // intel-media/** source path, so a reload can re-mark this item selected
  // in the picker (issue #171). materializePublishedMedia's own contract
  // (returns {uri,type}) is untouched.
  const media = materialized.map((m, i) => (filtered[i]?.path ? { ...m, path: filtered[i].path } : m))

  return NextResponse.json({ media })
}
