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
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const status = body?.status
  const clearTransform = body?.clearTransform === true
  if (status !== "approved" && status !== "dismissed") {
    return NextResponse.json({ error: "status must be 'approved' or 'dismissed'" }, { status: 400 })
  }
  if (clearTransform && status !== "approved") {
    return NextResponse.json({ error: "clearTransform is only valid with status 'approved'" }, { status: 400 })
  }

  const ref = getAdminDb().collection("venueIntel").doc(id)
  const snap = await ref.get()
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await ref.update({
    status,
    reviewedAt: FieldValue.serverTimestamp(),
    ...(clearTransform ? { transform: FieldValue.delete() } : {}),
  })

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: clearTransform
      ? "retried_venue_intel_post"
      : status === "approved"
        ? "approved_venue_intel_post"
        : "dismissed_venue_intel_post",
    targetId: id,
    targetName: snap.data()?.sourceAccount || id,
  })

  return NextResponse.json({ ok: true })
}
