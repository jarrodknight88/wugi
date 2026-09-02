import { NextRequest, NextResponse } from "next/server"
import { getAdminDb, getAdminStorage, STORAGE_BUCKET } from "@/lib/firebase-admin"
import { requireVenueWrite } from "@/lib/venueWriteAuth"
import { logAuditServer } from "@/lib/serverAuditLog"

export const dynamic = "force-dynamic"

const ALLOWED_TAGS = ["interior", "crowd", "bar", "exterior", "performance"]

async function loadAsset(venueId: string, assetId: string) {
  const db = getAdminDb()
  const ref = db.collection("venueAssets").doc(assetId)
  const snap = await ref.get()
  if (!snap.exists || snap.data()?.venueId !== venueId) return null
  return { ref, snap }
}

// PATCH /api/venues/[venueId]/asset-pool/[assetId] — approve/unapprove and/or
// retag an evergreen asset (issue #269). approvedBy is stamped with the
// acting staff email on every transition INTO approved:true and left as-is
// on unapprove (keeps "who last approved this" even after a temporary pull).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ venueId: string; assetId: string }> }) {
  const { venueId, assetId } = await params
  const auth = await requireVenueWrite(req, venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const found = await loadAsset(venueId, assetId)
  if (!found) return NextResponse.json({ error: "Asset not found" }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const update: Record<string, unknown> = {}

  if (typeof body.approved === "boolean") {
    update.approved = body.approved
    if (body.approved) {
      update.approvedBy = auth.email || auth.uid
    }
  }

  if (Array.isArray(body.tags)) {
    update.tags = body.tags.filter((t: unknown): t is string => typeof t === "string" && ALLOWED_TAGS.includes(t))
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  }

  await found.ref.update(update)

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: typeof body.approved === "boolean" ? (body.approved ? "approved_venue_asset" : "unapproved_venue_asset") : "updated_venue_asset",
    targetId: assetId,
    targetName: venueId,
  })

  return NextResponse.json({ ok: true })
}

// DELETE /api/venues/[venueId]/asset-pool/[assetId] — removes the pool entry
// and its Storage object. Best-effort on the Storage delete (a missing
// object shouldn't block clearing the Firestore doc — matches the
// tolerant-cleanup pattern used elsewhere in this codebase, e.g.
// publishMedia.ts's copy step).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ venueId: string; assetId: string }> }) {
  const { venueId, assetId } = await params
  const auth = await requireVenueWrite(req, venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const found = await loadAsset(venueId, assetId)
  if (!found) return NextResponse.json({ error: "Asset not found" }, { status: 404 })

  const storagePath = found.snap.data()?.storagePath
  if (typeof storagePath === "string" && storagePath) {
    await getAdminStorage().bucket(STORAGE_BUCKET).file(storagePath).delete().catch(() => {})
  }

  await found.ref.delete()

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: "deleted_venue_asset",
    targetId: assetId,
    targetName: venueId,
  })

  return NextResponse.json({ ok: true })
}
