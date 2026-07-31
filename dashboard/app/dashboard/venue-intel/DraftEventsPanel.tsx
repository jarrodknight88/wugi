"use client"
import { useCallback, useEffect, useState } from "react"
import { auth } from "@/lib/firebase"
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

// IG/FB CDN thumbnails need the authed proxy (hotlink-blocked, same reasoning
// as PostRow in the parent page); gallery photos and the venue hero are
// public Storage URLs and render directly.
function Thumb({ src, proxied, selected, onClick }: { src: string; proxied?: boolean; selected: boolean; onClick: () => void }) {
  const [resolved, setResolved] = useState(proxied ? "" : src)

  useEffect(() => {
    if (!proxied) { setResolved(src); return }
    let objectUrl: string | null = null
    let cancelled = false
    async function load() {
      try {
        const token = await auth.currentUser?.getIdToken()
        const res = await fetch(`/api/venue-intel/image?src=${encodeURIComponent(src)}`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error("proxy fetch failed")
        const blob = await res.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setResolved(objectUrl)
      } catch {
        if (!cancelled) setResolved("")
      }
    }
    load()
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [src, proxied])

  return (
    <button type="button" onClick={onClick} style={{
      position: "relative", padding: 0, border: selected ? "3px solid #2a7a5a" : "3px solid transparent",
      borderRadius: 10, overflow: "hidden", cursor: "pointer", width: 84, height: 84, flexShrink: 0, background: "#f3f4f6",
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- external/volatile URLs, same as the parent page's proxy pattern */}
      {resolved && <img src={resolved} alt="" width={84} height={84} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      {selected && (
        <span style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: "50%", background: "#2a7a5a", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>
      )}
    </button>
  )
}

function MediaSection({ title, options, proxied, selectedUris, onToggle, emptyText }: {
  title: string
  options: MediaOption[]
  proxied?: boolean
  selectedUris: string[]
  onToggle: (opt: MediaOption) => void
  emptyText: string
}) {
  return (
    <div>
      <p style={{ ...LABEL, marginBottom: 8 }}>{title}</p>
      {options.length === 0 ? (
        <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>{emptyText}</p>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {options.map((opt) => (
            <div key={opt.url} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <Thumb src={opt.thumbUrl || opt.url} proxied={proxied} selected={selectedUris.includes(opt.url)} onClick={() => onToggle(opt)} />
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
    const already = selectedMedia.some((m) => m.uri === opt.url)
    if (already) { setSelectedMedia((m) => m.filter((x) => x.uri !== opt.url)); return }
    if (opt.rightsStatus === "unverified" && !confirm("Rights not verified — publish anyway?")) return
    setSelectedMedia((m) => [...m, { uri: opt.url, type: "image", rightsStatus: opt.rightsStatus }])
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
            <MediaSection title="Venue hero" options={ctx.media.venueHero ? [{ url: ctx.media.venueHero, thumbUrl: ctx.media.venueHero, rightsStatus: "wugi_partner" }] : []} selectedUris={selectedMedia.map((m) => m.uri)} onToggle={toggleMedia} emptyText="No venue hero image on file." />
            <MediaSection title="Gallery photos" options={ctx.media.galleryPhotos} selectedUris={selectedMedia.map((m) => m.uri)} onToggle={toggleMedia} emptyText="No permissioned gallery photos for this venue yet." />
            <MediaSection title="Staged scraped assets" options={ctx.media.stagedAssets} selectedUris={selectedMedia.map((m) => m.uri)} onToggle={toggleMedia} emptyText="No staged assets yet." />
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
  const [drafts, setDrafts] = useState<DraftEventListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [opening, setOpening] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [publishCtx, setPublishCtx] = useState<PublishContext | null>(null)

  const load = useCallback(async () => {
    const data = await authedFetch("/api/draft-events")
    setDrafts(data.drafts)
  }, [])

  useEffect(() => {
    setLoading(true)
    load().catch((e) => setError(errorMessage(e))).finally(() => setLoading(false))
  }, [load])

  async function openPublish(id: string) {
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

  return (
    <div>
      {error && (
        <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {loading ? (
        <p style={{ color: "#9ca3af", fontSize: 14 }}>Loading…</p>
      ) : drafts.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>
          No draft events. All caught up.
        </div>
      ) : (
        <div className="dash-table-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                {["Date", "Title", "Venue", "Via", "Caption", "Actions"].map((h) => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "12px 16px", color: "#6b7280", whiteSpace: "nowrap" }}>{formatDateISO(d.dateISO)}</td>
                  <td style={{ padding: "12px 16px", fontWeight: 600, color: "#111827" }}>{d.cleanedTitle}</td>
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
                      <button onClick={() => openPublish(d.id)} disabled={opening === d.id} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer", background: "#dcfce7", color: "#15803d", fontWeight: 600, opacity: opening === d.id ? 0.6 : 1 }}>
                        {opening === d.id ? "…" : "Publish"}
                      </button>
                      <button onClick={() => dismiss(d.id)} disabled={dismissing === d.id} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer", background: "#fee2e2", color: "#b91c1c", fontWeight: 600, opacity: dismissing === d.id ? 0.6 : 1 }}>
                        {dismissing === d.id ? "…" : "Dismiss"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {publishCtx && <PublishModal ctx={publishCtx} onClose={() => setPublishCtx(null)} onPublished={handlePublished} />}
    </div>
  )
}
