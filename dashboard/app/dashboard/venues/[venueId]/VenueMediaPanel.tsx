"use client"
import { useEffect, useState } from "react"
import { authedFetch, errorMessage } from "@/lib/authedFetch"
import type { VenueMediaContext, VenueMediaOption } from "@/app/api/venues/[venueId]/media/route"

const LABEL = { fontSize: 13, fontWeight: 600, color: "#374151", display: "block" as const, marginBottom: 8 }
const CARD = { background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: "24px" }

const RIGHTS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  unverified: { bg: "#fef3c7", color: "#92400e", label: "Unverified" },
  permission_granted: { bg: "#dcfce7", color: "#15803d", label: "Permission granted" },
  wugi_partner: { bg: "#dcfce7", color: "#15803d", label: "Wugi partner" },
}

type SelectedMedia = { uri: string; type: "image" | "video"; thumbUrl?: string; rightsStatus?: string }

// Small centered play triangle overlay — marks a thumb as a video (the image
// shown is always its poster frame). Same convention as venue-intel's
// DraftEventsPanel.tsx.
function PlayBadge() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 0, height: 0, marginLeft: 2, borderTop: "6px solid transparent", borderBottom: "6px solid transparent", borderLeft: "9px solid #fff" }} />
      </div>
    </div>
  )
}

function Thumb({ src, selected, isVideo, onSelect }: { src: string; selected: boolean; isVideo?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        position: "relative", padding: 0, width: 84, height: 84, flexShrink: 0,
        border: selected ? "3px solid #2a7a5a" : "3px solid transparent",
        borderRadius: 10, overflow: "hidden", cursor: "pointer", background: "#f3f4f6", display: "block",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- signed/gallery/venue URLs, rendered direct */}
      <img src={src} alt="" width={84} height={84} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      {isVideo && <PlayBadge />}
      {selected && (
        <span style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%", background: "#2a7a5a", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>
      )}
    </button>
  )
}

function MediaSection({ title, options, selectedUris, onToggle, emptyText }: {
  title: string
  options: VenueMediaOption[]
  selectedUris: string[]
  onToggle: (opt: VenueMediaOption) => void
  emptyText: string
}) {
  return (
    <div>
      <p style={LABEL}>{title}</p>
      {options.length === 0 ? (
        <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>{emptyText}</p>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {options.map((opt) => (
            <div key={opt.url} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <Thumb src={opt.thumbUrl || opt.url} selected={selectedUris.includes(opt.url)} isVideo={opt.type === "video"} onSelect={() => onToggle(opt)} />
              {opt.rightsStatus && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 10, background: RIGHTS_BADGE[opt.rightsStatus].bg, color: RIGHTS_BADGE[opt.rightsStatus].color }}>
                  {RIGHTS_BADGE[opt.rightsStatus].label}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Rights confirm gate parity with the events picker (venue-intel/
// DraftEventsPanel.tsx's toggleSelectedMedia) — selecting an unverified
// asset requires an explicit confirm() before it's added.
function toggleSelectedMedia(current: SelectedMedia[], opt: VenueMediaOption): SelectedMedia[] {
  const already = current.some((m) => m.uri === opt.url)
  if (already) return current.filter((m) => m.uri !== opt.url)
  if (opt.rightsStatus === "unverified" && !confirm("Rights not verified — use anyway?")) return current
  return [...current, { uri: opt.url, type: opt.type === "video" ? "video" : "image", thumbUrl: opt.thumbUrl, rightsStatus: opt.rightsStatus }]
}

function reorderSelectedMedia(items: SelectedMedia[], from: number, to: number): SelectedMedia[] {
  if (to < 0 || to >= items.length) return items
  const copy = [...items]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

// Selection is an ORDERED list — index 0 is the hero, persisted that way
// into venues.media. Reordering here is the only way to change hero/order.
function SelectedMediaStrip({ items, onMove, onRemove }: { items: SelectedMedia[]; onMove: (from: number, to: number) => void; onRemove: (uri: string) => void }) {
  if (items.length === 0) {
    return <p style={{ fontSize: 13, color: "#9ca3af", margin: 0 }}>No media selected yet — pick photos below. The first selected photo becomes the venue hero.</p>
  }
  return (
    <div>
      <p style={LABEL}>Selected media ({items.length}) — first is the hero</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {items.map((m, i) => (
          <div key={m.uri} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 84 }}>
            <div style={{ position: "relative", width: 84, height: 84, borderRadius: 10, overflow: "hidden", background: "#f3f4f6" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- signed/gallery/venue URLs, rendered direct */}
              <img src={m.thumbUrl || m.uri} alt="" width={84} height={84} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              {m.type === "video" && <PlayBadge />}
              {i === 0 && (
                <span style={{ position: "absolute", top: 4, left: 4, background: "#111827", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 6, letterSpacing: 0.5 }}>HERO</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 3 }}>
              <button type="button" disabled={i === 0} onClick={() => onMove(i, i - 1)} title="Move up" style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.35 : 1, fontSize: 11 }}>↑</button>
              <button type="button" disabled={i === items.length - 1} onClick={() => onMove(i, i + 1)} title="Move down" style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", cursor: i === items.length - 1 ? "default" : "pointer", opacity: i === items.length - 1 ? 0.35 : 1, fontSize: 11 }}>↓</button>
              <button type="button" onClick={() => onRemove(m.uri)} title="Remove" style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", cursor: "pointer", fontSize: 11 }}>✕</button>
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

  function toggle(opt: VenueMediaOption) {
    setSelected((cur) => toggleSelectedMedia(cur, opt))
  }

  async function handleSave() {
    setSaving(true); setError(""); setSaved(false)
    try {
      const hasUnverified = selected.some((m) => m.rightsStatus === "unverified")
      await authedFetch(`/api/venues/${venueId}/media`, {
        method: "PATCH",
        body: JSON.stringify({ media: selected, confirmedUnverifiedRights: hasUnverified }),
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

  const selectedUris = selected.map((m) => m.uri)
  const currentOptions: VenueMediaOption[] = ctx.currentMedia.map((m) => ({ url: m.uri, thumbUrl: m.uri, rightsStatus: m.rightsStatus, type: m.type }))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={CARD}>
        <SelectedMediaStrip
          items={selected}
          onMove={(from, to) => setSelected((cur) => reorderSelectedMedia(cur, from, to))}
          onRemove={(uri) => setSelected((cur) => cur.filter((m) => m.uri !== uri))}
        />
      </div>

      <div style={{ ...CARD, display: "flex", flexDirection: "column", gap: 20 }}>
        <MediaSection title="Current venue photos" options={currentOptions} selectedUris={selectedUris} onToggle={toggle} emptyText="No photos on file yet." />
        <MediaSection title="Venue galleries" options={ctx.media.galleryPhotos} selectedUris={selectedUris} onToggle={toggle} emptyText="No approved gallery photos for this venue yet." />
        <MediaSection title="Staged scraped assets" options={ctx.media.stagedAssets} selectedUris={selectedUris} onToggle={toggle} emptyText="No staged assets found for this venue yet." />
      </div>

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
