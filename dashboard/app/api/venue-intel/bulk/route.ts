import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { logAuditServer } from "@/lib/serverAuditLog"

export const dynamic = "force-dynamic"

// POST /api/venue-intel/bulk — approve/dismiss every currently pending
// post for one sourceAccount group (the "Approve all" / "Dismiss all"
// bulk actions on the review queue).
export async function POST(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => null)
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
