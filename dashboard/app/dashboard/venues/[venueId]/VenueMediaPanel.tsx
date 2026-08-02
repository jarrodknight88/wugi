"use client"
import { useEffect, useState } from "react"
import { authedFetch, errorMessage } from "@/lib/authedFetch"
import type { VenueMediaContext, VenueMediaOption } from "@/app/api/venues/[venueId]/media/route"
import { type SelectedMedia, mediaOptionKey, selectedMediaKey, toggleSelectedMedia, reorderSelectedMedia } from "@/lib/mediaSelection"
import Lightbox from "@/components/Lightbox"
import { MediaThumb, AssetBadges, PlayBadge } from "@/components/MediaThumb"

const LABEL = { fontSize: 13, fontWeight: 600, color: "#374151", display: "block" as const, marginBottom: 8 }
const CARD = { background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: "24px" }

type LightboxState = { options: VenueMediaOption[]; index: number }

function isRisky(m: { rightsStatus?: string; moderationStatus?: string }) {
  return m.rightsStatus === "unverified" || m.moderationStatus === "flagged"
}

function MediaSection({ title, options, selectedKeys, onToggle, onOpen, emptyText }: {
  title: string
  options: VenueMediaOption[]
  selectedKeys: string[]
  onToggle: (opt: VenueMediaOption) => void
  onOpen: (index: number) => void
  emptyText: string
}) {
  return (
    <div>
      <p style={LABEL}>{title}</p>
      {options.length === 0 ? (
        <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>{emptyText}</p>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {options.map((opt, i) => (
            <div key={mediaOptionKey(opt)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <MediaThumb src={opt.thumbUrl || opt.url} selected={selectedKeys.includes(mediaOptionKey(opt))} isVideo={opt.type === "video"} onSelect={() => onToggle(opt)} onOpen={() => onOpen(i)} />
              <AssetBadges opt={opt} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Selection is an ORDERED list — index 0 is the hero, persisted that way
// into venues.media. Reordering here is the only way to change hero/order.
// Rights/moderation badges render here too (issue #181) — with per-click
// confirms gone, this is the only place a risky selection stays visible
// until Save.
function SelectedMediaStrip({ items, onMove, onRemove }: { items: SelectedMedia[]; onMove: (from: number, to: number) => void; onRemove: (key: string) => void }) {
  if (items.length === 0) {
    return <p style={{ fontSize: 13, color: "#9ca3af", margin: 0 }}>No media selected yet — pick photos below. The first selected photo becomes the venue hero.</p>
  }
  return (
    <div>
      <p style={LABEL}>Selected media ({items.length}) — first is the hero</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {items.map((m, i) => (
          <div key={selectedMediaKey(m)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 84 }}>
            <div style={{ position: "relative", width: 84, height: 84, borderRadius: 10, overflow: "hidden", background: "#f3f4f6" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- signed/gallery/venue URLs, rendered direct */}
              <img src={m.thumbUrl || m.uri} alt="" width={84} height={84} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              {m.type === "video" && <PlayBadge />}
              {i === 0 && (
                <span style={{ position: "absolute", top: 4, left: 4, background: "#111827", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 6, letterSpacing: 0.5 }}>HERO</span>
              )}
            </div>
            <AssetBadges opt={m} />
            <div style={{ display: "flex", gap: 3 }}>
              <button type="button" disabled={i === 0} onClick={() => onMove(i, i - 1)} title="Move up" style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.35 : 1, fontSize: 11 }}>↑</button>
              <button type="button" disabled={i === items.length - 1} onClick={() => onMove(i, i + 1)} title="Move down" style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", cursor: i === items.length - 1 ? "default" : "pointer", opacity: i === items.length - 1 ? 0.35 : 1, fontSize: 11 }}>↓</button>
              <button type="button" onClick={() => onRemove(selectedMediaKey(m))} title="Remove" style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", cursor: "pointer", fontSize: 11 }}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Venue Media tab — surfaces mediaAssets (scraped) + the venue's own
// eventGalleries alongside its currently-selected photos, and persists
// select/order (hero-first) back to venues.media. Same picker mechanics as
// the draft-events publish/edit-media pickers (venue-intel/
// DraftEventsPanel.tsx), standalone rather than inside a modal.
export default function VenueMediaPanel({ venueId, canWrite }: { venueId: string; canWrite: boolean }) {
  const [ctx, setCtx] = useState<VenueMediaContext | null>(null)
  const [selected, setSelected] = useState<SelectedMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)

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

  // Selection is free — no per-click confirm (issue #181: on a venue whose
  // staged assets are ALL unverified, a confirm-per-click was a dead-click
  // factory, especially once the browser's "prevent additional dialogs" was
  // checked and confirm() started returning false silently). Risky picks
  // stay visible via AssetBadges and get a single summary confirm at Save.
  function toggle(opt: VenueMediaOption) {
    setSelected((cur) => toggleSelectedMedia(cur, opt))
  }

  async function handleSave() {
    const risky = selected.filter(isRisky)
    if (risky.length > 0 && !confirm(`${risky.length} of ${selected.length} selected items have unverified rights or were flagged — save anyway?`)) {
      return
    }
    setSaving(true); setError(""); setSaved(false)
    try {
      await authedFetch(`/api/venues/${venueId}/media`, {
        method: "PATCH",
        body: JSON.stringify({ media: selected, confirmedUnverifiedRights: risky.length > 0 }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={CARD}><p style={{ fontSize: 14, color: "#9ca3af", margin: 0 }}>Loading media…</p></div>
  if (!ctx) return <div style={CARD}><p style={{ fontSize: 14, color: "#ef4444", margin: 0 }}>{error || "Failed to load media."}</p></div>

  const selectedKeys = selected.map(selectedMediaKey)
  const currentOptions: VenueMediaOption[] = ctx.currentMedia.map((m) => ({ url: m.uri, thumbUrl: m.uri, rightsStatus: m.rightsStatus, type: m.type }))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={CARD}>
        <SelectedMediaStrip
          items={selected}
          onMove={(from, to) => setSelected((cur) => reorderSelectedMedia(cur, from, to))}
          onRemove={(key) => setSelected((cur) => cur.filter((m) => selectedMediaKey(m) !== key))}
        />
      </div>

      <div style={{ ...CARD, display: "flex", flexDirection: "column", gap: 20 }}>
        <MediaSection title="Current venue photos" options={currentOptions} selectedKeys={selectedKeys} onToggle={toggle} onOpen={(i) => setLightbox({ options: currentOptions, index: i })} emptyText="No photos on file yet." />
        <MediaSection title="Venue galleries" options={ctx.media.galleryPhotos} selectedKeys={selectedKeys} onToggle={toggle} onOpen={(i) => setLightbox({ options: ctx.media.galleryPhotos, index: i })} emptyText="No approved gallery photos for this venue yet." />
        <MediaSection title="Staged scraped assets" options={ctx.media.stagedAssets} selectedKeys={selectedKeys} onToggle={toggle} onOpen={(i) => setLightbox({ options: ctx.media.stagedAssets, index: i })} emptyText="No staged assets found for this venue yet." />
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
            onClick={handleSave}
            disabled={saving}
            style={{ padding: "10px 24px", borderRadius: 8, background: "#2a7a5a", color: "#fff", border: "none", cursor: saving ? "default" : "pointer", fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Saving…" : saved ? "✓ Saved!" : "Save Media"}
          </button>
        ) : (
          <p style={{ fontSize: 13, color: "#9ca3af" }}>You don't have permission to edit venue media.</p>
        )}
        {error && <p style={{ fontSize: 13, color: "#ef4444", margin: 0 }}>⚠️ {error}</p>}
      </div>
    </div>
  )
}
