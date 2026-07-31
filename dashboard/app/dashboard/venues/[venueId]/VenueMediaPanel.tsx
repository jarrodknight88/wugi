"use client"
import { useEffect, useState } from "react"
import { authedFetch, errorMessage } from "@/lib/authedFetch"
import type { VenueMediaContext, VenueMediaOption, VenueSelectedMedia } from "@/app/api/venues/[venueId]/media/route"

const LABEL: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 8 }
const CARD: React.CSSProperties = { background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: "24px" }

const RIGHTS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  unverified: { bg: "#fef3c7", color: "#92400e", label: "Unverified" },
  permission_granted: { bg: "#dcfce7", color: "#15803d", label: "Permission granted" },
  wugi_partner: { bg: "#dcfce7", color: "#15803d", label: "Wugi partner" },
}

// Every URL rendered here is either a Storage signed URL minted server-side
// (mediaAssets) or a public gallery URL — never a hotlink-blocked external
// CDN URL — so it always renders directly, no proxy. Same convention as
// venue-intel/DraftEventsPanel.tsx's Thumb.
function Thumb({ src, selected, onSelect, onOpen }: { src: string; selected: boolean; onSelect?: () => void; onOpen: () => void }) {
  return (
    <div style={{ position: "relative", width: 84, height: 84, flexShrink: 0 }}>
      <button type="button" onClick={onOpen} style={{
        padding: 0, border: selected ? "3px solid #2a7a5a" : "3px solid transparent",
        borderRadius: 10, overflow: "hidden", cursor: "zoom-in", width: "100%", height: "100%", background: "#f3f4f6", display: "block",
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed/external URLs */}
        <img src={src} alt="" width={84} height={84} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </button>
      {onSelect && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSelect() }}
          aria-label={selected ? "Deselect" : "Select"}
          style={{
            position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%", padding: 0,
            background: selected ? "#2a7a5a" : "rgba(255,255,255,0.85)", color: selected ? "#fff" : "#374151",
            border: selected ? "none" : "1px solid #d1d5db", fontSize: 11, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >{selected ? "✓" : ""}</button>
      )}
    </div>
  )
}

type LightboxState = { options: VenueMediaOption[]; index: number }

function Lightbox({ options, index, onIndexChange, onClose }: { options: VenueMediaOption[]; index: number; onIndexChange: (i: number) => void; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowLeft") onIndexChange((index - 1 + options.length) % options.length)
      else if (e.key === "ArrowRight") onIndexChange((index + 1) % options.length)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [index, options.length, onClose, onIndexChange])

  const opt = options[index]
  if (!opt) return null

  const navBtn = { position: "absolute" as const, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: "50%", width: 44, height: 44, fontSize: 22, cursor: "pointer" }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }} onClick={onClose}>
      <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 20, right: 24, background: "none", border: "none", color: "#fff", fontSize: 30, cursor: "pointer" }}>×</button>
      {options.length > 1 && (
        <button onClick={(e) => { e.stopPropagation(); onIndexChange((index - 1 + options.length) % options.length) }} style={{ ...navBtn, left: 20 }} aria-label="Previous">‹</button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- signed/external URLs */}
      <img src={opt.url} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "88vw", maxHeight: "82vh", objectFit: "contain", borderRadius: 8 }} />
      {options.length > 1 && (
        <button onClick={(e) => { e.stopPropagation(); onIndexChange((index + 1) % options.length) }} style={{ ...navBtn, right: 20 }} aria-label="Next">›</button>
      )}
      <div style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", color: "#fff", fontSize: 13 }}>{index + 1} / {options.length}</div>
    </div>
  )
}

function MediaSection({ title, options, selectedUris, onToggle, onOpen, emptyText }: {
  title: string
  options: VenueMediaOption[]
  selectedUris: string[]
  onToggle?: (opt: VenueMediaOption) => void
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
            <div key={opt.url} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <Thumb src={opt.thumbUrl || opt.url} selected={selectedUris.includes(opt.url)} onSelect={onToggle ? () => onToggle(opt) : undefined} onOpen={() => onOpen(i)} />
              <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 10, background: RIGHTS_BADGE[opt.rightsStatus].bg, color: RIGHTS_BADGE[opt.rightsStatus].color }}>
                {RIGHTS_BADGE[opt.rightsStatus].label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function toggleSelected(current: VenueSelectedMedia[], opt: VenueMediaOption): VenueSelectedMedia[] {
  const already = current.some((m) => m.uri === opt.url)
  if (already) return current.filter((m) => m.uri !== opt.url)
  if (opt.rightsStatus === "unverified" && !confirm("Rights not verified — use anyway?")) return current
  return [...current, { uri: opt.url, rightsStatus: opt.rightsStatus }]
}

function reorderSelected(items: VenueSelectedMedia[], from: number, to: number): VenueSelectedMedia[] {
  if (to < 0 || to >= items.length) return items
  const copy = [...items]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

// Selection is an ORDERED list — index 0 is the hero, persisted that way
// into venues/{venueId}.media. Same hero+order convention as
// venue-intel/DraftEventsPanel.tsx's SelectedMediaStrip.
function SelectedMediaStrip({ items, canWrite, onMove, onRemove }: { items: VenueSelectedMedia[]; canWrite: boolean; onMove: (from: number, to: number) => void; onRemove: (uri: string) => void }) {
  if (items.length === 0) return <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>No media selected yet.</p>
  return (
    <div>
      <p style={LABEL}>Selected media ({items.length}) — first is the hero</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {items.map((m, i) => (
          <div key={m.uri} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 84 }}>
            <div style={{ position: "relative", width: 84, height: 84, borderRadius: 10, overflow: "hidden", background: "#f3f4f6" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- signed/external URLs */}
              <img src={m.uri} alt="" width={84} height={84} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              {i === 0 && (
                <span style={{ position: "absolute", top: 4, left: 4, background: "#111827", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 6, letterSpacing: 0.5 }}>HERO</span>
              )}
            </div>
            {canWrite && (
              <div style={{ display: "flex", gap: 3 }}>
                <button type="button" disabled={i === 0} onClick={() => onMove(i, i - 1)} title="Move up" style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.35 : 1, fontSize: 11 }}>↑</button>
                <button type="button" disabled={i === items.length - 1} onClick={() => onMove(i, i + 1)} title="Move down" style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", cursor: i === items.length - 1 ? "default" : "pointer", opacity: i === items.length - 1 ? 0.35 : 1, fontSize: 11 }}>↓</button>
                <button type="button" onClick={() => onRemove(m.uri)} title="Remove" style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", cursor: "pointer", fontSize: 11 }}>✕</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Venue-scoped equivalent of DraftEventsPanel.tsx's MediaPicker — surfaces
// mediaAssets by venueId + this venue's eventGalleries, with the same
// hero+order strip and unverified-rights confirm parity. No "this post"
// scope toggle (a venue page has no source IG post to scope to).
export default function VenueMediaPanel({ venueId, canWrite }: { venueId: string; canWrite: boolean }) {
  const [ctx, setCtx] = useState<VenueMediaContext | null>(null)
  const [selected, setSelected] = useState<VenueSelectedMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError("")
    authedFetch(`/api/venues/${venueId}/media`)
      .then((data: VenueMediaContext) => {
        if (cancelled) return
        setCtx(data)
        setSelected(data.selected)
      })
      .catch((e) => { if (!cancelled) setError(errorMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [venueId])

  function toggle(opt: VenueMediaOption) {
    setSelected((s) => toggleSelected(s, opt))
  }
  function move(from: number, to: number) {
    setSelected((s) => reorderSelected(s, from, to))
  }
  function remove(uri: string) {
    setSelected((s) => s.filter((m) => m.uri !== uri))
  }

  async function save() {
    setSaving(true); setError(""); setSaved(false)
    try {
      await authedFetch(`/api/venues/${venueId}/media`, {
        method: "PATCH",
        body: JSON.stringify({
          media: selected,
          confirmedUnverifiedRights: selected.some((m) => m.rightsStatus === "unverified"),
        }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) { setError(errorMessage(e)) } finally { setSaving(false) }
  }

  if (loading) return <div style={CARD}><p style={{ color: "#9ca3af", fontSize: 14, margin: 0 }}>Loading media…</p></div>
  if (error && !ctx) return <div style={CARD}><p style={{ color: "#b91c1c", fontSize: 14, margin: 0 }}>⚠️ {error}</p></div>
  if (!ctx) return null

  const selectedUris = selected.map((m) => m.uri)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={CARD}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>Venue Media</h3>
        <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 20px", lineHeight: 1.5 }}>
          Select and order this venue&apos;s photos. The first selected photo is the hero image shown across the app and website.
        </p>

        {error && <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>{error}</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <SelectedMediaStrip items={selected} canWrite={canWrite} onMove={move} onRemove={remove} />
          <MediaSection
            title={`Venue assets (${ctx.stagedAssets.length})`}
            options={ctx.stagedAssets}
            selectedUris={selectedUris}
            onToggle={canWrite ? toggle : undefined}
            onOpen={(i) => setLightbox({ options: ctx.stagedAssets, index: i })}
            emptyText="No staged assets found for this venue yet."
          />
          <MediaSection
            title={`Gallery photos (${ctx.galleryPhotos.length})`}
            options={ctx.galleryPhotos}
            selectedUris={selectedUris}
            onToggle={canWrite ? toggle : undefined}
            onOpen={(i) => setLightbox({ options: ctx.galleryPhotos, index: i })}
            emptyText="No permissioned gallery photos for this venue yet."
          />
        </div>

        {canWrite && (
          <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={save}
              disabled={saving}
              style={{ padding: "10px 24px", borderRadius: 8, background: "#2a7a5a", color: "#fff", border: "none", cursor: saving ? "default" : "pointer", fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Saving…" : saved ? "✓ Saved!" : "Save Media"}
            </button>
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
    </div>
  )
}
