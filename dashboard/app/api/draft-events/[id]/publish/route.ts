import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { logAuditServer } from "@/lib/serverAuditLog"
import { extractVenueLatLng } from "@/lib/venueLatLng"
import { DAY_TO_DOW, dayNameForDateISO, toEventSlug } from "@/lib/draftEventText"
import { tryGenerateSeriesEvents } from "@/lib/generateSeriesEvents"
import { findDateClaimConflict } from "@/lib/seriesDateClaim"
import { materializePublishedMedia } from "@/lib/publishMedia"

export const dynamic = "force-dynamic"

type MediaInput = { type?: string; uri?: string; rightsStatus?: string; path?: string; moderationStatus?: string }

// Zips materializePublishedMedia's {uri,type} output back up with each
// input's stable `path` (present only for staged mediaAssets selections —
// see MediaOption.path in ../route.ts). materializePublishedMedia itself
// stays untouched (issue #160's contract) and only ever returns {uri,type};
// `path` is attached here, after the fact, purely so a reload can re-mark
// this item selected in the picker (issue #171) — same order, same length
// as its input, so a positional zip is safe.
function withPath(materialized: { uri: string; type: "image" | "video" }[], source: MediaInput[]) {
  return materialized.map((m, i) => (source[i]?.path ? { ...m, path: source[i].path } : m))
}

// Same explicit-confirm gate as unverified rights (issue #170 scope: "extend
// the existing rightsConfirmed pattern, don't invent a parallel one") — a
// single confirmedUnverifiedRights boolean covers both unverified rights AND
// flagged moderation, so the client only has to gate selection once.
function hasRiskyMedia(media: MediaInput[]): boolean {
  return media.some((m) => m?.rightsStatus === "unverified" || m?.moderationStatus === "flagged")
}

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
//                    `attachMode` ("edition" default, or "typical") decides
//                    whose title/about/age/time/vibes/media the occurrence
//                    gets — the draft's own (edition) or the series
//                    template's (typical, draft is source-attribution only
//                    via draftEvents.publishedEventId).
//   - "new-series":  creates the eventSeries doc (same shape as
//                    series/page.tsx's create path) plus this occurrence as
//                    its first instance, using the SAME deterministic id
//                    convention (`${seriesSlug}-${dateISO}`) the generator
//                    uses, so a later generateSeriesEvents run treats it as
//                    already-created rather than double-booking the date.
//                    `newSeries.editionMode` ("typical" default, or
//                    "special") decides where the SERIES' own name/title/
//                    about/media come from: "typical" seeds the template
//                    from this draft (existing behavior); "special" takes a
//                    separately-collected `newSeries.generic` identity for
//                    the series while the occurrence being published here
//                    keeps this draft's own title/about/media — template
//                    isolation falls out for free since generateSeriesEvents.ts
//                    always reads the series doc's own fields for future
//                    occurrences, never a sibling occurrence's.
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
  if (hasRiskyMedia(rawMedia) && body.confirmedUnverifiedRights !== true) {
    return NextResponse.json({ error: "Selected media includes unverified rights or flagged content — confirm before publishing" }, { status: 400 })
  }
  const filteredMedia = rawMedia.filter((m) => typeof m.uri === "string" && m.uri)
  const media = withPath(
    await materializePublishedMedia(
      filteredMedia.map((m) => ({ type: m.type === "video" ? ("video" as const) : ("image" as const), uri: m.uri as string, rightsStatus: m.rightsStatus }))
    ),
    filteredMedia
  )

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
    const seriesData = seriesSnap.data()!
    if (seriesData.venueId !== venueId) {
      return NextResponse.json({ error: "Series belongs to a different venue" }, { status: 400 })
    }
    seriesId = attachSeriesId

    if (dateISO) {
      const conflictId = await findDateClaimConflict(db, seriesId, dateISO)
      if (conflictId) {
        return NextResponse.json({ error: "This series already has an event on that date" }, { status: 409 })
      }
    }

    // "edition" (default) keeps this draft's own identity — the existing
    // behavior. "typical" adopts the series template's identity instead;
    // the draft is source attribution only (draftEvents.publishedEventId
    // is still the link back to it).
    const attachMode = body.attachMode === "typical" ? "typical" : "edition"
    const templateOverride =
      attachMode === "typical"
        ? {
            title: (typeof seriesData.title === "string" && seriesData.title) || (typeof seriesData.name === "string" && seriesData.name) || title,
            about: typeof seriesData.about === "string" ? seriesData.about : about,
            age: typeof seriesData.age === "string" && seriesData.age ? seriesData.age : age,
            time: typeof seriesData.time === "string" && seriesData.time ? seriesData.time : time,
            vibes: Array.isArray(seriesData.vibes) ? seriesData.vibes : vibes,
            media: Array.isArray(seriesData.media) ? seriesData.media : media,
          }
        : {}

    eventRef = db.collection("events").doc()
    batch.set(eventRef, {
      ...eventDataBase,
      ...templateOverride,
      seriesId,
      isSeriesAnchor: false,
      ...(dateISO ? { dateISO } : {}), // keeps generateSeriesEvents.ts's dedupe-by-dateISO correct for this series
    })
  } else if (seriesMode === "new-series") {
    const day = typeof body.newSeries?.day === "string" && body.newSeries.day ? body.newSeries.day : dayNameForDateISO(dateISO || "")
    const frequency = typeof body.newSeries?.frequency === "string" && body.newSeries.frequency ? body.newSeries.frequency : "weekly"
    // "typical" (default): this draft seeds the series template — existing
    // behavior. "special": this draft is a special edition — it publishes
    // under its own identity (below, eventDataBase is unchanged) while the
    // series gets a separately-collected GENERIC identity so future weeks
    // don't inherit tonight's one-off theme.
    const editionMode = body.newSeries?.editionMode === "special" ? "special" : "typical"

    let seriesName = title
    let seriesTitle = title
    let seriesAbout = about
    let seriesMedia = media

    if (editionMode === "special") {
      const generic = body.newSeries?.generic && typeof body.newSeries.generic === "object" ? body.newSeries.generic : {}
      const genericName = String(generic.name || "").trim()
      if (!genericName) {
        return NextResponse.json({ error: "Series name is required for a special edition" }, { status: 400 })
      }
      const genericTitle = typeof generic.title === "string" && generic.title.trim() ? generic.title.trim() : genericName
      const genericAbout = typeof generic.about === "string" ? generic.about : ""

      const rawGenericMedia: MediaInput[] = Array.isArray(generic.media) ? generic.media : []
      if (hasRiskyMedia(rawGenericMedia) && body.confirmedUnverifiedRights !== true) {
        return NextResponse.json({ error: "Selected media includes unverified rights or flagged content — confirm before publishing" }, { status: 400 })
      }
      const filteredGenericMedia = rawGenericMedia.filter((m) => typeof m.uri === "string" && m.uri)
      const genericMedia = withPath(
        await materializePublishedMedia(
          filteredGenericMedia.map((m) => ({ type: m.type === "video" ? ("video" as const) : ("image" as const), uri: m.uri as string, rightsStatus: m.rightsStatus }))
        ),
        filteredGenericMedia
      )

      seriesName = genericName
      seriesTitle = genericTitle
      seriesAbout = genericAbout
      seriesMedia = genericMedia
    }

    const seriesRef = db.collection("eventSeries").doc()
    const seriesSlug = toEventSlug(`${seriesName}-${venueName}`)
    seriesId = seriesRef.id
    batch.set(seriesRef, {
      name: seriesName,
      venueId,
      venueName,
      day,
      frequency,
      time,
      age,
      about: seriesAbout,
      vibes,
      status: "active",
      coverImage: seriesMedia[0]?.uri || "",
      startDate: dateISO || "",
      endDate: "",
      promoterId: "",
      title: seriesTitle, // generator instance docs read title || name (series/page.tsx save())
      seriesSlug,
      media: seriesMedia,
      recurrence: { dayOfWeek: DAY_TO_DOW[day] ?? 5, frequency, timezone: "America/New_York" },
      totalGenerated: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    // The occurrence being published keeps THIS draft's own title/about/media
    // (eventDataBase, unchanged) — for a typical week that's the same as the
    // series identity above; for a special edition it's deliberately not.
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

  // aiFeedback: append-only dataset for the future tuning loop — if Jarrod's
  // published copy differs from what generation produced, capture the pair
  // (#163 part 3). Fire-and-forget: never let a feedback write fail the
  // publish that already committed above.
  const feedbackEntries: { field: "title" | "about"; generated: string; published: string }[] = []
  const generatedTitle = typeof draft.generatedTitle === "string" ? draft.generatedTitle : ""
  const generatedAbout = typeof draft.generatedAbout === "string" ? draft.generatedAbout : ""
  if (generatedTitle && generatedTitle !== title) feedbackEntries.push({ field: "title", generated: generatedTitle, published: title })
  if (generatedAbout && generatedAbout !== about) feedbackEntries.push({ field: "about", generated: generatedAbout, published: about })
  if (feedbackEntries.length) {
    const sourceCaption = String(draft.caption || "").slice(0, 200)
    Promise.all(
      feedbackEntries.map((entry) =>
        db.collection("aiFeedback").add({
          draftId: id,
          venueId,
          field: entry.field,
          generated: entry.generated,
          published: entry.published,
          sourceCaption,
          at: FieldValue.serverTimestamp(),
        })
      )
    ).catch(() => {
      // Best-effort — see comment above.
    })
  }

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
