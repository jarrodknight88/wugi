import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireEventWrite, loadEventVenueId } from "@/lib/eventWriteAuth"
import { logAuditServer } from "@/lib/serverAuditLog"
import { materializePublishedMedia } from "@/lib/publishMedia"

export const dynamic = "force-dynamic"

type MediaInput = { type?: string; uri?: string; rightsStatus?: string; path?: string; moderationStatus?: string }

// PATCH /api/events/[eventId]/media — event Media tab parity with
// venues/series/drafts (issue #187): validates, routes staged/signed
// selections through materializePublishedMedia (a signed intel-media/** URL
// persisted straight into Firestore would recreate the #160 dead-media bug
// once its 60-minute signature expires — this is the critical invariant
// every other published-media writer already enforces), writes events.media
// (array order = display order) and syncs events.coverImage = media[0].uri —
// the same hero-first convention venues.heroImage and eventSeries.coverImage
// already follow. A series-generated occurrence's own events.media started
// as a copy of series.media at generation time; saving here only overrides
// this one occurrence, which is expected (see EventMediaPanel's series hint).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const event = await loadEventVenueId(eventId)
  if (!event.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const auth = await requireEventWrite(req, eventId, event.venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const rawMedia: MediaInput[] = Array.isArray(body.media) ? body.media : []
  const hasRisky = rawMedia.some((m) => m?.rightsStatus === "unverified" || m?.moderationStatus === "flagged")
  if (hasRisky && body.confirmedUnverifiedRights !== true) {
    return NextResponse.json({ error: "Selected media includes unverified rights or flagged content — confirm before saving" }, { status: 400 })
  }

  const filteredMedia = rawMedia.filter((m) => typeof m.uri === "string" && m.uri)
  const materialized = await materializePublishedMedia(
    filteredMedia.map((m) => ({ type: m.type === "video" ? ("video" as const) : ("image" as const), uri: m.uri as string, rightsStatus: m.rightsStatus }))
  )
  // path is attached positionally after materialization — present only for
  // staged mediaAssets selections, so a reload can re-mark them selected
  // (same #171 fix draft-events/[id]/media/route.ts applies).
  // materializePublishedMedia's own contract (returns {uri,type}) is untouched.
  const media = materialized.map((m, i) => (filteredMedia[i]?.path ? { ...m, path: filteredMedia[i].path } : m))

  await getAdminDb().collection("events").doc(eventId).update({
    media,
    coverImage: media[0]?.uri || null,
    updatedAt: FieldValue.serverTimestamp(),
  })

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: "updated_event_media",
    targetId: eventId,
    targetName: event.title || eventId,
  })

  return NextResponse.json({ ok: true, media })
}
