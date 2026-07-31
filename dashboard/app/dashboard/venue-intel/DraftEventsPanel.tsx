"use client"
import { useCallback, useEffect, useState } from "react"
import { authedFetch, errorMessage } from "@/lib/authedFetch"
import DatePicker from "@/components/DatePicker"
import TimePicker from "@/components/TimePicker"
import SearchSelect from "@/components/SearchSelect"
import type { SelectOption } from "@/components/SearchSelect"
import type { DraftEventListItem } from "@/app/api/draft-events/route"
import type { PublishContext, MediaOption } from "@/app/api/draft-events/[id]/route"

const INPUT = { padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" as const }
const OVERLAY = { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }
const MODAL = { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 720, maxHeight: "92vh", overflowY: "auto" as const, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }
const LABEL = { fontSize: 13, fontWeight: 600, color: "#374151" }
const VIBES = ["High Energy", "Boujee", "Divey", "Rooftop", "Speakeasy", "Late Night", "Hip-Hop", "R&B", "Live Music", "Brunch", "LGBTQ+"]
const CAPTION_TRUNCATE = 140

const RIGHTS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  unverified: { bg: "#fef3c7", color: "#92400e", label: "Unverified" },
  permission_granted: { bg: "#dcfce7", color: "#15803d", label: "Permission granted" },
  wugi_partner: { bg: "#dcfce7", color: "#15803d", label: "Wugi partner" },
}

function scopeBtnStyle(active: boolean) {
  return {
    padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12,
    fontWeight: active ? 600 : 500, background: active ? "#fff" : "transparent",
    color: active ? "#111827" : "#6b7280", boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
  }
}

// Every URL rendered here (venue hero, gallery photos, staged mediaAssets) is
// either a Storage signed URL minted server-side or a public gallery URL —
// never a hotlink-blocked external CDN URL — so it always renders directly,
// no proxy. See the 7/31 PM hotfix commit for why that distinction matters.
function Thumb({ src, selected, onSelect, onOpen }: { src: string; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  return (
    <div style={{ position: "relative", width: 84, height: 84, flexShrink: 0 }}>
      <button type="button" onClick={onOpen} style={{
        padding: 0, border: selected ? "3px solid #2a7a5a" : "3px solid transparent",
        borderRadius: 10, overflow: "hidden", cursor: "zoom-in", width: "100%", height: "100%", background: "#f3f4f6", display: "block",
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed/external URLs */}
        <img src={src} alt="" width={84} height={84} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
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

type LightboxState = { options: MediaOption[]; index: number }

// Plain fixed-position overlay — no new packages. Prev/next stay scoped to
// whichever section's options it was opened from.
function Lightbox({ options, index, onIndexChange, onClose }: { options: MediaOption[]; index: number; onIndexChange: (i: number) => void; onClose: () => void }) {
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
  options: MediaOption[]
  selectedUris: string[]
  onToggle: (opt: MediaOption) => void
  onOpen: (index: number) => void
  emptyText: string
}) {
  return (
    <div>
      <p style={{ ...LABEL, marginBottom: 8 }}>{title}</p>
      {options.length === 0 ? (
        <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>{emptyText}</p>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {options.map((opt, i) => (
            <div key={opt.url} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <Thumb src={opt.thumbUrl || opt.url} selected={selectedUris.includes(opt.url)} onSelect={() => onToggle(opt)} onOpen={() => onOpen(i)} />
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

// "This post" is the mediaAssets doc tied to this draft's own source IG post
// (fast path, already loaded with the publish context). "All venue assets"
// lazy-loads every staged asset backfilled with this venue's id — e.g. a
// flyer staged under a different post than the one that generated this
// draft.
function StagedAssetsSection({ draftId, thisPost, selectedUris, onToggle, onOpen }: {
  draftId: string
  thisPost: MediaOption[]
  selectedUris: string[]
  onToggle: (opt: MediaOption) => void
  onOpen: (options: MediaOption[], index: number) => void
}) {
  const [scope, setScope] = useState<"post" | "venue">("post")
  const [venueAssets, setVenueAssets] = useState<MediaOption[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function showVenueAssets() {
    setScope("venue")
    if (venueAssets !== null || loading) return
    setLoading(true); setError("")
    try {
      const res = await authedFetch(`/api/draft-events/${draftId}/venue-assets`)
      setVenueAssets(res.assets)
    } catch (e) { setError(errorMessage(e)) } finally { setLoading(false) }
  }

  const options = scope === "post" ? thisPost : (venueAssets || [])

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <p style={{ ...LABEL, margin: 0 }}>Staged scraped assets</p>
        <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 8, padding: 2, gap: 2 }}>
          <button type="button" onClick={() => setScope("post")} style={scopeBtnStyle(scope === "post")}>This post</button>
          <button type="button" onClick={showVenueAssets} style={scopeBtnStyle(scope === "venue")}>All venue assets</button>
        </div>
      </div>
      {error && <p style={{ fontSize: 12, color: "#b91c1c", margin: "0 0 8px" }}>{error}</p>}
      {scope === "venue" && loading ? (
        <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>Loading venue assets…</p>
      ) : options.length === 0 ? (
        <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>
          {scope === "post" ? "No staged assets for this post yet." : "No staged assets found for this venue yet."}
        </p>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {options.map((opt, i) => (
            <div key={opt.url} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <Thumb src={opt.thumbUrl || opt.url} selected={selectedUris.includes(opt.url)} onSelect={() => onToggle(opt)} onOpen={() => onOpen(options, i)} />
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

type SelectedMedia = { uri: string; type: "image" | "video"; rightsStatus?: string }

function toggleSelectedMedia(current: SelectedMedia[], opt: MediaOption): SelectedMedia[] {
  const already = current.some((m) => m.uri === opt.url)
  if (already) return current.filter((m) => m.uri !== opt.url)
  if (opt.rightsStatus === "unverified" && !confirm("Rights not verified — use anyway?")) return current
  return [...current, { uri: opt.url, type: "image", rightsStatus: opt.rightsStatus }]
}

function reorderSelectedMedia(items: SelectedMedia[], from: number, to: number): SelectedMedia[] {
  if (to < 0 || to >= items.length) return items
  const copy = [...items]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

// Selection is an ORDERED list — index 0 is the hero, persisted that way
// into the event's media array. Reordering here is the only way to change
// hero/order; clicking a thumb only adds/removes from the end.
function SelectedMediaStrip({ items, onMove, onRemove }: { items: SelectedMedia[]; onMove: (from: number, to: number) => void; onRemove: (uri: string) => void }) {
  if (items.length === 0) return null
  return (
    <div>
      <p style={{ ...LABEL, marginBottom: 8 }}>Selected media ({items.length}) — first is the hero</p>
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

// Shared by the Publish modal and the Edit Media modal — same three sections
// (venue hero, gallery photos, staged assets w/ venue-wide browse), same
// hero+order strip, same lightbox. Selection state is owned by the caller.
function MediaPicker({ draftId, media, selectedMedia, onToggle, onMove, onRemove }: {
  draftId: string
  media: { venueHero: string | null; galleryPhotos: MediaOption[]; stagedAssets: MediaOption[] }
  selectedMedia: SelectedMedia[]
  onToggle: (opt: MediaOption) => void
  onMove: (from: number, to: number) => void
  onRemove: (uri: string) => void
}) {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)
  const selectedUris = selectedMedia.map((m) => m.uri)
  const venueHeroOptions: MediaOption[] = media.venueHero ? [{ url: media.venueHero, thumbUrl: media.venueHero, rightsStatus: "wugi_partner" }] : []

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SelectedMediaStrip items={selectedMedia} onMove={onMove} onRemove={onRemove} />
      <MediaSection title="Venue hero" options={venueHeroOptions} selectedUris={selectedUris} onToggle={onToggle} onOpen={(i) => setLightbox({ options: venueHeroOptions, index: i })} emptyText="No venue hero image on file." />
      <MediaSection title="Gallery photos" options={media.galleryPhotos} selectedUris={selectedUris} onToggle={onToggle} onOpen={(i) => setLightbox({ options: media.galleryPhotos, index: i })} emptyText="No permissioned gallery photos for this venue yet." />
      <StagedAssetsSection draftId={draftId} thisPost={media.stagedAssets} selectedUris={selectedUris} onToggle={onToggle} onOpen={(options, i) => setLightbox({ options, index: i })} />
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

function PublishModal({ ctx, onClose, onPublished }: { ctx: PublishContext; onClose: () => void; onPublished: (eventId: string) => void }) {
  const [title, setTitle] = useState(ctx.draft.cleanedTitle)
  const [about, setAbout] = useState(
    ctx.draft.cleanedAbout + (ctx.draft.sourceAccount ? `\n\nvia @${ctx.draft.sourceAccount}` : "")
  )
  const [date, setDate] = useState(ctx.draft.datePickerValue)
  const [time, setTime] = useState("") // drafts never carry a time — Jarrod must set it
  const [age, setAge] = useState("21+")
  const [vibes, setVibes] = useState<string[]>([])
  const [seriesMode, setSeriesMode] = useState<"one-off" | "new-series" | "attach">("one-off")
  const [newSeriesFrequency, setNewSeriesFrequency] = useState("weekly")
  const [attachSeriesId, setAttachSeriesId] = useState("")
  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia[]>(
    ctx.media.venueHero ? [{ uri: ctx.media.venueHero, type: "image", rightsStatus: "wugi_partner" }] : []
  )
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const seriesOptions: SelectOption[] = ctx.eventSeries.map((s) => ({ id: s.id, label: s.name, sub: `${s.day} · ${s.frequency}` }))

  function toggleMedia(opt: MediaOption) {
    setSelectedMedia((m) => toggleSelectedMedia(m, opt))
  }
  function moveMedia(from: number, to: number) {
    setSelectedMedia((m) => reorderSelectedMedia(m, from, to))
  }
  function removeMedia(uri: string) {
    setSelectedMedia((m) => m.filter((x) => x.uri !== uri))
  }

  async function generateAI() {
    setGenerating(true); setError("")
    try {
      const res = await authedFetch("/api/draft-events/generate", {
        method: "POST",
        body: JSON.stringify({ caption: ctx.draft.caption, venueName: ctx.venue.name, dateISO: ctx.draft.dateISO }),
      })
      setTitle(res.title); setAbout(res.about)
    } catch (e) { setError(errorMessage(e)) } finally { setGenerating(false) }
  }

  async function publish() {
    if (!title.trim()) { setError("Title is required"); return }
    if (!date) { setError("Date is required"); return }
    if (!time) { setError("Time is required — drafts don't carry a time"); return }
    if (seriesMode === "attach" && !attachSeriesId) { setError("Choose a series to attach to"); return }
    setSaving(true); setError("")
    try {
      const res = await authedFetch(`/api/draft-events/${ctx.draft.id}/publish`, {
        method: "POST",
        body: JSON.stringify({
          title, about, date, time, age, vibes,
          media: selectedMedia,
          confirmedUnverifiedRights: selectedMedia.some((m) => m.rightsStatus === "unverified"),
          seriesMode,
          newSeries: seriesMode === "new-series" ? { frequency: newSeriesFrequency } : undefined,
          attachSeriesId: seriesMode === "attach" ? attachSeriesId : undefined,
        }),
      })
      onPublished(res.eventId)
    } catch (e) { setError(errorMessage(e)) } finally { setSaving(false) }
  }

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={MODAL} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "24px 28px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Publish Event</h2>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "#9ca3af" }}>{ctx.venue.name}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>

        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
          {error && <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={LABEL}>Event Title *</label>
            {ctx.aiAvailable && (
              <button type="button" onClick={generateAI} disabled={generating} style={{
                padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: "#eef2ff", color: "#4338ca", border: "1px solid #c7d2fe", opacity: generating ? 0.6 : 1,
              }}>{generating ? "Generating…" : "✨ AI Generate"}</button>
            )}
          </div>
          <input style={{ ...INPUT, marginTop: -10 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Euphoria Fridays" />

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={LABEL}>Venue</label>
            <div style={{ ...INPUT, background: "#f9fafb", color: "#374151" }}>{ctx.venue.name || "—"}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <DatePicker label="Date" value={date} onChange={setDate} placeholder="Pick a date" />
            <TimePicker label="Time *" value={time} onChange={setTime} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={LABEL}>Age Requirement</label>
              <select style={INPUT} value={age} onChange={(e) => setAge(e.target.value)}>
                {["18+", "21+", "All Ages"].map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={LABEL}>Tickets</label>
              <div style={{ ...INPUT, background: "#f9fafb", color: "#6b7280" }}>Discovery event (no tickets)</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={LABEL}>About</label>
            <textarea style={{ ...INPUT, minHeight: 90, resize: "vertical" }} value={about} onChange={(e) => setAbout(e.target.value)} />
          </div>

          <div>
            <label style={LABEL}>Vibes</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {VIBES.map((v) => {
                const sel = vibes.includes(v)
                return (
                  <button key={v} type="button" onClick={() => setVibes((f) => (sel ? f.filter((x) => x !== v) : [...f, v]))}
                    style={{ padding: "5px 12px", borderRadius: 20, fontSize: 13, cursor: "pointer", fontWeight: sel ? 600 : 400, background: sel ? "#111827" : "#f3f4f6", color: sel ? "#fff" : "#374151", border: `1px solid ${sel ? "#111827" : "#e5e7eb"}` }}>
                    {v}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Media picker */}
          <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
            <label style={LABEL}>Media</label>
            <MediaPicker draftId={ctx.draft.id} media={ctx.media} selectedMedia={selectedMedia} onToggle={toggleMedia} onMove={moveMedia} onRemove={removeMedia} />
          </div>

          {/* Series */}
          <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={LABEL}>Series</label>
            <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 9, padding: 3, gap: 2 }}>
              {([["one-off", "One-off"], ["new-series", "New series"], ["attach", "Attach to series"]] as const).map(([key, lbl]) => (
                <button key={key} type="button" onClick={() => setSeriesMode(key)} style={{
                  flex: 1, padding: "7px 0", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13,
                  fontWeight: seriesMode === key ? 600 : 500, background: seriesMode === key ? "#fff" : "transparent",
                  color: seriesMode === key ? "#111827" : "#6b7280", boxShadow: seriesMode === key ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                }}>{lbl}</button>
              ))}
            </div>
            {seriesMode === "new-series" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={LABEL}>Frequency</label>
                <select style={INPUT} value={newSeriesFrequency} onChange={(e) => setNewSeriesFrequency(e.target.value)}>
                  {["weekly", "biweekly", "monthly"].map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>
                  Day of week is inferred from this event&apos;s date. The next 8 weeks generate automatically.
                </p>
              </div>
            )}
            {seriesMode === "attach" && (
              seriesOptions.length === 0 ? (
                <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>No active series at this venue to attach to.</p>
              ) : (
                <SearchSelect label="Existing series" value={attachSeriesId} options={seriesOptions} placeholder="Search series..." onChange={(id) => setAttachSeriesId(id)} />
              )
            )}
          </div>
        </div>

        <div style={{ padding: "16px 28px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 8, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 14 }}>Cancel</button>
          <button onClick={publish} disabled={saving} style={{ padding: "10px 24px", borderRadius: 8, background: "#1d4ed8", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  )
}

// Same picker, wired to the live published event instead of a not-yet-created
// one: preloaded from ctx.currentMedia, saves via PATCH .../media rather than
// POST .../publish. draftEvents stays "published" — only events/{id}.media
// changes.
function EditMediaModal({ ctx, onClose, onSaved }: { ctx: PublishContext; onClose: () => void; onSaved: () => void }) {
  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia[]>(
    ctx.currentMedia.map((m) => ({ uri: m.uri, type: m.type, rightsStatus: m.rightsStatus }))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  function toggleMedia(opt: MediaOption) {
    setSelectedMedia((m) => toggleSelectedMedia(m, opt))
  }
  function moveMedia(from: number, to: number) {
    setSelectedMedia((m) => reorderSelectedMedia(m, from, to))
  }
  function removeMedia(uri: string) {
    setSelectedMedia((m) => m.filter((x) => x.uri !== uri))
  }

  async function save() {
    setSaving(true); setError("")
    try {
      await authedFetch(`/api/draft-events/${ctx.draft.id}/media`, {
        method: "PATCH",
        body: JSON.stringify({
          media: selectedMedia,
          confirmedUnverifiedRights: selectedMedia.some((m) => m.rightsStatus === "unverified"),
        }),
      })
      onSaved()
    } catch (e) { setError(errorMessage(e)) } finally { setSaving(false) }
  }

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={MODAL} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "24px 28px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Edit Media</h2>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "#9ca3af" }}>{ctx.draft.cleanedTitle} · {ctx.venue.name}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>

        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
          {error && <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>{error}</div>}
          <MediaPicker draftId={ctx.draft.id} media={ctx.media} selectedMedia={selectedMedia} onToggle={toggleMedia} onMove={moveMedia} onRemove={removeMedia} />
        </div>

        <div style={{ padding: "16px 28px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 8, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 14 }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: "10px 24px", borderRadius: 8, background: "#1d4ed8", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : "Save media"}
          </button>
        </div>
      </div>
    </div>
  )
}

function CaptionCell({ caption }: { caption: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!caption) return <span style={{ color: "#9ca3af" }}>—</span>
  const isLong = caption.length > CAPTION_TRUNCATE
  const shown = expanded || !isLong ? caption : `${caption.slice(0, CAPTION_TRUNCATE)}…`
  return (
    <span style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
      {shown}{" "}
      {isLong && (
        <button onClick={() => setExpanded((e) => !e)} style={{ background: "none", border: "none", color: "#2a7a5a", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0 }}>
          {expanded ? "less" : "more"}
        </button>
      )}
    </span>
  )
}

function formatDateISO(iso: string | null) {
  if (!iso) return "—"
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

export default function DraftEventsPanel() {
  const [tab, setTab] = useState<"draft" | "published">("draft")
  const [drafts, setDrafts] = useState<DraftEventListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [opening, setOpening] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [publishCtx, setPublishCtx] = useState<PublishContext | null>(null)

  const load = useCallback(async (status: "draft" | "published") => {
    const data = await authedFetch(`/api/draft-events?status=${status}`)
    setDrafts(data.drafts)
  }, [])

  useEffect(() => {
    setLoading(true)
    load(tab).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false))
  }, [load, tab])

  async function openItem(id: string) {
    setOpening(id); setError("")
    try {
      const ctx: PublishContext = await authedFetch(`/api/draft-events/${id}`)
      setPublishCtx(ctx)
    } catch (e) { setError(errorMessage(e)) } finally { setOpening(null) }
  }

  async function dismiss(id: string) {
    setDismissing(id)
    try {
      await authedFetch(`/api/draft-events/${id}`, { method: "PATCH", body: JSON.stringify({ action: "dismiss" }) })
      setDrafts((d) => d.filter((x) => x.id !== id))
    } catch (e) { setError(errorMessage(e)) } finally { setDismissing(null) }
  }

  function handlePublished() {
    if (publishCtx) setDrafts((d) => d.filter((x) => x.id !== publishCtx.draft.id))
    setPublishCtx(null)
  }

  function handleMediaSaved() {
    setPublishCtx(null)
  }

  return (
    <div>
      <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 9, padding: 3, gap: 2, width: "fit-content", marginBottom: 16 }}>
        {([["draft", "Drafts"], ["published", "Published"]] as const).map(([key, lbl]) => (
          <button key={key} type="button" onClick={() => setTab(key)} style={{
            padding: "7px 18px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13,
            fontWeight: tab === key ? 600 : 500, background: tab === key ? "#fff" : "transparent",
            color: tab === key ? "#111827" : "#6b7280", boxShadow: tab === key ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
          }}>{lbl}</button>
        ))}
      </div>

      {error && (
        <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {loading ? (
        <p style={{ color: "#9ca3af", fontSize: 14 }}>Loading…</p>
      ) : drafts.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>
          {tab === "draft" ? "No draft events. All caught up." : "No published events yet."}
        </div>
      ) : (
        <div className="dash-table-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                {(tab === "published" ? ["Hero", "Date", "Title", "Venue", "Via", "Caption", "Actions"] : ["Date", "Title", "Venue", "Via", "Caption", "Actions"]).map((h) => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  {tab === "published" && (
                    <td style={{ padding: "12px 16px", width: 64 }}>
                      {d.heroUri ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed/gallery/venue-hero URLs, rendered direct (never via the IG proxy — see 7/31 PM hotfix commit)
                        <img src={d.heroUri} alt="" width={48} height={48} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8, background: "#f3f4f6", display: "block" }} />
                      ) : (
                        <div style={{ width: 48, height: 48, borderRadius: 8, background: "#f3f4f6" }} />
                      )}
                    </td>
                  )}
                  <td style={{ padding: "12px 16px", color: "#6b7280", whiteSpace: "nowrap" }}>
                    {tab === "published" && d.liveDate ? `${d.liveDate}${d.liveTime ? ` · ${d.liveTime}` : ""}` : formatDateISO(d.dateISO)}
                  </td>
                  <td style={{ padding: "12px 16px", fontWeight: 600, color: "#111827" }}>
                    {tab === "published" ? d.liveTitle ?? d.cleanedTitle : d.cleanedTitle}
                    {tab === "published" && d.eventMissing && (
                      <div style={{ fontSize: 11, fontWeight: 500, color: "#b91c1c", marginTop: 2 }}>⚠ Live event doc missing — showing draft data</div>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px", color: "#6b7280" }}>{d.venueName}</td>
                  <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                    {d.postUrl ? (
                      <a href={d.postUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2a7a5a", fontWeight: 600 }}>@{d.sourceAccount || "—"} ↗</a>
                    ) : (
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>@{d.sourceAccount || "—"}</span>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px", maxWidth: 320 }}><CaptionCell caption={d.caption} /></td>
                  <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {tab === "draft" ? (
                        <>
                          <button onClick={() => openItem(d.id)} disabled={opening === d.id} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer", background: "#dcfce7", color: "#15803d", fontWeight: 600, opacity: opening === d.id ? 0.6 : 1 }}>
                            {opening === d.id ? "…" : "Publish"}
                          </button>
                          <button onClick={() => dismiss(d.id)} disabled={dismissing === d.id} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer", background: "#fee2e2", color: "#b91c1c", fontWeight: 600, opacity: dismissing === d.id ? 0.6 : 1 }}>
                            {dismissing === d.id ? "…" : "Dismiss"}
                          </button>
                        </>
                      ) : (
                        <button onClick={() => openItem(d.id)} disabled={opening === d.id} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer", background: "#e0e7ff", color: "#4338ca", fontWeight: 600, opacity: opening === d.id ? 0.6 : 1 }}>
                          {opening === d.id ? "…" : "Edit media"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {publishCtx && (
        publishCtx.draft.status === "published"
          ? <EditMediaModal ctx={publishCtx} onClose={() => setPublishCtx(null)} onSaved={handleMediaSaved} />
          : <PublishModal ctx={publishCtx} onClose={() => setPublishCtx(null)} onPublished={handlePublished} />
      )}
    </div>
  )
}
