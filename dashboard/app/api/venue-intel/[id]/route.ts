import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { logAuditServer } from "@/lib/serverAuditLog"

export const dynamic = "force-dynamic"

// PATCH /api/venue-intel/[id] — approve or dismiss a single staged post.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const status = body?.status
  if (status !== "approved" && status !== "dismissed") {
    return NextResponse.json({ error: "status must be 'approved' or 'dismissed'" }, { status: 400 })
  }

  const ref = getAdminDb().collection("venueIntel").doc(id)
  const snap = await ref.get()
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await ref.update({ status, reviewedAt: FieldValue.serverTimestamp() })

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: status === "approved" ? "approved_venue_intel_post" : "dismissed_venue_intel_post",
    targetId: id,
    targetName: snap.data()?.sourceAccount || id,
  })

  return NextResponse.json({ ok: true })
}
