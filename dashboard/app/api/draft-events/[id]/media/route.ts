import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { logAuditServer } from "@/lib/serverAuditLog"

export const dynamic = "force-dynamic"

type MediaInput = { type?: string; uri?: string; rightsStatus?: string }

// PATCH /api/draft-events/[id]/media — edit a PUBLISHED event's media after
// the fact (e.g. reattaching a flyer that was missed at publish time). Same
// media shape + unverified-rights confirm gate as ./publish/route.ts, but
// writes directly to the live events/{publishedEventId} doc instead of
// creating one. draftEvents stays on "published" — this doesn't touch status.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  if (draft.status !== "published" || !draft.publishedEventId) {
    return NextResponse.json({ error: "Draft has not been published" }, { status: 409 })
  }

  const rawMedia: MediaInput[] = Array.isArray(body.media) ? body.media : []
  const hasUnverified = rawMedia.some((m) => m?.rightsStatus === "unverified")
  if (hasUnverified && body.confirmedUnverifiedRights !== true) {
    return NextResponse.json({ error: "Selected media includes unverified rights — confirm before saving" }, { status: 400 })
  }
  const media = rawMedia
    .filter((m) => typeof m.uri === "string" && m.uri)
    .map((m) => ({ type: m.type === "video" ? "video" : "image", uri: m.uri as string }))

  const eventRef = db.collection("events").doc(draft.publishedEventId)
  const eventSnap = await eventRef.get()
  if (!eventSnap.exists) return NextResponse.json({ error: "Published event not found" }, { status: 404 })

  await eventRef.update({ media, updatedAt: FieldValue.serverTimestamp() })

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: "updated_published_event_media",
    targetId: draft.publishedEventId,
    targetName: eventSnap.data()?.title || draft.title || id,
  })

  return NextResponse.json({ ok: true, eventId: draft.publishedEventId })
}
