import type { NextRequest } from "next/server"
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"

// venueIntel is Wugi-internal only — deliberately narrower than the
// dashboard's general SUPER_ROLES (which also includes "support").
const ALLOWED_ROLES = ["super_admin", "moderator"]

export type StaffAuthResult =
  | { ok: true; uid: string; email: string }
  | { ok: false; status: number; error: string }

export async function requireVenueIntelStaff(req: NextRequest): Promise<StaffAuthResult> {
  const header = req.headers.get("authorization") || ""
  const token = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!token) return { ok: false, status: 401, error: "Missing bearer token" }

  let decoded
  try {
    decoded = await getAdminAuth().verifyIdToken(token)
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired token" }
  }

  const userSnap = await getAdminDb().collection("users").doc(decoded.uid).get()
  const role = userSnap.exists ? (userSnap.data()?.role as string | undefined) : undefined
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return { ok: false, status: 403, error: "Staff access required (super_admin or moderator)" }
  }

  return { ok: true, uid: decoded.uid, email: decoded.email || userSnap.data()?.email || "" }
}
