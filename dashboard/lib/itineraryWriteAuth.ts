import type { NextRequest } from "next/server"
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"

// Mirrors firestore.rules' isStaff() — super_admin/moderator/support.
const STAFF_ROLES = ["super_admin", "moderator", "support"]

export type ItineraryWriteAuthResult =
  | { ok: true; uid: string; email: string }
  | { ok: false; status: number; error: string }

// requireItineraryWrite — server-side counterpart to firestore.rules'
// `match /itineraries/{itineraryId} { allow write: if isStaff(); }`. Unlike
// eventWriteAuth/venueWriteAuth there's no venue/event scoping to check —
// itineraries are Wugi-editorial content, not venue/event-owned, so any
// staff role can write any itinerary.
export async function requireItineraryWrite(req: NextRequest): Promise<ItineraryWriteAuthResult> {
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

  if (!role || !STAFF_ROLES.includes(role)) {
    return { ok: false, status: 403, error: "You don't have permission to manage itineraries" }
  }

  return { ok: true, uid: decoded.uid, email: decoded.email || data?.email || "" }
}
