"use client"
import { useEffect, useState } from "react"
import { auth } from "@/lib/firebase"
import { authedFetch, errorMessage } from "@/lib/authedFetch"
import { type SelectedMedia, mediaOptionKey, selectedMediaKey, toggleSelectedMedia, reorderSelectedMedia } from "@/lib/mediaSelection"
import type { VenueAssetOption } from "@/lib/venueAssetsForVenue"
import Lightbox from "@/components/Lightbox"
import { MediaThumb, AssetBadges } from "@/components/MediaThumb"
import SelectedMediaStrip from "@/components/SelectedMediaStrip"
import ConfirmDialog from "@/components/ConfirmDialog"

const LABEL = { fontSize: 13, fontWeight: 600, color: "#374151", display: "block" as const, marginBottom: 8 }
const CARD = { background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: "24px" }
const PILL = { padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb" }

export type EventMediaItem = { uri: string; type: "image" | "video"; path?: string }
type LightboxState = { options: { url: string; thumbUrl?: string; type?: "image" | "video" }[]; index: number }

function isRisky(m: { rightsStatus?: string; moderationStatus?: string }) {
  return m.rightsStatus === "unverified" || m.moderationStatus === "flagged"
}

// Event Media tab (issue #187) — parity with VenueMediaPanel/SeriesMediaManager:
// (1) the event's own currently-selected media, preloaded from the live
// events/{eventId} doc via the `media` prop (page.tsx's onSnapshot listener
// already holds it — no separate context fetch needed) and reorderable via
// the shared SelectedMediaStrip; (2) staged scraped assets for the event's
// venue (GET /api/events/[eventId]/venue-assets, sharing
// lib/venueAssetsForVenue.ts with draft-events' and series' pickers); (3)
// direct upload (POST /api/events/[eventId]/upload, same 60MB image/mp4
// contract as series' upload route). Saving goes through
// PATCH /api/events/[eventId]/media, which materializes any staged signed
// URL before it's allowed to land in Firestore (issue #160) and syncs
// events.coverImage = media[0]. That write flows back through the event
// page's own onSnapshot listener, so this panel never re-fetches after save.
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
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null)

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

  // Selection is free — no per-click confirm (issue #181/#183: a
  // confirm-per-click was a dead-click factory, especially once Chrome's
  // "prevent additional dialogs" latch was tripped). Risky picks stay
  // visible via AssetBadges and get a single summary confirm at Save.
  function toggle(opt: VenueAssetOption) {
    setSelected((cur) => toggleSelectedMedia(cur, opt))
  }

  function handleSaveClick() {
    const risky = selected.filter(isRisky)
    if (risky.length > 0) {
      setConfirmMessage(`${risky.length} of ${selected.length} selected items have unverified rights or were flagged — save anyway?`)
      return
    }
    doSave()
  }

  async function doSave() {
    setSaving(true); setError(""); setSaved(false)
    try {
      await authedFetch(`/api/events/${eventId}/media`, {
        method: "PATCH",
        body: JSON.stringify({ media: selected, confirmedUnverifiedRights: selected.some(isRisky) }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  // Bypasses authedFetch — it force-sets Content-Type: application/json
  // whenever a body is present, which would corrupt the multipart boundary
  // FormData needs (same as SeriesMediaManager.tsx's handleUpload).
  async function handleUpload(file: File) {
    setUploading(true); setError("")
    try {
      const token = await auth.currentUser?.getIdToken()
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(`/api/events/${eventId}/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Upload failed (${res.status})`)
      }
      const data = await res.json()
      setSelected((cur) => [...cur, { uri: data.url, type: data.type, rightsStatus: data.rightsStatus }])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  const selectedKeys = selected.map(selectedMediaKey)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {seriesId && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "12px 16px" }}>
          <p style={{ fontSize: 13, color: "#92400e", margin: 0 }}>
            This event belongs to a series — media changes apply to this date only.
          </p>
        </div>
      )}

      <div style={CARD}>
        <SelectedMediaStrip
          items={selected}
          onMove={(from, to) => setSelected((cur) => reorderSelectedMedia(cur, from, to))}
          onRemove={(key) => setSelected((cur) => cur.filter((m) => selectedMediaKey(m) !== key))}
          onOpen={(i) => setLightbox({ options: selected.map((m) => ({ url: m.uri, thumbUrl: m.thumbUrl, type: m.type })), index: i })}
          label={`Selected media (${selected.length}) — first is the hero`}
          emptyText="No media selected yet — pick from staged assets below or upload a file. The first selected item becomes the hero."
          disabled={saving}
        />
      </div>

      <div style={{ ...CARD, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <p style={{ ...LABEL, marginBottom: 0 }}>Staged scraped assets for this venue</p>
          <label style={{ ...PILL, opacity: uploading ? 0.6 : 1 }}>
            {uploading ? "Uploading…" : "+ Upload file"}
            <input type="file" accept="image/*,video/mp4" style={{ display: "none" }} disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = "" }} />
          </label>
        </div>
        {loading ? (
          <p style={{ fontSize: 13, color: "#9ca3af", margin: 0 }}>Loading staged assets…</p>
        ) : !stagedAssets || stagedAssets.length === 0 ? (
          <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>No staged assets found for this venue yet.</p>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {stagedAssets.map((opt, i) => (
              <div key={mediaOptionKey(opt)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <MediaThumb src={opt.thumbUrl || opt.url} selected={selectedKeys.includes(mediaOptionKey(opt))} isVideo={opt.type === "video"} onSelect={() => toggle(opt)} onOpen={() => setLightbox({ options: stagedAssets, index: i })} />
                <AssetBadges opt={opt} />
              </div>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <Lightbox
          options={lightbox.options}
          index={lightbox.index}
          onIndexChange={(i) => setLightbox((lb) => (lb ? { ...lb, index: i } : lb))}
          onClose={() => setLightbox(null)}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {canWrite ? (
          <button
            onClick={handleSaveClick}
            disabled={saving}
            style={{ padding: "10px 24px", borderRadius: 8, background: "#2a7a5a", color: "#fff", border: "none", cursor: saving ? "default" : "pointer", fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Saving…" : saved ? "✓ Saved!" : "Save Media"}
          </button>
        ) : (
          <p style={{ fontSize: 13, color: "#9ca3af" }}>You don&apos;t have permission to edit event media.</p>
        )}
        {error && <p style={{ fontSize: 13, color: "#ef4444", margin: 0 }}>⚠️ {error}</p>}
      </div>

      {confirmMessage && (
        <ConfirmDialog
          message={confirmMessage}
          confirmLabel="Save anyway"
          onConfirm={() => { setConfirmMessage(null); doSave() }}
          onCancel={() => setConfirmMessage(null)}
        />
      )}
    </div>
  )
}
