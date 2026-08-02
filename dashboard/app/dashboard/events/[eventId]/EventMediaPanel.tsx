"use client"
import { useEffect, useState } from "react"
import { authedFetch, errorMessage } from "@/lib/authedFetch"
import { type SelectedMedia } from "@/lib/mediaSelection"
import type { VenueAssetOption } from "@/lib/venueAssetsForVenue"
import MediaManager from "@/components/MediaManager"

const CARD = { background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: "24px" }

export type EventMediaItem = { uri: string; type: "image" | "video"; path?: string }

// Event Media tab (issue #187) — parity with VenueMediaPanel: (1) the
// event's own currently-selected media, preloaded from the live
// events/{eventId} doc via the `media` prop (page.tsx's onSnapshot listener
// already holds it — no separate context fetch needed) and reorderable via
// MediaManager's SelectedMediaStrip; (2) staged scraped assets for the
// event's venue (GET /api/events/[eventId]/venue-assets, sharing
// lib/venueAssetsForVenue.ts with draft-events' and series' pickers); (3)
// direct upload (POST /api/events/[eventId]/upload, same 60MB image/mp4
// contract as series' upload route, wired through MediaManager's `upload`
// prop). Saving goes through PATCH /api/events/[eventId]/media, which
// materializes any staged signed URL before it's allowed to land in
// Firestore (issue #160) and syncs events.coverImage = media[0]. That write
// flows back through the event page's own onSnapshot listener, so this
// panel never re-fetches after save. Orchestration (selection, lightbox,
// risky-save gate, Saving/Saved/error feedback) lives in MediaManager (issue
// #191) — this file owns only the venue-assets fetch/seed and the media
// PATCH.
export default function EventMediaPanel({ eventId, media, seriesId, canWrite }: {
  eventId: string
  media: EventMediaItem[]
  seriesId: string | null
  canWrite: boolean
}) {
  const [selected, setSelected] = useState<SelectedMedia[]>([])
  const [seeded, setSeeded] = useState(false)
  const [stagedAssets, setStagedAssets] = useState<VenueAssetOption[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    authedFetch(`/api/events/${eventId}/venue-assets`)
      .then((data: { assets: VenueAssetOption[] }) => { if (!cancelled) setStagedAssets(data.assets) })
      .catch((e) => { if (!cancelled) setError(errorMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [eventId])

  // Seed the picker's selection from the event's current media exactly once
  // per event/venue-assets load (not on every Firestore echo — page.tsx's
  // onSnapshot re-fires right after our own PATCH save completes, and
  // re-seeding then would just be a no-op reflection of what we just sent,
  // but re-seeding on every parent render would also clobber in-progress
  // reordering). events.media only ever stores {uri,type,path?} —
  // rightsStatus isn't persisted (materializePublishedMedia's own contract
  // doesn't carry it) — so it's reconstructed by matching against the staged
  // assets just fetched, the same knownRights lookup
  // venues/[venueId]/media/route.ts's GET does, defaulting an unmatched item
  // to "wugi_partner" (not "unverified") since anything already saved
  // already passed a prior confirm gate.
  useEffect(() => {
    if (seeded || stagedAssets === null) return
    const knownRights = new Map<string, VenueAssetOption["rightsStatus"]>()
    const knownRightsByPath = new Map<string, VenueAssetOption["rightsStatus"]>()
    for (const opt of stagedAssets) {
      knownRights.set(opt.url, opt.rightsStatus)
      if (opt.path) knownRightsByPath.set(opt.path, opt.rightsStatus)
    }
    setSelected(
      media.map((m) => ({
        uri: m.uri,
        type: m.type,
        path: m.path,
        rightsStatus: (m.path && knownRightsByPath.get(m.path)) ?? knownRights.get(m.uri) ?? "wugi_partner",
      }))
    )
    setSeeded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedAssets, seeded])

  async function save(selectedMedia: SelectedMedia[], { confirmedRisky }: { confirmedRisky: boolean }) {
    await authedFetch(`/api/events/${eventId}/media`, {
      method: "PATCH",
      body: JSON.stringify({ media: selectedMedia, confirmedUnverifiedRights: confirmedRisky }),
    })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={CARD}>
        {error && <p style={{ fontSize: 13, color: "#ef4444", margin: "0 0 16px" }}>⚠️ {error}</p>}
        <MediaManager
          sections={[{
            title: "Staged scraped assets for this venue",
            options: stagedAssets ?? [],
            emptyText: loading ? "Loading staged assets…" : "No staged assets found for this venue yet.",
          }]}
          value={selected}
          onChange={setSelected}
          onSave={canWrite ? save : undefined}
          upload={{ endpoint: `/api/events/${eventId}/upload`, accept: "image/*,video/mp4" }}
          hint={seriesId ? (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "12px 16px" }}>
              <p style={{ fontSize: 13, color: "#92400e", margin: 0 }}>
                This event belongs to a series — media changes apply to this date only.
              </p>
            </div>
          ) : undefined}
        />
        {!canWrite && <p style={{ fontSize: 13, color: "#9ca3af", marginTop: 12 }}>You don&apos;t have permission to edit event media.</p>}
      </div>
    </div>
  )
}
