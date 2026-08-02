import type { NextRequest } from "next/server"
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"

// Mirrors firestore.rules' isStaff() — super_admin/moderator/support.
const STAFF_ROLES = ["super_admin", "moderator", "support"]

export type EventWriteAuthResult =
  | { ok: true; uid: string; email: string }
  | { ok: false; status: number; error: string }

export type EventWriteUser = { role?: string; venueIds?: string[]; eventIds?: string[] }

// canWriteEventForRole — pure mirror of firestore.rules' canWriteEvent(eventId,
// venueId): isStaff() || (isVenueAdmin() && venueId in venueIds()) ||
// (isEventAdmin() && eventId in eventIds()). Kept separate from
// requireEventWrite below so the policy itself is unit-testable without
// mocking the Admin SDK (see scripts/test-event-write-auth.js).
export function canWriteEventForRole(user: EventWriteUser, eventId: string, venueId: string): boolean {
  const { role, venueIds = [], eventIds = [] } = user
  return Boolean(role && STAFF_ROLES.includes(role))
    || (role === "venue_admin" && venueId !== "" && venueIds.includes(venueId))
    || (role === "event_admin" && eventIds.includes(eventId))
}

// requireEventWrite — the server-side counterpart to firestore.rules'
// canWriteEvent(eventId, venueId). Unlike requireVenueWrite (venueWriteAuth.ts),
// this needs BOTH the event's own id (event_admin's per-event eventIds scoping)
// and its venueId (venue_admin's per-venue scoping) — callers look up the
// event doc first via loadEventVenueId below to get venueId before calling
// this, same two-step pattern series/[id]/venue-assets/route.ts uses via
// loadSeriesVenueId.
export async function requireEventWrite(req: NextRequest, eventId: string, venueId: string): Promise<EventWriteAuthResult> {
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
  const eventIds: string[] = Array.isArray(data?.eventIds) ? data!.eventIds : []

  if (!canWriteEventForRole({ role, venueIds, eventIds }, eventId, venueId)) {
    return { ok: false, status: 403, error: "You don't have permission to edit this event" }
  }

  return { ok: true, uid: decoded.uid, email: decoded.email || data?.email || "" }
}

// Every new events/[eventId]/* route needs the event's venueId before it can
// even call requireEventWrite (venue_admin scoping) — centralized here so
// the three route files (venue-assets, upload, media) don't each re-derive it.
export async function loadEventVenueId(eventId: string): Promise<{ exists: boolean; venueId: string; title: string }> {
  const snap = await getAdminDb().collection("events").doc(eventId).get()
  if (!snap.exists) return { exists: false, venueId: "", title: "" }
  const data = snap.data()!
  return { exists: true, venueId: data.venueId || "", title: data.title || "" }
}
