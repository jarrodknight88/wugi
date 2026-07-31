import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { logAuditServer } from "@/lib/serverAuditLog"
import { extractVenueLatLng } from "@/lib/venueLatLng"
import { DAY_TO_DOW, dayNameForDateISO, toEventSlug } from "@/lib/draftEventText"
import { tryGenerateSeriesEvents } from "@/lib/generateSeriesEvents"

export const dynamic = "force-dynamic"

type MediaInput = { type?: string; uri?: string; rightsStatus?: string }

// POST /api/draft-events/[id]/publish — the one publish route. Creates the
// consumer-facing `events` doc and marks the draftEvents doc published, in a
// single batch. Three series modes (mirrors the dashboard's existing
// eventSeries + generateSeriesEvents feature — see functions/src/series/
// generateSeriesEvents.ts's buildInstanceDoc — rather than the unrelated
// legacy scraper series-stamping in mobile-app/scripts/scrape/03-transform-
// and-write.js, which this dashboard feature does not use):
//   - "one-off":     no seriesId; isSeriesAnchor:true (singleton default,
//                    same as the scraper pipeline's buildEventDoc).
//   - "attach":      seriesId = an existing eventSeries id; isSeriesAnchor:
//                    false (every generated instance carries false — the
//                    consumer feed computes the anchor at query time).
//   - "new-series":  creates the eventSeries doc (same shape as
//                    series/page.tsx's create path) plus this occurrence as
//                    its first instance, using the SAME deterministic id
//                    convention (`${seriesSlug}-${dateISO}`) the generator
//                    uses, so a later generateSeriesEvents run treats it as
//                    already-created rather than double-booking the date.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const db = getAdminDb()
  const draftRef = db.collection("draftEvents").doc(id)
  const draftSnap = await draftRef.get()
  if (!draftSnap.exists) return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  const draft = draftSnap.data()!
  if (draft.status !== "draft") {
    return NextResponse.json({ error: `Draft is already ${draft.status}` }, { status: 409 })
  }

  const title = String(body.title || "").trim()
  const date = String(body.date || "").trim()
  const time = String(body.time || "").trim()
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 })
  if (!date) return NextResponse.json({ error: "Date is required" }, { status: 400 })
  // Drafts never carry a time (Instagram captions rarely have one) — the
  // publish form leaves it blank so Jarrod must fill it in before it can
  // reach the consumer app.
  if (!time) return NextResponse.json({ error: "Time is required — drafts don't carry a time" }, { status: 400 })

  const about = typeof body.about === "string" ? body.about : ""
  const age = typeof body.age === "string" && body.age ? body.age : "21+"
  const vibes = Array.isArray(body.vibes) ? body.vibes.filter((v: unknown) => typeof v === "string") : []

  const rawMedia: MediaInput[] = Array.isArray(body.media) ? body.media : []
  const hasUnverified = rawMedia.some((m) => m?.rightsStatus === "unverified")
  if (hasUnverified && body.confirmedUnverifiedRights !== true) {
    return NextResponse.json({ error: "Selected media includes unverified rights — confirm before publishing" }, { status: 400 })
  }
  const media = rawMedia
    .filter((m) => typeof m.uri === "string" && m.uri)
    .map((m) => ({ type: m.type === "video" ? "video" : "image", uri: m.uri as string }))

  const venueId: string = draft.venueId || ""
  if (!venueId) return NextResponse.json({ error: "Draft has no matched venue" }, { status: 400 })
  const venueSnap = await db.collection("venues").doc(venueId).get()
  if (!venueSnap.exists) return NextResponse.json({ error: "Venue not found" }, { status: 404 })
  const venueData = venueSnap.data()!
  const venueName: string = venueData.name || draft.venueName || ""
  const latLng = extractVenueLatLng(venueData.location)
  const dateISO: string | null = draft.date?.toDate?.()?.toISOString().slice(0, 10) ?? null

  const seriesMode = body.seriesMode === "attach" || body.seriesMode === "new-series" ? body.seriesMode : "one-off"

  const eventDataBase = {
    title,
    venue: venueName, // legacy mirror, same convention as generateSeriesEvents.ts's buildInstanceDoc
    venueName,
    venueId,
    ...(latLng ? { venueLatitude: latLng.lat, venueLongitude: latLng.lng } : {}),
    date,
    time,
    age,
    about,
    status: "approved", // canonical consumer-visible EventStatus (mobile-app/src/types/firestore-v2.ts)
    vibes,
    media,
    hasTickets: false, // discovery event — decided 7/31
    isFeatured: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const batch = db.batch()
  let eventRef: FirebaseFirestore.DocumentReference
  let seriesId: string | null = null

  if (seriesMode === "attach") {
    const attachSeriesId = String(body.attachSeriesId || "")
    if (!attachSeriesId) return NextResponse.json({ error: "attachSeriesId is required" }, { status: 400 })
    const seriesSnap = await db.collection("eventSeries").doc(attachSeriesId).get()
    if (!seriesSnap.exists) return NextResponse.json({ error: "Series not found" }, { status: 404 })
    if (seriesSnap.data()?.venueId !== venueId) {
      return NextResponse.json({ error: "Series belongs to a different venue" }, { status: 400 })
    }
    seriesId = attachSeriesId
    eventRef = db.collection("events").doc()
    batch.set(eventRef, {
      ...eventDataBase,
      seriesId,
      isSeriesAnchor: false,
      ...(dateISO ? { dateISO } : {}), // keeps generateSeriesEvents.ts's dedupe-by-dateISO correct for this series
    })
  } else if (seriesMode === "new-series") {
    const day = typeof body.newSeries?.day === "string" && body.newSeries.day ? body.newSeries.day : dayNameForDateISO(dateISO || "")
    const frequency = typeof body.newSeries?.frequency === "string" && body.newSeries.frequency ? body.newSeries.frequency : "weekly"
    const seriesRef = db.collection("eventSeries").doc()
    const seriesSlug = toEventSlug(`${title}-${venueName}`)
    seriesId = seriesRef.id
    batch.set(seriesRef, {
      name: title,
      venueId,
      venueName,
      day,
      frequency,
      time,
      age,
      about,
      vibes,
      status: "active",
      coverImage: media[0]?.uri || "",
      startDate: dateISO || "",
      endDate: "",
      promoterId: "",
      title, // generator instance docs read title || name (series/page.tsx save())
      seriesSlug,
      media,
      recurrence: { dayOfWeek: DAY_TO_DOW[day] ?? 5, frequency, timezone: "America/New_York" },
      totalGenerated: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    eventRef = dateISO ? db.collection("events").doc(`${seriesSlug}-${dateISO}`) : db.collection("events").doc()
    batch.set(eventRef, {
      ...eventDataBase,
      seriesId,
      isSeriesAnchor: false, // matches every generateSeriesEvents.ts instance — anchor is computed client-side
      ...(dateISO ? { dateISO } : {}),
    })
  } else {
    eventRef = db.collection("events").doc()
    batch.set(eventRef, { ...eventDataBase, seriesId: null, isSeriesAnchor: true })
  }

  batch.update(draftRef, {
    status: "published",
    publishedEventId: eventRef.id,
    publishedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  await batch.commit()

  let seriesGenerateStatus: "ok" | "failed" | "skipped" | undefined
  if (seriesMode === "new-series" && seriesId) {
    const bearerToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
    seriesGenerateStatus = await tryGenerateSeriesEvents(seriesId, bearerToken)
  }

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: "published_draft_event",
    targetId: eventRef.id,
    targetName: title,
  })

  return NextResponse.json({ eventId: eventRef.id, seriesId, seriesGenerateStatus })
}
