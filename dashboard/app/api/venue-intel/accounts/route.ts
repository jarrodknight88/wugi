import { NextRequest, NextResponse } from "next/server"
import { admin, adminDb } from "@/lib/firebase-admin"
import { requireStaff, UnauthorizedError } from "@/lib/venueIntelAuth"

export async function POST(req: NextRequest) {
  try {
    await requireStaff(req)
  } catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  const body = await req.json().catch(() => null)
  const handle = typeof body?.handle === "string" ? body.handle.trim() : ""
  const action = body?.action

  if (!handle || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "Invalid request — expected { handle: string, action: 'approve'|'reject' }" }, { status: 400 })
  }

  const status = action === "approve" ? "approved" : "rejected"
  await adminDb.collection("venueIntelAccounts").doc(handle).set(
    { handle, status, decidedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  )

  return NextResponse.json({ handle, status })
}
