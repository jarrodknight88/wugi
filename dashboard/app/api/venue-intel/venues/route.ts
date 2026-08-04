import { NextRequest, NextResponse } from "next/server"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"

export const dynamic = "force-dynamic"

export type VenueOption = { id: string; name: string; neighborhood: string; status: string; instagram: string }

// GET /api/venue-intel/venues — id + name + neighborhood + status + instagram
// for every venue. venues is ~500 docs, so a single full-collection fetch
// (loaded once and filtered client-side by VenuePicker) is simpler than a
// server-backed search endpoint and cheap enough at this size — no
// pagination/debounce plumbing needed.
export async function GET(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const snap = await getAdminDb().collection("venues").select("name", "neighborhood", "status", "instagram").get()
  const venues: VenueOption[] = snap.docs
    .map((d) => ({
      id: d.id,
      name: d.data().name || "Unnamed",
      neighborhood: d.data().neighborhood || "",
      status: d.data().status || "",
      instagram: d.data().instagram || "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ venues })
}
