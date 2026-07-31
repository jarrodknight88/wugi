import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { logAuditServer } from "@/lib/serverAuditLog"
import { findDateClaimConflict } from "@/lib/seriesDateClaim"

export const dynamic = "force-dynamic"

// POST /api/draft-events/[id]/attach-series — retrofit a PUBLISHED event
// (one that went live before its series existed, e.g. a special edition
// published as "one-off" before "New series" was an option) onto an
// eventSeries as that date's edition. Same "edition claims its date"
// semantics as ../publish/route.ts's "attach" mode's default (edition)
// behavior, just applied after the fact — the event keeps its own title/
// about/media untouched. draftEvents stays "published"; only
// events/{publishedEventId}.seriesId (+isSeriesAnchor) changes.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const seriesId = typeof body?.seriesId === "string" ? body.seriesId : ""
  if (!seriesId) return NextResponse.json({ error: "seriesId is required" }, { status: 400 })

  const db = getAdminDb()
  const draftRef = db.collection("draftEvents").doc(id)
  const draftSnap = await draftRef.get()
  if (!draftSnap.exists) return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  const draft = draftSnap.data()!
  if (draft.status !== "published" || !draft.publishedEventId) {
    return NextResponse.json({ error: "Draft has not been published" }, { status: 409 })
  }

  const eventRef = db.collection("events").doc(draft.publishedEventId)
  const eventSnap = await eventRef.get()
  if (!eventSnap.exists) return NextResponse.json({ error: "Published event not found" }, { status: 404 })
  const eventData = eventSnap.data()!
  if (eventData.seriesId) {
    return NextResponse.json({ error: "Event is already attached to a series" }, { status: 409 })
  }

  const seriesSnap = await db.collection("eventSeries").doc(seriesId).get()
  if (!seriesSnap.exists) return NextResponse.json({ error: "Series not found" }, { status: 404 })
  if (seriesSnap.data()?.venueId !== eventData.venueId) {
    return NextResponse.json({ error: "Series belongs to a different venue" }, { status: 400 })
  }

  const dateISO: string | undefined = typeof eventData.dateISO === "string" ? eventData.dateISO : undefined
  if (!dateISO) {
    return NextResponse.json({ error: "Event has no dateISO on file — cannot verify the date-claim rule" }, { status: 400 })
  }
  const conflictId = await findDateClaimConflict(db, seriesId, dateISO)
  if (conflictId) {
    return NextResponse.json({ error: "This series already has an event on that date" }, { status: 409 })
  }

  await eventRef.update({
    seriesId,
    isSeriesAnchor: false, // matches every generateSeriesEvents.ts instance — anchor is computed client-side
    updatedAt: FieldValue.serverTimestamp(),
  })

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: "attached_published_event_to_series",
    targetId: draft.publishedEventId,
    targetName: eventData.title || draft.title || id,
  })

  return NextResponse.json({ ok: true, eventId: draft.publishedEventId, seriesId })
}
