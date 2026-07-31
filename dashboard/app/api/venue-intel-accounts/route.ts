import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { logAuditServer } from "@/lib/serverAuditLog"

export const dynamic = "force-dynamic"

// Known Apify seed accounts — v1 hardcode per issue #127. When this list
// changes, update it here (PM reads approved candidates from
// venueIntelAccounts to decide seed-list additions; no automation yet).
const SEED_ACCOUNTS = new Set([
  "officialopiumatlanta", "revelatlanta", "tabuatlanta", "teranga.atl",
  "babaskitchenatl", "midtownsocialatl", "districtatlanta", "domaineatl",
  "rocksteadyatlanta", "bambooatlanta", "vibesatl", "atlpics", "chuckyfoto",
  "embrloungeatlanta", "lokeeatl",
])

export const ACCOUNT_TYPES = ["venue", "promoter", "photographer", "dj_artist", "staff"] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export type DiscoveredAccount = {
  handle: string
  count: number
  sampleCaption: string
}

// GET /api/venue-intel-accounts — distinct sourceAccounts present in
// venueIntel that aren't in the seed list and haven't already been
// decided (no venueIntelAccounts/{handle} doc yet).
export async function GET(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const [venueIntelSnap, decidedSnap] = await Promise.all([
    getAdminDb().collection("venueIntel").select("sourceAccount", "caption").get(),
    getAdminDb().collection("venueIntelAccounts").get(),
  ])

  const decidedHandles = new Set(decidedSnap.docs.map((d) => d.id))

  const candidates = new Map<string, DiscoveredAccount>()
  for (const d of venueIntelSnap.docs) {
    const data = d.data()
    const handle = (data.sourceAccount || "").trim()
    if (!handle || SEED_ACCOUNTS.has(handle) || decidedHandles.has(handle)) continue

    const existing = candidates.get(handle)
    if (existing) {
      existing.count += 1
      if (!existing.sampleCaption && data.caption) existing.sampleCaption = data.caption
    } else {
      candidates.set(handle, { handle, count: 1, sampleCaption: data.caption || "" })
    }
  }

  const list = Array.from(candidates.values()).sort((a, b) => b.count - a.count)

  return NextResponse.json({ candidates: list, accountTypes: ACCOUNT_TYPES })
}

// POST /api/venue-intel-accounts — approve/reject a discovered-account
// candidate. Approving requires accountType (scope addition from Jarrod,
// 2026-07-31); rejecting does not.
export async function POST(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => null)
  const handle = body?.handle
  const status = body?.status
  const accountType = body?.accountType

  if (typeof handle !== "string" || !handle.trim()) {
    return NextResponse.json({ error: "handle required" }, { status: 400 })
  }
  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json({ error: "status must be 'approved' or 'rejected'" }, { status: 400 })
  }
  if (status === "approved" && !ACCOUNT_TYPES.includes(accountType)) {
    return NextResponse.json(
      { error: "accountType is required when approving (venue | promoter | photographer | dj_artist | staff)" },
      { status: 400 }
    )
  }

  const doc: Record<string, unknown> = {
    handle,
    status,
    decidedAt: FieldValue.serverTimestamp(),
  }
  if (status === "approved") doc.accountType = accountType

  await getAdminDb().collection("venueIntelAccounts").doc(handle).set(doc)

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: status === "approved" ? "approved_venue_intel_account" : "rejected_venue_intel_account",
    targetId: handle,
    targetName: status === "approved" ? `${handle} (${accountType})` : handle,
  })

  return NextResponse.json({ ok: true })
}
