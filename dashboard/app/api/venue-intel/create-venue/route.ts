import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { logAuditServer } from "@/lib/serverAuditLog"
import { buildVenueDoc, getPlaceDetails, searchPlacesText, type PlaceSearchResult } from "@/lib/placesImport"

export const dynamic = "force-dynamic"

// GET /api/venue-intel/create-venue?q=<query> — Google Places text search,
// server-side only (the API key must never reach the client). Returns
// lightweight candidates for the "+ New venue" modal's pick list.
export async function GET(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const q = req.nextUrl.searchParams.get("q")?.trim()
  if (!q) return NextResponse.json({ error: "q is required" }, { status: 400 })

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY is not configured" }, { status: 500 })

  let results: PlaceSearchResult[]
  try {
    results = await searchPlacesText(q, apiKey)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Places search failed" }, { status: 502 })
  }

  return NextResponse.json({ results })
}

type CreateVenueBody =
  | { mode: "google"; venueIntelId: string; placeId: string }
  | { mode: "manual"; venueIntelId: string; name: string; neighborhood: string }

// POST /api/venue-intel/create-venue — imports a venue Google-verified
// (mode "google") or creates a minimal manual stub (mode "manual"), then
// auto-assigns the new venueId to the stuck venueIntel doc and fires the
// same retry the VenuePicker uses (approve + clear transform so
// onVenueIntelApproved re-fires — see functions/src/intel/onVenueIntelApproved.ts).
//
// instagramHandle is deliberately NOT taken from the request body — it is
// always the venueIntel doc's own sourceAccount, read server-side, so the
// classifier's handle-matching resolves this exact account going forward
// (see FLOW step 5 in issue #167).
export async function POST(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = (await req.json().catch(() => null)) as CreateVenueBody | null
  if (!body || (body.mode !== "google" && body.mode !== "manual")) {
    return NextResponse.json({ error: "mode must be 'google' or 'manual'" }, { status: 400 })
  }
  if (!body.venueIntelId) return NextResponse.json({ error: "venueIntelId is required" }, { status: 400 })

  const db = getAdminDb()
  const intelRef = db.collection("venueIntel").doc(body.venueIntelId)
  const intelSnap = await intelRef.get()
  if (!intelSnap.exists) return NextResponse.json({ error: "venueIntel post not found" }, { status: 404 })
  const sourceAccount: string = intelSnap.data()?.sourceAccount || ""

  let venueId: string
  let venue: Record<string, unknown>
  let created: boolean

  if (body.mode === "google") {
    if (!body.placeId) return NextResponse.json({ error: "placeId is required" }, { status: 400 })

    const docId = `gp_${body.placeId}`
    const existing = await db.collection("venues").doc(docId).get()

    if (existing.exists) {
      venueId = docId
      venue = existing.data() as Record<string, unknown>
      created = false
    } else {
      const apiKey = process.env.GOOGLE_PLACES_API_KEY
      if (!apiKey) return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY is not configured" }, { status: 500 })

      const place = await getPlaceDetails(body.placeId, apiKey)
      if (!place) return NextResponse.json({ error: "Place not found in Google Places" }, { status: 502 })

      const now = FieldValue.serverTimestamp()
      venue = {
        ...buildVenueDoc(place, sourceAccount, apiKey),
        status: "pending_review",
        createdAt: now,
        updatedAt: now,
      }
      await db.collection("venues").doc(docId).set(venue, { merge: true })
      venueId = docId
      created = true
    }
  } else {
    const name = body.name?.trim()
    const neighborhood = body.neighborhood?.trim()
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })
    if (!neighborhood) return NextResponse.json({ error: "neighborhood is required" }, { status: 400 })

    const normalizedHandle = sourceAccount.trim().replace(/^@/, "")
    const now = FieldValue.serverTimestamp()
    venue = {
      name,
      neighborhood,
      category: "",
      primaryCategory: "Bar",
      address: "",
      phone: "",
      website: "",
      instagram: normalizedHandle ? `@${normalizedHandle}` : "",
      instagramSource: "manual",
      instagramInferred: false,
      about: "",
      media: [],
      heroImage: null,
      vibes: [],
      status: "pending_review",
      needsEnrichment: true,
      isClaimed: false,
      claimedBy: null,
      claimedAt: null,
      isActive: true,
      isFeatured: false,
      market: "atlanta",
      createdAt: now,
      updatedAt: now,
    }
    const ref = await db.collection("venues").add(venue)
    venueId = ref.id
    created = true
  }

  await intelRef.update({
    status: "approved",
    reviewedAt: FieldValue.serverTimestamp(),
    transform: FieldValue.delete(),
    venueId,
    venueName: venue.name,
  })

  if (created) {
    await logAuditServer({
      adminId: auth.uid,
      adminEmail: auth.email,
      action: "created_venue",
      targetId: venueId,
      targetName: String(venue.name || ""),
    })
  }
  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: "assigned_venue_intel_post_venue",
    targetId: body.venueIntelId,
    targetName: sourceAccount || body.venueIntelId,
  })

  return NextResponse.json({ venueId, venueName: venue.name, venue, created })
}
