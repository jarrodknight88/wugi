import { auth } from "@/lib/firebase"

// Shared by the venue-intel + draft-events panels — both call admin-gated
// API routes (getAdminAuth().verifyIdToken) that need the caller's Firebase
// ID token as a bearer header.
export async function authedFetch(path: string, init?: RequestInit) {
  const token = await auth.currentUser?.getIdToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || `Request failed (${res.status})`)
  }
  return res.json()
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}
