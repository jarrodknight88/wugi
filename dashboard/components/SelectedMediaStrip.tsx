"use client"
import { useState } from "react"
import { type SelectedMedia, selectedMediaKey } from "@/lib/mediaSelection"
import { AssetBadges, PlayBadge } from "@/components/MediaThumb"

const TILE = 84

function arrowBtnStyle(disabled: boolean) {
  return { width: 22, height: 22, borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.35 : 1, fontSize: 11 }
}

// Shared selected-media strip (issue #183) — used by VenueMediaPanel,
// DraftEventsPanel's MediaPicker, and SeriesMediaManager. Order IS the save
// payload's order (index 0 = hero/cover), so reordering here is the only way
// to change it. Two reorder paths that both call the same onMove(from, to):
// native HTML5 drag/drop (mouse-only) and the arrow buttons on every tile,
// which are also the only way to reorder on touch devices pre-uplevel.
export default function SelectedMediaStrip({ items, onMove, onRemove, onOpen, label, emptyText, heroLabel = "HERO", disabled }: {
  items: SelectedMedia[]
  onMove: (from: number, to: number) => void
  onRemove: (key: string) => void
  // Optional — when provided, clicking a tile's thumbnail opens it (e.g.
  // SeriesMediaManager's lightbox). Omitted by callers with no zoom affordance
  // on their selected strip (VenueMediaPanel, DraftEventsPanel).
  onOpen?: (index: number) => void
  label?: string
  emptyText?: string
  heroLabel?: string
  disabled?: boolean
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  if (items.length === 0) {
    return emptyText ? <p style={{ fontSize: 13, color: "#9ca3af", margin: 0 }}>{emptyText}</p> : null
  }

  function handleDrop(i: number) {
    if (dragIndex !== null && dragIndex !== i) onMove(dragIndex, i)
    setDragIndex(null)
    setOverIndex(null)
  }

  return (
    <div>
      {label && <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>{label}</p>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {items.map((m, i) => (
          <div
            key={selectedMediaKey(m)}
            draggable={!disabled}
            onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = "move" }}
            onDragEnd={() => { setDragIndex(null); setOverIndex(null) }}
            onDragOver={(e) => { if (dragIndex === null) return; e.preventDefault(); if (overIndex !== i) setOverIndex(i) }}
            onDrop={(e) => { e.preventDefault(); handleDrop(i) }}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: TILE,
              opacity: dragIndex === i ? 0.4 : 1,
              outline: overIndex === i && dragIndex !== null && dragIndex !== i ? "2px dashed #2a7a5a" : "none",
              outlineOffset: 2,
              cursor: disabled ? "default" : "grab",
            }}
          >
            <div
              onClick={onOpen ? () => onOpen(i) : undefined}
              style={{ position: "relative", width: TILE, height: TILE, borderRadius: 10, overflow: "hidden", background: "#f3f4f6", cursor: onOpen ? "zoom-in" : undefined }}
            >
              {m.type === "video" && !m.thumbUrl ? (
                // No poster known (e.g. preloaded from an already-published
                // event's media, which only stores {uri, type} — no
                // posterPath) — the browser renders the video's first frame
                // as a thumbnail without playing it.
                <video src={m.uri} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- signed/gallery/venue URLs, rendered direct
                <img src={m.thumbUrl || m.uri} alt="" width={TILE} height={TILE} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              )}
              {m.type === "video" && <PlayBadge />}
              {i === 0 && (
                <span style={{ position: "absolute", top: 4, left: 4, background: "#111827", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 6, letterSpacing: 0.5 }}>{heroLabel}</span>
              )}
            </div>
            <AssetBadges opt={m} />
            <div style={{ display: "flex", gap: 3 }}>
              <button type="button" disabled={disabled || i === 0} onClick={() => onMove(i, i - 1)} title="Move left" aria-label="Move left" style={arrowBtnStyle(disabled || i === 0)}>←</button>
              <button type="button" disabled={disabled || i === items.length - 1} onClick={() => onMove(i, i + 1)} title="Move right" aria-label="Move right" style={arrowBtnStyle(disabled || i === items.length - 1)}>→</button>
              <button type="button" disabled={disabled} onClick={() => onRemove(selectedMediaKey(m))} title="Remove" aria-label="Remove" style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", cursor: disabled ? "default" : "pointer", fontSize: 11, opacity: disabled ? 0.5 : 1 }}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
