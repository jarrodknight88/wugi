"use client"
import { useState } from "react"
import { auth } from "@/lib/firebase"
import { authedFetch, errorMessage } from "@/lib/authedFetch"
import Lightbox from "@/components/Lightbox"
import type { MediaOption } from "@/app/api/draft-events/[id]/route"
import { type SelectedMedia, mediaOptionKey, selectedMediaKey, toggleSelectedMedia, reorderSelectedMedia } from "@/lib/mediaSelection"

const RIGHTS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  unverified: { bg: "#fef3c7", color: "#92400e", label: "Unverified" },
  permission_granted: { bg: "#dcfce7", color: "#15803d", label: "Permission granted" },
  wugi_partner: { bg: "#dcfce7", color: "#15803d", label: "Wugi partner" },
  owner_upload: { bg: "#dbeafe", color: "#1d4ed8", label: "Uploaded" },
}
const PILL = { padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb" }
const OVERLAY = { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }
const MODAL = { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 640, maxHeight: "86vh", display: "flex", flexDirection: "column" as const, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }

// Same play-triangle convention as venue-intel/DraftEventsPanel.tsx and
// venues/[venueId]/VenueMediaPanel.tsx — thumb always shows a poster frame,
// never the video itself.
function PlayBadge() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 0, height: 0, marginLeft: 2, borderTop: "6px solid transparent", borderBottom: "6px solid transparent", borderLeft: "9px solid #fff" }} />
      </div>
    </div>
  )
}

function Thumb({ src, isVideo, selected, badge, onClick }: {
  src: string; isVideo?: boolean; selected: boolean
  badge?: { bg: string; color: string; label: string }
  onClick: () => void
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <button type="button" onClick={onClick} style={{
        position: "relative", padding: 0, width: 84, height: 84, flexShrink: 0,
        border: selected ? "3px solid #2a7a5a" : "3px solid transparent",
        borderRadius: 10, overflow: "hidden", cursor: "pointer", background: "#f3f4f6", display: "block",
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URLs */}
        <img src={src} alt="" width={84} height={84} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        {isVideo && <PlayBadge />}
        {selected && (
          <span style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%", background: "#2a7a5a", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>
        )}
      </button>
      {badge && <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 10, background: badge.bg, color: badge.color }}>{badge.label}</span>}
    </div>
  )
}

// Series edit form's media manager (issue #171 Bug 2 + Feature 3). Bug 2:
// eventSeries.media is now a full ordered array here (first = cover/hero),
// never collapsed to a single coverImage. Feature 3: two ways to add —
// browse this venue's staged scraped assets (materialized server-side before
// landing in `media`, same copy-on-publish contract as draft-events'
// publish/media routes — issue #160) or upload a file directly (born
// materialized, no copy step). Visual language matches DraftEventsPanel.tsx
// / VenueMediaPanel.tsx; kept self-contained here (their Thumb/PlayBadge
// aren't exported) the same way VenueMediaPanel.tsx already duplicates them
// — the actual identity-bug fix (path-keyed selection) is shared via
// lib/mediaSelection.ts, not duplicated.
export default function SeriesMediaManager({ seriesId, venueId, media, onChange, disabled }: {
  seriesId: string
  venueId: string
  media: SelectedMedia[]
  onChange: (media: SelectedMedia[]) => void
  disabled?: boolean
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browseAssets, setBrowseAssets] = useState<MediaOption[] | null>(null)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browsePending, setBrowsePending] = useState<SelectedMedia[]>([])
  const [adding, setAdding] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")

  async function openBrowse() {
    setBrowseOpen(true); setBrowsePending([]); setError("")
    if (browseAssets !== null || browseLoading) return
    setBrowseLoading(true)
    try {
      const res = await authedFetch(`/api/series/${seriesId}/venue-assets`)
      setBrowseAssets(res.assets)
    } catch (e) { setError(errorMessage(e)) } finally { setBrowseLoading(false) }
  }

  function toggleBrowsePick(opt: MediaOption) {
    setBrowsePending((cur) => toggleSelectedMedia(cur, opt, () => confirm("Rights not verified — use anyway?")))
  }

  async function addPending() {
    if (browsePending.length === 0) { setBrowseOpen(false); return }
    setAdding(true); setError("")
    try {
      const res = await authedFetch(`/api/series/${seriesId}/venue-assets`, {
        method: "POST",
        body: JSON.stringify({
          items: browsePending,
          confirmedUnverifiedRights: browsePending.some((m) => m.rightsStatus === "unverified"),
        }),
      })
      const added: SelectedMedia[] = res.media.map((m: { uri: string; type: "image" | "video"; path?: string }, i: number) => ({
        uri: m.uri, type: m.type, path: m.path, rightsStatus: browsePending[i]?.rightsStatus,
      }))
      onChange([...media, ...added])
      setBrowseOpen(false)
    } catch (e) { setError(errorMessage(e)) } finally { setAdding(false) }
  }

  // Bypasses authedFetch — it force-sets Content-Type: application/json
  // whenever a body is present, which would corrupt the multipart boundary
  // FormData needs (the browser must set that header itself).
  async function handleUpload(file: File) {
    setUploading(true); setError("")
    try {
      const token = await auth.currentUser?.getIdToken()
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(`/api/series/${seriesId}/upload?venueId=${encodeURIComponent(venueId)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Upload failed (${res.status})`)
      }
      const data = await res.json()
      onChange([...media, { uri: data.url, type: data.type, rightsStatus: data.rightsStatus }])
    } catch (e) { setError(errorMessage(e)) } finally { setUploading(false) }
  }

  const addDisabled = disabled || !venueId

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && <div style={{ padding: "8px 12px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 12 }}>{error}</div>}

      {media.length === 0 ? (
        <p style={{ fontSize: 13, color: "#9ca3af", margin: 0 }}>No media yet — add from scraped assets or upload a file. The first item becomes the cover.</p>
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {media.map((m, i) => (
            <div key={selectedMediaKey(m)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 84 }}>
              <div style={{ position: "relative", width: 84, height: 84, borderRadius: 10, overflow: "hidden", background: "#f3f4f6", cursor: "zoom-in" }} onClick={() => setLightboxIndex(i)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- signed/permanent Storage URLs */}
                <img src={m.thumbUrl || m.uri} alt="" width={84} height={84} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                {m.type === "video" && <PlayBadge />}
                {i === 0 && (
                  <span style={{ position: "absolute", top: 4, left: 4, background: "#111827", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 6, letterSpacing: 0.5 }}>COVER</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 3 }}>
                <button type="button" disabled={disabled || i === 0} onClick={() => onChange(reorderSelectedMedia(media, i, i - 1))} title="Move up" style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.35 : 1, fontSize: 11 }}>↑</button>
                <button type="button" disabled={disabled || i === media.length - 1} onClick={() => onChange(reorderSelectedMedia(media, i, i + 1))} title="Move down" style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #e5e7eb", background: "#fff", cursor: i === media.length - 1 ? "default" : "pointer", opacity: i === media.length - 1 ? 0.35 : 1, fontSize: 11 }}>↓</button>
                <button type="button" disabled={disabled} onClick={() => onChange(media.filter((x) => selectedMediaKey(x) !== selectedMediaKey(m)))} title="Remove" style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", cursor: "pointer", fontSize: 11 }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" disabled={addDisabled} onClick={openBrowse} style={{ ...PILL, opacity: addDisabled ? 0.6 : 1 }}>+ From scraped assets</button>
        <label style={{ ...PILL, opacity: addDisabled || uploading ? 0.6 : 1 }}>
          {uploading ? "Uploading…" : "+ Upload file"}
          <input type="file" accept="image/*,video/mp4" style={{ display: "none" }} disabled={addDisabled || uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = "" }} />
        </label>
        {!venueId && <span style={{ fontSize: 12, color: "#9ca3af" }}>Pick a venue first.</span>}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          options={media.map((m) => ({ url: m.uri, thumbUrl: m.thumbUrl, type: m.type }))}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      {browseOpen && (
        <div style={OVERLAY} onClick={() => setBrowseOpen(false)}>
          <div style={MODAL} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Select from scraped assets</h3>
              <button onClick={() => setBrowseOpen(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af" }}>×</button>
            </div>
            <div style={{ padding: "20px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
              {browseLoading ? (
                <p style={{ fontSize: 13, color: "#9ca3af" }}>Loading…</p>
              ) : !browseAssets || browseAssets.length === 0 ? (
                <p style={{ fontSize: 13, color: "#9ca3af" }}>No staged assets found for this venue yet.</p>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {browseAssets.map((opt) => {
                    const key = mediaOptionKey(opt)
                    const selected = browsePending.some((m) => selectedMediaKey(m) === key)
                    return (
                      <Thumb key={key} src={opt.thumbUrl || opt.url} isVideo={opt.type === "video"} selected={selected}
                        badge={opt.rightsStatus ? RIGHTS_BADGE[opt.rightsStatus] : undefined} onClick={() => toggleBrowsePick(opt)} />
                    )
                  })}
                </div>
              )}
            </div>
            <div style={{ padding: "14px 24px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setBrowseOpen(false)} style={{ padding: "8px 16px", borderRadius: 8, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={addPending} disabled={adding || browsePending.length === 0} style={{ padding: "8px 18px", borderRadius: 8, background: "#1d4ed8", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: adding ? 0.7 : 1 }}>
                {adding ? "Adding…" : `Add selected (${browsePending.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
