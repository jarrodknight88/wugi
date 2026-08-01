import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { logAuditServer } from "@/lib/serverAuditLog"
import { extractVenueLatLng } from "@/lib/venueLatLng"
import { cleanDraftTitle, cleanDraftAbout, isoToDatePickerString } from "@/lib/draftEventText"
import { signMediaAssets, assetEntriesFromMediaDoc, normalizeRightsStatus } from "@/lib/mediaSignedUrls"

export const dynamic = "force-dynamic"

export type MediaOption = {
  url: string
  thumbUrl: string
  rightsStatus?: "unverified" | "permission_granted" | "wugi_partner"
  type?: "image" | "video"
  // SafeSearch moderation (issue #170) — only ever set on staged scraped
  // assets (stagedAssets below); trusted sources (venue hero, galleries)
  // never carry it, so the badge only ever shows where it's meaningful.
  moderationStatus?: "clear" | "flagged" | "unscanned"
}
export type SeriesOption = { id: string; name: string; day: string; frequency: string; time: string }
export type CurrentMediaItem = { uri: string; type: "image" | "video"; rightsStatus: "unverified" | "permission_granted" | "wugi_partner" }

export type PublishContext = {
  draft: {
    id: string
    status: "draft" | "published"
    publishedEventId: string | null
    venueId: string
    venueName: string
    dateISO: string | null
    datePickerValue: string
    caption: string
    cleanedTitle: string
    cleanedAbout: string
    sourceAccount: string
    postUrl: string
  }
  venue: { id: string; name: string; lat: number | null; lng: number | null }
  media: { galleryPhotos: MediaOption[]; stagedAssets: MediaOption[]; venueHero: string | null }
  // Only populated when draft.status === "published" — the live event's
  // current media, so the Edit Media picker can preload selection + order.
  currentMedia: CurrentMediaItem[]
  eventSeries: SeriesOption[]
  aiAvailable: boolean
}

// GET /api/draft-events/[id] — everything the Publish modal needs to render
// prefilled: the draft itself (cleaned title/about), the venue's coords +
// hero image, gallery photos for that venue, staged mediaAssets (if the
// companion functions task has landed), and this venue's eventSeries (for
// the "attach as occurrence" picker).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const db = getAdminDb()

  const draftSnap = await db.collection("draftEvents").doc(id).get()
  if (!draftSnap.exists) return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  const draft = draftSnap.data()!
  // "draft" -> the Publish modal; "published" -> the Edit Media modal (same
  // context shape, reused). Any other status (e.g. dismissed_draft) has no
  // picker UI left to serve.
  if (draft.status !== "draft" && draft.status !== "published") {
    return NextResponse.json({ error: `Draft is ${draft.status}` }, { status: 409 })
  }

  const venueId: string = draft.venueId || ""
  const caption: string = draft.caption || ""
  const dateISO: string | null = draft.date?.toDate?.()?.toISOString().slice(0, 10) ?? null

  const publishedEventId: string | null = draft.publishedEventId || null

  const [venueSnap, gallerySnap, mediaAssetSnap, seriesSnap, eventSnap] = await Promise.all([
    venueId ? db.collection("venues").doc(venueId).get() : Promise.resolve(null),
    venueId ? db.collection("eventGalleries").where("venueId", "==", venueId).get() : Promise.resolve(null),
    db.collection("mediaAssets").doc(draft.sourceIntelId || id).get(),
    venueId ? db.collection("eventSeries").where("venueId", "==", venueId).where("status", "==", "active").get() : Promise.resolve(null),
    publishedEventId ? db.collection("events").doc(publishedEventId).get() : Promise.resolve(null),
  ])

  const venueData = venueSnap?.exists ? venueSnap.data()! : null
  const latLng = extractVenueLatLng(venueData?.location)
  const venueMedia = Array.isArray(venueData?.media) ? venueData!.media : []
  const venueHero: string | null = venueMedia[0]?.uri || null

  // Gallery photos: eventGalleries scoped to this venue, approved photos only
  // (mirrors the read rule / the query pattern used by
  // useEventGallery.ts and web/app/gallery/[galleryId]/page.tsx). Capped —
  // this is a picker, not a full browse surface.
  const galleryPhotos: MediaOption[] = []
  if (gallerySnap && !gallerySnap.empty) {
    const galleries = gallerySnap.docs.slice(0, 5)
    const photoSnaps = await Promise.all(
      galleries.map((g) => g.ref.collection("photos").where("approved", "==", true).limit(12).get())
    )
    for (const photos of photoSnaps) {
      for (const p of photos.docs) {
        const url = p.data().url || p.data().thumbUrl
        if (!url) continue
        galleryPhotos.push({ url, thumbUrl: p.data().thumbUrl || url, rightsStatus: "permission_granted" })
        if (galleryPhotos.length >= 24) break
      }
      if (galleryPhotos.length >= 24) break
    }
  }

  // Staged scraped assets — written by functions/src/intel/intelMedia.ts as
  // a typed `assets` array (images and, since the video-capture feature,
  // an optional video paired with its poster), one doc per venueIntel post.
  // Docs from before that deploy only carry the legacy `storagePaths`
  // (images only) — assetEntriesFromMediaDoc reads either shape. Storage
  // objects are deny-all to clients, so we mint short-lived v4 read signed
  // URLs here. The doc may not exist yet, or a path may fail to sign; both
  // degrade to empty/partial results rather than a 500.
  const stagedAssets: MediaOption[] = []
  if (mediaAssetSnap.exists) {
    const mediaData = mediaAssetSnap.data()
    const rightsStatus = normalizeRightsStatus(mediaData?.rightsStatus)
    const entries = assetEntriesFromMediaDoc(mediaData)

    if (entries.length) {
      const signedAssets = await signMediaAssets(entries)
      for (const asset of signedAssets) {
        stagedAssets.push({ url: asset.url, thumbUrl: asset.thumbUrl, rightsStatus, type: asset.type, moderationStatus: asset.moderationStatus })
      }
    }
  }

  const eventSeries: SeriesOption[] = (seriesSnap?.docs || []).map((d) => {
    const s = d.data()
    return { id: d.id, name: s.name || s.title || "Untitled series", day: s.day || "", frequency: s.frequency || "", time: s.time || "" }
  })

  const cleanedTitle = cleanDraftTitle(caption, draft.title || "Untitled event")

  // For the Edit Media flow, resolve each currently-attached uri's rights
  // status by matching it against the picker options already fetched above.
  // A match not found here (e.g. attached from a different post's staged
  // assets than the ones loaded by default) conservatively defaults to
  // "unverified" so the edit route's confirm gate still applies.
  const knownRights = new Map<string, MediaOption["rightsStatus"]>()
  if (venueHero) knownRights.set(venueHero, "wugi_partner")
  for (const opt of galleryPhotos) knownRights.set(opt.url, opt.rightsStatus)
  for (const opt of stagedAssets) knownRights.set(opt.url, opt.rightsStatus)

  const currentMedia: CurrentMediaItem[] = []
  if (eventSnap?.exists) {
    const eventMedia = eventSnap.data()?.media
    if (Array.isArray(eventMedia)) {
      for (const m of eventMedia) {
        if (typeof m?.uri !== "string" || !m.uri) continue
        currentMedia.push({
          uri: m.uri,
          type: m.type === "video" ? "video" : "image",
          rightsStatus: normalizeRightsStatus(knownRights.get(m.uri)),
        })
      }
    }
  }

  const ctx: PublishContext = {
    draft: {
      id,
      status: draft.status === "published" ? "published" : "draft",
      publishedEventId,
      venueId,
      venueName: venueData?.name || draft.venueName || "",
      dateISO,
      datePickerValue: dateISO ? isoToDatePickerString(dateISO) : "",
      caption,
      cleanedTitle,
      cleanedAbout: cleanDraftAbout(caption),
      sourceAccount: draft.sourceAttribution?.account || "",
      postUrl: draft.sourceAttribution?.postUrl || "",
    },
    venue: { id: venueId, name: venueData?.name || draft.venueName || "", lat: latLng?.lat ?? null, lng: latLng?.lng ?? null },
    media: { galleryPhotos, stagedAssets, venueHero },
    currentMedia,
    eventSeries,
    aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
  }

  return NextResponse.json(ctx)
}

// PATCH /api/draft-events/[id] — two actions, discriminated by body shape:
//  - { action: "dismiss" } — dismiss a draft (status: 'dismissed_draft').
//  - { venueId, venueName } — change the draft's venue (see VenuePicker in
//    DraftEventsPanel's PublishModal). Only valid while status === 'draft':
//    once published, the live `events` doc is the source of truth and a
//    draft-only venue change would silently diverge from it, so the
//    dashboard doesn't even render the picker for published drafts — this
//    check is defense in depth against that surface changing later.
// Publishing is a separate, larger write (events + draftEvents together) —
// see ./publish/route.ts, which reads draft.venueId fresh at publish time.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await req.json().catch(() => null)

  const ref = getAdminDb().collection("draftEvents").doc(id)
  const snap = await ref.get()
  if (!snap.exists) return NextResponse.json({ error: "Draft not found" }, { status: 404 })

  if (body?.action === "dismiss") {
    if (snap.data()?.status !== "draft") {
      return NextResponse.json({ error: `Draft is already ${snap.data()?.status}` }, { status: 409 })
    }

    await ref.update({ status: "dismissed_draft", updatedAt: FieldValue.serverTimestamp() })

    await logAuditServer({
      adminId: auth.uid,
      adminEmail: auth.email,
      action: "dismissed_draft_event",
      targetId: id,
      targetName: snap.data()?.title || id,
    })

    return NextResponse.json({ ok: true })
  }

  const venueId = typeof body?.venueId === "string" ? body.venueId.trim() : ""
  const venueName = typeof body?.venueName === "string" ? body.venueName.trim() : ""
  if (venueId && venueName) {
    if (snap.data()?.status !== "draft") {
      return NextResponse.json({ error: "Venue can only be changed on an unpublished draft" }, { status: 409 })
    }

    await ref.update({ venueId, venueName, updatedAt: FieldValue.serverTimestamp() })

    await logAuditServer({
      adminId: auth.uid,
      adminEmail: auth.email,
      action: "changed_draft_event_venue",
      targetId: id,
      targetName: venueName,
    })

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "action must be 'dismiss', or provide venueId + venueName" }, { status: 400 })
}
