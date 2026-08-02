import { NextRequest, NextResponse } from "next/server"
import { requireEventWrite, loadEventVenueId } from "@/lib/eventWriteAuth"
import { venueAssetsForVenue } from "@/lib/venueAssetsForVenue"

export const dynamic = "force-dynamic"

// GET /api/events/[eventId]/venue-assets — the event Media tab's "select
// from scraped" browser (issue #187): every mediaAssets doc staged for this
// event's venue, same query+signing as draft-events' and series' venue-assets
// routes (shared via lib/venueAssetsForVenue.ts). Gated by requireEventWrite
// (staff / venue_admin scoped to the event's venue / event_admin scoped to
// this event), the same tier series' venue-assets route uses via
// requireVenueWrite — event media editing is venue/event-admin territory,
// not venue-intel-staff-only like drafts.
export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const event = await loadEventVenueId(eventId)
  if (!event.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const auth = await requireEventWrite(req, eventId, event.venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!event.venueId) return NextResponse.json({ assets: [] })

  const assets = await venueAssetsForVenue(event.venueId)
  return NextResponse.json({ assets })
}
