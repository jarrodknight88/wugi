"use client"
import { useEffect, useState } from "react"
import { authedFetch, errorMessage } from "@/lib/authedFetch"
import type { VenueMediaContext, VenueMediaOption } from "@/app/api/venues/[venueId]/media/route"
import { type SelectedMedia } from "@/lib/mediaSelection"
import MediaManager from "@/components/MediaManager"

const CARD = { background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: "24px" }

// Venue Media tab — surfaces mediaAssets (scraped) + the venue's own
// eventGalleries alongside its currently-selected photos, and persists
// select/order (hero-first) back to venues.media. Orchestration (selection,
// lightbox, risky-save gate, Saving/Saved/error feedback) lives in
// MediaManager (issue #191) — this file owns only the context fetch and the
// venue-media PATCH.
export default function VenueMediaPanel({ venueId, canWrite }: { venueId: string; canWrite: boolean }) {
  const [ctx, setCtx] = useState<VenueMediaContext | null>(null)
  const [selected, setSelected] = useState<SelectedMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    authedFetch(`/api/venues/${venueId}/media`)
      .then((data: VenueMediaContext) => {
        if (cancelled) return
        setCtx(data)
        setSelected(data.currentMedia.map((m) => ({ uri: m.uri, type: m.type, rightsStatus: m.rightsStatus })))
      })
      .catch((e) => { if (!cancelled) setError(errorMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [venueId])

  async function save(media: SelectedMedia[], { confirmedRisky }: { confirmedRisky: boolean }) {
    await authedFetch(`/api/venues/${venueId}/media`, {
      method: "PATCH",
      body: JSON.stringify({ media, confirmedUnverifiedRights: confirmedRisky }),
    })
  }

  if (loading) return <div style={CARD}><p style={{ fontSize: 14, color: "#9ca3af", margin: 0 }}>Loading media…</p></div>
  if (!ctx) return <div style={CARD}><p style={{ fontSize: 14, color: "#ef4444", margin: 0 }}>{error || "Failed to load media."}</p></div>

  const currentOptions: VenueMediaOption[] = ctx.currentMedia.map((m) => ({ url: m.uri, thumbUrl: m.uri, rightsStatus: m.rightsStatus, type: m.type }))

  return (
    <div style={CARD}>
      <MediaManager
        sections={[
          { title: "Current venue photos", options: currentOptions, emptyText: "No photos on file yet." },
          { title: "Venue galleries", options: ctx.media.galleryPhotos, emptyText: "No approved gallery photos for this venue yet." },
          { title: "Staged scraped assets", options: ctx.media.stagedAssets, emptyText: "No staged assets found for this venue yet." },
        ]}
        value={selected}
        onChange={setSelected}
        onSave={canWrite ? save : undefined}
        upload={{ endpoint: `/api/venues/${venueId}/upload`, accept: "image/*,video/mp4" }}
      />
      {!canWrite && <p style={{ fontSize: 13, color: "#9ca3af", marginTop: 12 }}>You don&apos;t have permission to edit venue media.</p>}
    </div>
  )
}
