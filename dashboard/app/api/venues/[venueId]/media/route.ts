import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueWrite } from "@/lib/venueWriteAuth"
import { signMediaAssets, assetEntriesFromMediaDoc, normalizeRightsStatus } from "@/lib/mediaSignedUrls"
import { materializePublishedMedia } from "@/lib/publishMedia"
import { logAuditServer } from "@/lib/serverAuditLog"

export const dynamic = "force-dynamic"

const ASSET_CAP = 30
const GALLERY_CAP = 24

export type VenueMediaOption = {
  url: string
  thumbUrl: string
  rightsStatus?: "unverified" | "permission_granted" | "wugi_partner"
  type?: "image" | "video"
  // SafeSearch moderation (issue #170) — only ever set on stagedAssets
  // (scraped mediaAssets); gallery photos are trusted, never carry it.
  moderationStatus?: "clear" | "flagged" | "unscanned"
}
export type VenueCurrentMediaItem = { uri: string; type: "image" | "video"; rightsStatus: "unverified" | "permission_granted" | "wugi_partner" }

export type VenueMediaContext = {
  venue: { id: string; name: string }
  currentMedia: VenueCurrentMediaItem[]
  heroImage: string | null
  media: { galleryPhotos: VenueMediaOption[]; stagedAssets: VenueMediaOption[] }
}

// GET /api/venues/[venueId]/media — the venue Media tab's asset browser
// context: this venue's mediaAssets (scraped, deny-all Storage objects —
// signed server-side, same query as draft-events/[id]/venue-assets/route.ts)
// plus its eventGalleries photos, plus the venue's own currently-selected
// media (venues.media) preloaded so the picker shows current selection/order.
export async function GET(req: NextRequest, { params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params
  const auth = await requireVenueWrite(req, venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getAdminDb()
  const venueSnap = await db.collection("venues").doc(venueId).get()
  if (!venueSnap.exists) return NextResponse.json({ error: "Venue not found" }, { status: 404 })
  const venue = venueSnap.data()!

  const [gallerySnap, assetSnap] = await Promise.all([
    db.collection("eventGalleries").where("venueId", "==", venueId).get(),
    db.collection("mediaAssets").where("venueId", "==", venueId).orderBy("createdAt", "desc").limit(ASSET_CAP).get(),
  ])

  const galleryPhotos: VenueMediaOption[] = []
  if (!gallerySnap.empty) {
    const galleries = gallerySnap.docs.slice(0, 5)
    const photoSnaps = await Promise.all(galleries.map((g) => g.ref.collection("photos").where("approved", "==", true).limit(12).get()))
    for (const photos of photoSnaps) {
      for (const p of photos.docs) {
        const url = p.data().url || p.data().thumbUrl
        if (!url) continue
        galleryPhotos.push({ url, thumbUrl: p.data().thumbUrl || url, rightsStatus: "permission_granted", type: "image" })
        if (galleryPhotos.length >= GALLERY_CAP) break
      }
      if (galleryPhotos.length >= GALLERY_CAP) break
    }
  }

  const stagedAssets: VenueMediaOption[] = []
  for (const doc of assetSnap.docs) {
    if (stagedAssets.length >= ASSET_CAP) break
    const data = doc.data()
    const entries = assetEntriesFromMediaDoc(data)
    if (!entries.length) continue
    const rightsStatus = normalizeRightsStatus(data?.rightsStatus)
    const signedAssets = await signMediaAssets(entries.slice(0, ASSET_CAP - stagedAssets.length))
    for (const asset of signedAssets) {
      stagedAssets.push({ url: asset.url, thumbUrl: asset.thumbUrl, rightsStatus, type: asset.type, moderationStatus: asset.moderationStatus })
      if (stagedAssets.length >= ASSET_CAP) break
    }
  }

  // venues.media is a flat string[] (web/app/[market]/[slug]/page.tsx reads
  // `venue.media?.[0]` and `.slice(1,5)` directly) — NOT the {uri,type}[]
  // shape events use. A legacy {uri} object entry is tolerated on read (see
  // scripts/rerank-venue-heroes.js) but PATCH below always writes strings.
  const rawMedia: unknown[] = Array.isArray(venue.media) ? venue.media : []
  const knownRights = new Map<string, VenueMediaOption["rightsStatus"]>()
  for (const opt of galleryPhotos) knownRights.set(opt.url, opt.rightsStatus)
  for (const opt of stagedAssets) knownRights.set(opt.url, opt.rightsStatus)

  const currentMedia: VenueCurrentMediaItem[] = rawMedia
    .map((m) => (typeof m === "string" ? m : (m as { uri?: unknown })?.uri))
    .filter((uri): uri is string => typeof uri === "string" && !!uri)
    .map((uri) => ({ uri, type: "image", rightsStatus: normalizeRightsStatus(knownRights.get(uri) ?? "wugi_partner") }))

  const ctx: VenueMediaContext = {
    venue: { id: venueId, name: venue.name || "" },
    currentMedia,
    heroImage: typeof venue.heroImage === "string" ? venue.heroImage : currentMedia[0]?.uri ?? null,
    media: { galleryPhotos, stagedAssets },
  }

  return NextResponse.json(ctx)
}

type MediaInput = { type?: string; uri?: string; rightsStatus?: string; moderationStatus?: string }

// PATCH /api/venues/[venueId]/media — persist the picker's selection/order.
// venues.media stays a flat string[] (client-compat — see GET above); only
// the STAGED mediaAssets selections are backed by 60-minute intel-media
// signed URLs, so every uri is routed through materializePublishedMedia
// first — the exact copy-on-publish fix PR #160 shipped for draft-events'
// publish/media routes (dashboard/lib/publishMedia.ts). Stable venue-hero/
// gallery URLs don't match its signed-URL shape and pass through untouched.
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
  const hasRisky = rawMedia.some((m) => m?.rightsStatus === "unverified" || m?.moderationStatus === "flagged")
  if (hasRisky && body.confirmedUnverifiedRights !== true) {
    return NextResponse.json({ error: "Selected media includes unverified rights or flagged content — confirm before saving" }, { status: 400 })
  }

  const materialized = await materializePublishedMedia(
    rawMedia
      .filter((m) => typeof m.uri === "string" && m.uri)
      .map((m) => ({ type: m.type === "video" ? ("video" as const) : ("image" as const), uri: m.uri as string, rightsStatus: m.rightsStatus }))
  )
  const media = materialized.map((m) => m.uri)

  await venueRef.update({
    media,
    heroImage: media[0] || null,
    heroSelectedBy: auth.email || auth.uid,
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
