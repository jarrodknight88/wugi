import { NextRequest, NextResponse } from "next/server"
import { admin, adminDb } from "@/lib/firebase-admin"
import { requireStaff, UnauthorizedError } from "@/lib/venueIntelAuth"

const MAX_IDS = 500

export async function POST(req: NextRequest) {
  try {
    await requireStaff(req)
  } catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  const body = await req.json().catch(() => null)
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : []
  const action = body?.action

  if (!ids.length || (action !== "approve" && action !== "dismiss")) {
    return NextResponse.json({ error: "Invalid request — expected { ids: string[], action: 'approve'|'dismiss' }" }, { status: 400 })
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `Too many ids (max ${MAX_IDS})` }, { status: 400 })
  }

  const status = action === "approve" ? "approved" : "dismissed"
  const col = adminDb.collection("venueIntel")
  const batch = adminDb.batch()
  ids.forEach((id: string) => {
    batch.update(col.doc(id), { status, reviewedAt: admin.firestore.FieldValue.serverTimestamp() })
  })
  await batch.commit()

  return NextResponse.json({ updated: ids.length, status })
}
