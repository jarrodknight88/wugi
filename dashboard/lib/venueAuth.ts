import type { NextRequest } from "next/server"
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"

// Server-side counterpart to AuthContext.tsx's `canWrite` for venue-scoped
// routes — super/moderator/support write everything, venue_admin only their
// assigned venues (profile.venueIds). Deliberately excludes event_admin
// (client-side canWrite includes it for historical reasons, but nothing
// event-scoped should be writing venue docs).
const SUPER_ROLES = ["super_admin", "moderator", "support"]

export type VenueAuthResult =
  | { ok: true; uid: string; email: string }
  | { ok: false; status: number; error: string }

export async function requireVenueWrite(req: NextRequest, venueId: string): Promise<VenueAuthResult> {
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

  const allowed = Boolean(role) && (SUPER_ROLES.includes(role!) || (role === "venue_admin" && venueIds.includes(venueId)))
  if (!allowed) return { ok: false, status: 403, error: "You don't have write access to this venue" }

  return { ok: true, uid: decoded.uid, email: decoded.email || data?.email || "" }
}
