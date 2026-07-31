import { NextRequest } from "next/server"
import { adminAuth, adminDb } from "./firebase-admin"

// Mirrors the SUPER_ROLES-ish restriction the issue calls for — this
// surface reviews scraped IG content before it can influence venues/,
// so it's scoped tighter than the general dashboard ACL in AuthContext.
const STAFF_ROLES = new Set(["super_admin", "moderator"])

export class UnauthorizedError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function requireStaff(req: NextRequest): Promise<{ uid: string; role: string }> {
  const header = req.headers.get("authorization") || ""
  const token = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!token) throw new UnauthorizedError("Missing Authorization header", 401)

  let decoded
  try {
    decoded = await adminAuth.verifyIdToken(token)
  } catch {
    throw new UnauthorizedError("Invalid or expired session", 401)
  }

  const snap = await adminDb.collection("users").doc(decoded.uid).get()
  const role = snap.exists ? (snap.data()?.role as string | undefined) : undefined
  if (!role || !STAFF_ROLES.has(role)) {
    throw new UnauthorizedError("Staff role required", 403)
  }
  return { uid: decoded.uid, role }
}
