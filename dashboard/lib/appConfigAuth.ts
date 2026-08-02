import type { NextRequest } from "next/server"
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"

// config/appConfig gates app-wide behavior for every installed build
// (forced-update kill switch + imageMode flag) — the strictest tier in the
// requireVenueIntelStaff family, deliberately narrower than that helper's
// ALLOWED_ROLES (which also admits "moderator"). super_admin only, no
// venue/event-scoped carve-outs.
const ALLOWED_ROLES = ["super_admin"]

export type AppConfigAuthResult =
  | { ok: true; uid: string; email: string }
  | { ok: false; status: number; error: string }

export async function requireAppConfigStaff(req: NextRequest): Promise<AppConfigAuthResult> {
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
    return { ok: false, status: 403, error: "Super admin access required" }
  }

  return { ok: true, uid: decoded.uid, email: decoded.email || userSnap.data()?.email || "" }
}
