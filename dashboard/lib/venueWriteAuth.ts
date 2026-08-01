import type { NextRequest } from "next/server"
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"

// Mirrors firestore.rules' isStaff() — super_admin/moderator/support.
const STAFF_ROLES = ["super_admin", "moderator", "support"]

export type VenueWriteAuthResult =
  | { ok: true; uid: string; email: string }
  | { ok: false; status: number; error: string }

// requireVenueWrite — the server-side counterpart to firestore.rules'
// canWriteVenue(venueId): isStaff() || (isVenueAdmin() && venueId in
// venueIds()). Deliberately NOT the dashboard client's broader `canWrite`
// flag (context/AuthContext.tsx), which also allows event_admin — venue
// writes are gated on venue-scoped permission only.
export async function requireVenueWrite(req: NextRequest, venueId: string): Promise<VenueWriteAuthResult> {
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
  const data = userSnap.exists ? userSnap.data() : undefined
  const role = data?.role as string | undefined
  const venueIds: string[] = Array.isArray(data?.venueIds) ? data!.venueIds : []

  const canWrite = Boolean(role && STAFF_ROLES.includes(role)) || (role === "venue_admin" && venueIds.includes(venueId))
  if (!canWrite) return { ok: false, status: 403, error: "You don't have permission to edit this venue" }

  return { ok: true, uid: decoded.uid, email: decoded.email || data?.email || "" }
}
