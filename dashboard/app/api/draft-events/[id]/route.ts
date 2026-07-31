import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb, getAdminStorage, STORAGE_BUCKET } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { logAuditServer } from "@/lib/serverAuditLog"
import { extractVenueLatLng } from "@/lib/venueLatLng"
import { cleanDraftTitle, cleanDraftAbout, isoToDatePickerString } from "@/lib/draftEventText"

export const dynamic = "force-dynamic"

export type MediaOption = { url: string; thumbUrl: string; rightsStatus?: "unverified" | "permission_granted" | "wugi_partner" }
export type SeriesOption = { id: string; name: string; day: string; frequency: string; time: string }

export type PublishContext = {
  draft: {
    id: string
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
  if (draft.status !== "draft") {
    return NextResponse.json({ error: `Draft is already ${draft.status}` }, { status: 409 })
  }

  const venueId: string = draft.venueId || ""
  const caption: string = draft.caption || ""
  const dateISO: string | null = draft.date?.toDate?.()?.toISOString().slice(0, 10) ?? null

  const [venueSnap, gallerySnap, mediaAssetSnap, seriesSnap] = await Promise.all([
    venueId ? db.collection("venues").doc(venueId).get() : Promise.resolve(null),
    venueId ? db.collection("eventGalleries").where("venueId", "==", venueId).get() : Promise.resolve(null),
    db.collection("mediaAssets").doc(draft.sourceIntelId || id).get(),
    venueId ? db.collection("eventSeries").where("venueId", "==", venueId).where("status", "==", "active").get() : Promise.resolve(null),
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
  // { storagePaths: string[], rightsStatus }, one doc per venueIntel post.
  // Storage objects are deny-all to clients, so we mint short-lived v4 read
  // signed URLs here. The doc may not exist yet, or a path may fail to
  // sign; both degrade to empty/partial results rather than a 500.
  const stagedAssets: MediaOption[] = []
  if (mediaAssetSnap.exists) {
    const mediaData = mediaAssetSnap.data()
    const storagePaths = mediaData?.storagePaths
    const rightsStatus: MediaOption["rightsStatus"] =
      mediaData?.rightsStatus === "permission_granted" || mediaData?.rightsStatus === "wugi_partner"
        ? mediaData.rightsStatus
        : "unverified"

    if (Array.isArray(storagePaths) && storagePaths.length) {
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
            console.warn(`draft-events/[id]: signed URL failed for ${storagePath}`, err)
            return null
          }
        })
      )
      for (const url of signedUrls) {
        if (url) stagedAssets.push({ url, thumbUrl: url, rightsStatus })
      }
    }
  }

  const eventSeries: SeriesOption[] = (seriesSnap?.docs || []).map((d) => {
    const s = d.data()
    return { id: d.id, name: s.name || s.title || "Untitled series", day: s.day || "", frequency: s.frequency || "", time: s.time || "" }
  })

  const cleanedTitle = cleanDraftTitle(caption, draft.title || "Untitled event")

  const ctx: PublishContext = {
    draft: {
      id,
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
    eventSeries,
    aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
  }

  return NextResponse.json(ctx)
}

// PATCH /api/draft-events/[id] — dismiss a draft (status: 'dismissed_draft').
// Publishing is a separate, larger write (events + draftEvents together) —
// see ./publish/route.ts.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (body?.action !== "dismiss") {
    return NextResponse.json({ error: "action must be 'dismiss'" }, { status: 400 })
  }

  const ref = getAdminDb().collection("draftEvents").doc(id)
  const snap = await ref.get()
  if (!snap.exists) return NextResponse.json({ error: "Draft not found" }, { status: 404 })
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
