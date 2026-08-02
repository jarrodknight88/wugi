"use client"
import { useState, type ReactNode } from "react"
import { auth } from "@/lib/firebase"
import { errorMessage } from "@/lib/authedFetch"
import { type SelectedMedia, type MediaOptionLike, mediaOptionKey, selectedMediaKey, toggleSelectedMedia, reorderSelectedMedia } from "@/lib/mediaSelection"
import Lightbox from "@/components/Lightbox"
import { MediaThumb, AssetBadges } from "@/components/MediaThumb"
import SelectedMediaStrip from "@/components/SelectedMediaStrip"
import ConfirmDialog from "@/components/ConfirmDialog"

const LABEL = { fontSize: 13, fontWeight: 600, color: "#374151", display: "block" as const, marginBottom: 8 }
const PILL = { padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer" as const, background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb" }

export type MediaManagerSection = { title: string; options: MediaOptionLike[]; emptyText: string }

type LightboxState = { options: MediaOptionLike[]; index: number }

function isRisky(m: { rightsStatus?: string; moderationStatus?: string }) {
  return m.rightsStatus === "unverified" || m.moderationStatus === "flagged"
}

function Section({ title, options, selectedKeys, onToggle, onOpen, emptyText }: {
  title: string
  options: MediaOptionLike[]
  selectedKeys: string[]
  onToggle: (opt: MediaOptionLike) => void
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

// Consolidated media-flow orchestration (issue #191) — the ~150 lines of
// fetch-then-select / lightbox-wiring / risky-save-gate / Saving-Saved-error
// feedback that VenueMediaPanel and EventMediaPanel each rebuilt
// independently. Sources come in as DATA (`sections`), persistence goes out
// as CALLBACKS (`onSave`, `upload`) — this component does no fetching of its
// own. Primitives (MediaThumb, Lightbox, SelectedMediaStrip, ConfirmDialog)
// stay untouched and independently exported; this is a convenience
// composition of them, not a cage.
//
// PROP-EXPLOSION GUARD: this is the full prop surface, on purpose. No
// surface-specific booleans. SeriesMediaManager (modal-based "browse +
// upload" add flow, no unified save action, disable driven by an unrelated
// parent form) and DraftEventsPanel (per-section venue-wide-vs-this-post
// scope toggle) each need bespoke chrome this contract can't express without
// a one-off flag, so they compose the primitives directly instead and are
// deliberately left un-migrated — see the comments in those files.
export default function MediaManager({ sections, value, onChange, onSave, upload, hint }: {
  sections: MediaManagerSection[]
  value: SelectedMedia[]
  onChange: (media: SelectedMedia[]) => void
  // Omitted entirely (not just disabled) — no save affordance renders. Lets
  // a caller run a read-only viewer (e.g. gated by its own permission check)
  // without a canWrite-style boolean on this component.
  onSave?: (selected: SelectedMedia[], opts: { confirmedRisky: boolean }) => Promise<void>
  upload?: { endpoint: string; accept: string }
  hint?: ReactNode
}) {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")

  const selectedKeys = value.map(selectedMediaKey)

  // Selection is free — no per-click confirm (issue #181/#183: a
  // confirm-per-click was a dead-click factory, especially once Chrome's
  // "prevent additional dialogs" latch was tripped). Risky picks stay
  // visible via AssetBadges and get a single summary confirm at Save.
  function toggle(opt: MediaOptionLike) {
    onChange(toggleSelectedMedia(value, opt))
  }

  function handleSaveClick() {
    if (!onSave) return
    const risky = value.filter(isRisky)
    if (risky.length > 0) {
      setConfirmMessage(`${risky.length} of ${value.length} selected items have unverified rights or were flagged — save anyway?`)
      return
    }
    doSave()
  }

  async function doSave() {
    if (!onSave) return
    setSaving(true); setError(""); setSaved(false)
    try {
      await onSave(value, { confirmedRisky: value.some(isRisky) })
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
  // FormData needs (the browser must set that header itself).
  async function handleUpload(file: File) {
    if (!upload) return
    setUploading(true); setError("")
    try {
      const token = await auth.currentUser?.getIdToken()
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(upload.endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Upload failed (${res.status})`)
      }
      const data = await res.json()
      onChange([...value, { uri: data.url, type: data.type, rightsStatus: data.rightsStatus }])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {hint}

      <SelectedMediaStrip
        items={value}
        onMove={(from, to) => onChange(reorderSelectedMedia(value, from, to))}
        onRemove={(key) => onChange(value.filter((m) => selectedMediaKey(m) !== key))}
        onOpen={(i) => setLightbox({ options: value.map((m) => ({ url: m.uri, thumbUrl: m.thumbUrl, type: m.type })), index: i })}
        label={value.length > 0 ? `Selected media (${value.length}) — first is the hero` : undefined}
        emptyText="No media selected yet — pick from the options below. The first selected item becomes the hero."
        disabled={saving}
      />

      {upload && (
        <div>
          <label style={{ ...PILL, opacity: uploading ? 0.6 : 1 }}>
            {uploading ? "Uploading…" : "+ Upload file"}
            <input type="file" accept={upload.accept} style={{ display: "none" }} disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = "" }} />
          </label>
        </div>
      )}

      {sections.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {sections.map((section, i) => (
            <Section
              key={`${section.title}-${i}`}
              title={section.title}
              options={section.options}
              selectedKeys={selectedKeys}
              onToggle={toggle}
              onOpen={(idx) => setLightbox({ options: section.options, index: idx })}
              emptyText={section.emptyText}
            />
          ))}
        </div>
      )}

      {lightbox && (
        <Lightbox
          options={lightbox.options}
          index={lightbox.index}
          onIndexChange={(i) => setLightbox((lb) => (lb ? { ...lb, index: i } : lb))}
          onClose={() => setLightbox(null)}
        />
      )}

      {onSave && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={handleSaveClick}
            disabled={saving}
            style={{ padding: "10px 24px", borderRadius: 8, background: "#2a7a5a", color: "#fff", border: "none", cursor: saving ? "default" : "pointer", fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Saving…" : saved ? "✓ Saved!" : "Save Media"}
          </button>
          {error && <p style={{ fontSize: 13, color: "#ef4444", margin: 0 }}>⚠️ {error}</p>}
        </div>
      )}

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
