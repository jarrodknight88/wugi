import type { NextRequest } from "next/server"
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"

// Mirrors firestore.rules' isStaff() — itineraries writes are Wugi editorial
// staff only (NOT canWriteVenue()-style venue/event scoping — these are not
// venue-owned documents, same as neighborhoodGuides/photographerFeatures).
const STAFF_ROLES = ["super_admin", "moderator", "support"]

export type ItineraryWriteAuthResult =
  | { ok: true; uid: string; email: string }
  | { ok: false; status: number; error: string }

// requireItineraryWrite — the server-side counterpart to firestore.rules'
// `match /itineraries/{itineraryId} { allow write: if isStaff(); }`. Used by
// the hero-image upload route, which needs the Admin SDK (Storage writes
// aren't reachable from the client SDK) — the Firestore doc writes
// themselves go straight through the client SDK from the dashboard page,
// gated by the same isStaff() rule server-side.
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
    return { ok: false, status: 403, error: "You don't have permission to edit itineraries" }
  }

  return { ok: true, uid: decoded.uid, email: decoded.email || data?.email || "" }
}
