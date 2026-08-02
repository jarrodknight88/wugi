"use client"

// Shared select+zoom thumb for media pickers (issue #181) — extracted from
// venue-intel/DraftEventsPanel.tsx, the original home of this interaction
// pattern (separate select toggle vs. open-zoom affordance) and its rights/
// moderation badge rendering. Used by DraftEventsPanel.tsx and
// venues/[venueId]/VenueMediaPanel.tsx, which share an identical badge
// vocabulary. SeriesMediaManager.tsx keeps its own Thumb — its browse-modal
// variant is select-only (no zoom) and carries an extra `owner_upload`
// rights label that doesn't apply to staged-asset pickers, so folding it in
// here would change its behavior rather than just move code.

const RIGHTS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  unverified: { bg: "#fef3c7", color: "#92400e", label: "Unverified" },
  permission_granted: { bg: "#dcfce7", color: "#15803d", label: "Permission granted" },
  wugi_partner: { bg: "#dcfce7", color: "#15803d", label: "Wugi partner" },
}

// SafeSearch moderation (issue #170) — 'clear' intentionally has no badge
// entry; only flagged/unscanned assets render one, next to the rights badge.
const MODERATION_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  flagged: { bg: "#fee2e2", color: "#b91c1c", label: "⚠ Flagged" },
  unscanned: { bg: "#f3f4f6", color: "#6b7280", label: "Unscanned" },
}

// Small centered play triangle overlay — marks a thumb as a video (the image
// shown is always its poster frame, never the video itself).
export function PlayBadge() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 0, height: 0, marginLeft: 2, borderTop: "6px solid transparent", borderBottom: "6px solid transparent", borderLeft: "9px solid #fff" }} />
      </div>
    </div>
  )
}

// Rights badge (if any) plus a moderation badge (issue #170), only rendered
// for flagged/unscanned — a 'clear' result has nothing worth flagging.
export function AssetBadges({ opt }: { opt: { rightsStatus?: string; moderationStatus?: string } }) {
  return (
    <>
      {opt.rightsStatus && RIGHTS_BADGE[opt.rightsStatus] && (
        <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 10, background: RIGHTS_BADGE[opt.rightsStatus].bg, color: RIGHTS_BADGE[opt.rightsStatus].color }}>
          {RIGHTS_BADGE[opt.rightsStatus].label}
        </span>
      )}
      {opt.moderationStatus && opt.moderationStatus !== "clear" && MODERATION_BADGE[opt.moderationStatus] && (
        <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 10, background: MODERATION_BADGE[opt.moderationStatus].bg, color: MODERATION_BADGE[opt.moderationStatus].color }}>
          {MODERATION_BADGE[opt.moderationStatus].label}
        </span>
      )}
    </>
  )
}

// `src` is always an image (for a video option this is the signed/known
// poster URL, never the mp4 itself). The main button opens the lightbox
// (cursor: zoom-in); the small circular overlay button is the only way to
// toggle selection, so a click never does both at once.
export function MediaThumb({ src, selected, isVideo, onSelect, onOpen }: {
  src: string
  selected: boolean
  isVideo?: boolean
  onSelect: () => void
  onOpen: () => void
}) {
  return (
    <div style={{ position: "relative", width: 84, height: 84, flexShrink: 0 }}>
      <button type="button" onClick={onOpen} style={{
        position: "relative", padding: 0, border: selected ? "3px solid #2a7a5a" : "3px solid transparent",
        borderRadius: 10, overflow: "hidden", cursor: "zoom-in", width: "100%", height: "100%", background: "#f3f4f6", display: "block",
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed/external URLs */}
        <img src={src} alt="" width={84} height={84} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        {isVideo && <PlayBadge />}
      </button>
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
    </div>
  )
}
