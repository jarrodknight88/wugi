import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { logAuditServer } from "@/lib/serverAuditLog"

export const dynamic = "force-dynamic"

// POST /api/venue-intel/bulk — two bulk actions, discriminated by body shape:
//  - { sourceAccount, status } — approve/dismiss every pending_review post
//    for one sourceAccount group (the "Approve all" / "Dismiss all" actions
//    on the review queue).
//  - { reason, action: "retry" } — "Retry all" for one classificationReason
//    group in the Needs Attention bucket: re-approves every
//    needs_classification post with that reason and clears its transform
//    field so the live onVenueIntelApproved trigger re-fires for each.
export async function POST(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => null)

  if (body?.action === "retry") {
    const reason = body?.reason
    if (typeof reason !== "string" || !reason) {
      return NextResponse.json({ error: "reason required" }, { status: 400 })
    }

    const snap = await getAdminDb()
      .collection("venueIntel")
      .where("status", "==", "needs_classification")
      .where("classificationReason", "==", reason)
      .get()

    if (snap.empty) return NextResponse.json({ updated: 0 })

    const batch = getAdminDb().batch()
    snap.docs.forEach((d) => {
      batch.update(d.ref, {
        status: "approved",
        reviewedAt: FieldValue.serverTimestamp(),
        transform: FieldValue.delete(),
      })
    })
    await batch.commit()

    await logAuditServer({
      adminId: auth.uid,
      adminEmail: auth.email,
      action: "bulk_retried_venue_intel_posts",
      targetId: reason,
      targetName: `${reason} (${snap.size} posts)`,
    })

    return NextResponse.json({ updated: snap.size })
  }

  const sourceAccount = body?.sourceAccount
  const status = body?.status
  if (typeof sourceAccount !== "string" || !sourceAccount) {
    return NextResponse.json({ error: "sourceAccount required" }, { status: 400 })
  }
  if (status !== "approved" && status !== "dismissed") {
    return NextResponse.json({ error: "status must be 'approved' or 'dismissed'" }, { status: 400 })
  }

  const snap = await getAdminDb()
    .collection("venueIntel")
    .where("status", "==", "pending_review")
    .where("sourceAccount", "==", sourceAccount)
    .get()

  if (snap.empty) return NextResponse.json({ updated: 0 })

  const batch = getAdminDb().batch()
  snap.docs.forEach((d) => {
    batch.update(d.ref, { status, reviewedAt: FieldValue.serverTimestamp() })
  })
  await batch.commit()

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: status === "approved" ? "bulk_approved_venue_intel_posts" : "bulk_dismissed_venue_intel_posts",
    targetId: sourceAccount,
    targetName: `${sourceAccount} (${snap.size} posts)`,
  })

  return NextResponse.json({ updated: snap.size })
}
