import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueWrite } from "@/lib/venueAuth"
import { logAuditServer } from "@/lib/serverAuditLog"
import { signStoragePaths, normalizeRightsStatus } from "@/lib/mediaSignedUrls"

export const dynamic = "force-dynamic"

const ASSET_CAP = 40
const GALLERY_CAP = 24

export type VenueMediaOption = { url: string; thumbUrl: string; rightsStatus: "unverified" | "permission_granted" | "wugi_partner" }
export type VenueSelectedMedia = { uri: string; rightsStatus: "unverified" | "permission_granted" | "wugi_partner" }

export type VenueMediaContext = {
  stagedAssets: VenueMediaOption[]
  galleryPhotos: VenueMediaOption[]
  selected: VenueSelectedMedia[]
}

// GET /api/venues/[venueId]/media — the venue asset browser's picker
// options: staged mediaAssets by venueId (same signed-URL pattern as
// draft-events/[id]/venue-assets) plus this venue's eventGalleries
// (photographer-approved photos — same "permission_granted" convention as
// draft-events/[id]/route.ts's gallery section), and the venue's current
// selection/order read back off venues/{venueId}.media. rightsStatus for
// already-selected items is resolved by matching against the picker
// options fetched in this same request, exactly like PublishContext's
// currentMedia in draft-events/[id]/route.ts — an existing selected uri
// that matches nothing here (e.g. a pre-feature import photo) defaults to
// "wugi_partner" rather than "unverified", since that's the venue's own
// already-live listing photo, not an unreviewed IG scrape.
export async function GET(req: NextRequest, { params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params
  const auth = await requireVenueWrite(req, venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getAdminDb()
  const venueSnap = await db.collection("venues").doc(venueId).get()
  if (!venueSnap.exists) return NextResponse.json({ error: "Venue not found" }, { status: 404 })
  const venueData = venueSnap.data()!
  const currentMedia: string[] = Array.isArray(venueData.media) ? venueData.media.filter((m: unknown) => typeof m === "string" && m) : []

  const [assetSnap, gallerySnap] = await Promise.all([
    db.collection("mediaAssets").where("venueId", "==", venueId).orderBy("createdAt", "desc").limit(ASSET_CAP).get(),
    db.collection("eventGalleries").where("venueId", "==", venueId).get(),
  ])

  const stagedAssets: VenueMediaOption[] = []
  for (const doc of assetSnap.docs) {
    if (stagedAssets.length >= ASSET_CAP) break
    const data = doc.data()
    const storagePaths = data?.storagePaths
    if (!Array.isArray(storagePaths) || !storagePaths.length) continue
    const rightsStatus = normalizeRightsStatus(data?.rightsStatus)
    const signedUrls = await signStoragePaths(storagePaths.slice(0, ASSET_CAP - stagedAssets.length))
    for (const url of signedUrls) {
      stagedAssets.push({ url, thumbUrl: url, rightsStatus })
      if (stagedAssets.length >= ASSET_CAP) break
    }
  }

  const galleryPhotos: VenueMediaOption[] = []
  if (!gallerySnap.empty) {
    const galleries = gallerySnap.docs.slice(0, 5)
    const photoSnaps = await Promise.all(
      galleries.map((g) => g.ref.collection("photos").where("approved", "==", true).limit(12).get())
    )
    for (const photos of photoSnaps) {
      for (const p of photos.docs) {
        const url = p.data().url || p.data().thumbUrl
        if (!url) continue
        galleryPhotos.push({ url, thumbUrl: p.data().thumbUrl || url, rightsStatus: "permission_granted" })
        if (galleryPhotos.length >= GALLERY_CAP) break
      }
      if (galleryPhotos.length >= GALLERY_CAP) break
    }
  }

  const knownRights = new Map<string, VenueMediaOption["rightsStatus"]>()
  for (const opt of stagedAssets) knownRights.set(opt.url, opt.rightsStatus)
  for (const opt of galleryPhotos) knownRights.set(opt.url, opt.rightsStatus)

  const selected: VenueSelectedMedia[] = currentMedia.map((uri) => ({ uri, rightsStatus: knownRights.get(uri) || "wugi_partner" }))

  const ctx: VenueMediaContext = { stagedAssets, galleryPhotos, selected }
  return NextResponse.json(ctx)
}

type MediaInput = { uri?: string; rightsStatus?: string }

// PATCH /api/venues/[venueId]/media — save the ordered selection (hero
// first, same "index 0 is the hero" convention as events' media picker).
// Persisted onto venues/{venueId}.media as a flat array of URL strings —
// deliberately NOT an array of {uri, rightsStatus} objects, because
// venue.media is read as plain strings by web/[market]/[slug]/page.tsx and
// mobile-app/VenueScreen.tsx; changing that shape would break both without
// a client migration. rightsStatus is only a selection-time gate here (the
// confirm parity check below), same as events/media/route.ts and
// events/publish/route.ts never persisting rightsStatus onto the event
// doc either. heroImage/heroSelectedBy/heroSelectedAt mirror the fields
// scripts/rerank-venue-heroes.js already writes for the same purpose.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params
  const auth = await requireVenueWrite(req, venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const db = getAdminDb()
  const venueRef = db.collection("venues").doc(venueId)
  const venueSnap = await venueRef.get()
  if (!venueSnap.exists) return NextResponse.json({ error: "Venue not found" }, { status: 404 })

  const rawMedia: MediaInput[] = Array.isArray(body.media) ? body.media : []
  const hasUnverified = rawMedia.some((m) => m?.rightsStatus === "unverified")
  if (hasUnverified && body.confirmedUnverifiedRights !== true) {
    return NextResponse.json({ error: "Selected media includes unverified rights — confirm before saving" }, { status: 400 })
  }
  const media = rawMedia.filter((m) => typeof m.uri === "string" && m.uri).map((m) => m.uri as string)

  await venueRef.update({
    media,
    heroImage: media[0] || null,
    heroSelectedBy: auth.uid,
    heroSelectedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: "updated_venue_media",
    targetId: venueId,
    targetName: venueSnap.data()?.name || venueId,
  })

  return NextResponse.json({ ok: true, media })
}
