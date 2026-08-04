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
  // Stable Storage object path for staged mediaAssets entries — absent for
  // gallery photos (stable URLs already). The picker's selection identity
  // keys on `path ?? url`, never `url` alone — the same #171 fix applied to
  // VenueMediaPanel (issue #179).
  path?: string
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
      stagedAssets.push({ url: asset.url, thumbUrl: asset.thumbUrl, rightsStatus, type: asset.type, moderationStatus: asset.moderationStatus, path: asset.path })
      if (stagedAssets.length >= ASSET_CAP) break
    }
  }

  // venues.media is being migrated from a flat string[] (web/app/[market]/
  // [slug]/page.tsx historically read `venue.media?.[0]` directly) to the
  // {uri,type,rightsStatus}[] shape events use (issue #238 — venue videos
  // rendered blank because PATCH stripped {type} down to a bare uri string).
  // PATCH below now always writes typed objects, but existing docs still
  // hold legacy strings until scripts/backfill-venue-media-types.js runs, so
  // every entry here is normalized to the typed shape at the read boundary.
  const rawMedia: unknown[] = Array.isArray(venue.media) ? venue.media : []
  const knownRights = new Map<string, VenueMediaOption["rightsStatus"]>()
  for (const opt of galleryPhotos) knownRights.set(opt.url, opt.rightsStatus)
  for (const opt of stagedAssets) knownRights.set(opt.url, opt.rightsStatus)

  const currentMedia: VenueCurrentMediaItem[] = rawMedia
    .map((m): VenueCurrentMediaItem | null => {
      if (typeof m === "string") {
        return m ? { uri: m, type: "image", rightsStatus: normalizeRightsStatus(knownRights.get(m) ?? "wugi_partner") } : null
      }
      const obj = m as { uri?: unknown; type?: unknown; rightsStatus?: unknown }
      if (typeof obj?.uri !== "string" || !obj.uri) return null
      return {
        uri: obj.uri,
        type: obj.type === "video" ? "video" : "image",
        rightsStatus: normalizeRightsStatus(obj.rightsStatus ?? knownRights.get(obj.uri) ?? "wugi_partner"),
      }
    })
    .filter((m): m is VenueCurrentMediaItem => m !== null)

  const ctx: VenueMediaContext = {
    venue: { id: venueId, name: venue.name || "" },
    currentMedia,
    heroImage: typeof venue.heroImage === "string" ? venue.heroImage : currentMedia[0]?.uri ?? null,
    media: { galleryPhotos, stagedAssets },
  }

  return NextResponse.json(ctx)
}

// `path` mirrors the shared picker's SelectedMedia shape (dashboard/lib/
// mediaSelection.ts) so the client can send its selection straight through
// unmodified. Same as draft-events'/events' media routes, `path` is accepted
// here but intentionally does not survive into Firestore (venues.media has
// never persisted it) — it only matters client-side, during the current
// editing session, for stable re-selection of a staged asset.
type MediaInput = { type?: string; uri?: string; rightsStatus?: string; moderationStatus?: string; path?: string }

// PATCH /api/venues/[venueId]/media — persist the picker's selection/order.
// venues.media now stores typed {uri,type,rightsStatus} objects, mirroring
// events/[eventId]/media/route.ts (issue #238 — the prior `.map((m) =>
// m.uri)` stripped {type}, so venue videos normalized to {type:'image'} on
// read and rendered blank in the app). Only the STAGED mediaAssets
// selections are backed by 60-minute intel-media signed URLs, so every uri
// is routed through materializePublishedMedia first — the exact
// copy-on-publish fix PR #160 shipped for draft-events' publish/media routes
// (dashboard/lib/publishMedia.ts). Stable venue-hero/gallery URLs don't
// match its signed-URL shape and pass through untouched. heroImage stays a
// plain uri string (media[0].uri) — unchanged semantics for legacy readers
// that only tolerate a string (web/app/[market]/[slug]/page.tsx and
// web/app/page.tsx were updated in the same change to prefer heroImage and
// normalize media[] entries — see those files).
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

  const filteredMedia = rawMedia.filter((m) => typeof m.uri === "string" && m.uri)
  const materialized = await materializePublishedMedia(
    filteredMedia.map((m) => ({ type: m.type === "video" ? ("video" as const) : ("image" as const), uri: m.uri as string, rightsStatus: m.rightsStatus }))
  )
  // MediaManager's upload flow (see the new upload/route.ts) tags a freshly
  // uploaded file 'owner_upload' — outside normalizeRightsStatus's known
  // values, so it'd otherwise collapse to 'unverified' and wrongly re-trip
  // the risky-save confirm on the next edit. Direct staff uploads are
  // trusted the same as a venue-partner-supplied asset.
  const media = materialized.map((m, i) => {
    const inputRights = filteredMedia[i]?.rightsStatus
    return {
      type: m.type,
      uri: m.uri,
      rightsStatus: normalizeRightsStatus(inputRights === "owner_upload" ? "wugi_partner" : inputRights),
    }
  })

  await venueRef.update({
    media,
    heroImage: media[0]?.uri || null,
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
