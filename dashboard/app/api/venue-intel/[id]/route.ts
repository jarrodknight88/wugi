import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { logAuditServer } from "@/lib/serverAuditLog"

export const dynamic = "force-dynamic"

// PATCH /api/venue-intel/[id] — approve or dismiss a single staged post.
// clearTransform: true is the "Retry" action for the needs_classification
// bucket — it re-approves the post AND deletes the transform field so the
// live onVenueIntelApproved trigger re-fires and re-routes it (the guard in
// that trigger is `if (after.transform?.processedAt) return`).
// venueId/venueName (optional): the Needs Attention "assign venue" picker
// stages a human-picked venue onto the doc before retrying — the trigger's
// classifier treats a pre-set venueId as an override that wins outright
// over its own handle/caption matching (see manualVenueId in
// functions/src/intel/eventTransformRouting.ts).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const status = body?.status
  const clearTransform = body?.clearTransform === true
  const venueId = typeof body?.venueId === "string" && body.venueId ? body.venueId : undefined
  const venueName = typeof body?.venueName === "string" && body.venueName ? body.venueName : undefined
  if (status !== "approved" && status !== "dismissed") {
    return NextResponse.json({ error: "status must be 'approved' or 'dismissed'" }, { status: 400 })
  }
  if (clearTransform && status !== "approved") {
    return NextResponse.json({ error: "clearTransform is only valid with status 'approved'" }, { status: 400 })
  }
  if (venueId && !venueName) {
    return NextResponse.json({ error: "venueName is required alongside venueId" }, { status: 400 })
  }

  const ref = getAdminDb().collection("venueIntel").doc(id)
  const snap = await ref.get()
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await ref.update({
    status,
    reviewedAt: FieldValue.serverTimestamp(),
    ...(clearTransform ? { transform: FieldValue.delete() } : {}),
    ...(venueId ? { venueId, venueName } : {}),
  })

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: venueId
      ? "assigned_venue_intel_post_venue"
      : clearTransform
        ? "retried_venue_intel_post"
        : status === "approved"
          ? "approved_venue_intel_post"
          : "dismissed_venue_intel_post",
    targetId: id,
    targetName: snap.data()?.sourceAccount || id,
  })

  return NextResponse.json({ ok: true })
}
