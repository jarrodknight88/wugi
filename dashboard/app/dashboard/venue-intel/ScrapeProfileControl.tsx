"use client"
import { useState } from "react"
import { authedFetch, errorMessage } from "@/lib/authedFetch"
import VenuePicker from "@/components/VenuePicker"
import { normalizeInstagramHandle, TARGET_TYPES, type TargetType } from "@/lib/instagramHandle"

// The deployed runTargetedScrape function (functions/src/bridge/
// runTargetedScrape.ts) — super_admin Bearer auth, same ID-token pattern as
// authedFetch's other callers. Not proxied through a dashboard API route:
// the function already does its own auth + Firestore writes.
const RUN_TARGETED_SCRAPE_URL = "https://us-central1-wugi-prod.cloudfunctions.net/runTargetedScrape"

const TARGET_TYPE_LABELS: Record<TargetType, string> = {
  venue: "Venue",
  event: "Event page",
  influencer: "Influencer",
  other: "Other",
}

const INPUT = { padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none" }

// Filter-only v1 (companion to the dashboard's Needs Attention / Draft
// Events handle filters) — kicks a targeted Apify scrape by IG handle. No
// polling/status tracking here; the run lands in targetedScrapes/{runId}
// and shows up in the review tabs once apifyWebhook processes it. A
// dedicated per-run results view is a planned follow-up.
export default function ScrapeProfileControl() {
  const [handle, setHandle] = useState("")
  const [handleEdited, setHandleEdited] = useState(false)
  const [targetType, setTargetType] = useState<TargetType>("venue")
  const [venueId, setVenueId] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [runId, setRunId] = useState("")

  function onHandleChange(value: string) {
    setHandle(value)
    setHandleEdited(true)
    setRunId(""); setError("")
  }

  // Manual handle entry always wins — only prefill from the venue doc's
  // instagram field if the operator hasn't typed anything themselves.
  function onVenueChange(id: string, _venueName: string, instagram?: string) {
    setVenueId(id)
    if (!handleEdited && instagram) {
      const normalized = normalizeInstagramHandle(instagram)
      if (normalized) setHandle(normalized)
    }
  }

  async function submit() {
    setError(""); setRunId("")
    const normalized = normalizeInstagramHandle(handle)
    if (!normalized) {
      setError("Enter a valid Instagram handle, @handle, or profile URL")
      return
    }
    setSubmitting(true)
    try {
      const res = await authedFetch(RUN_TARGETED_SCRAPE_URL, {
        method: "POST",
        body: JSON.stringify({ handle: normalized, targetType, venueId: venueId || undefined }),
      })
      setRunId(res.runId)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 16, marginBottom: 24 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>Scrape a profile</h2>
      <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 12px" }}>
        Kick an on-demand Apify scrape of any Instagram profile — venue, event page, or influencer. Results land in the review tabs above.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 220px" }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>IG handle or profile URL</label>
          <input
            style={INPUT}
            value={handle}
            onChange={(e) => onHandleChange(e.target.value)}
            placeholder="@handle or https://instagram.com/handle"
            disabled={submitting}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 160 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Target type</label>
          <select style={INPUT} value={targetType} onChange={(e) => setTargetType(e.target.value as TargetType)} disabled={submitting}>
            {TARGET_TYPES.map((t) => (
              <option key={t} value={t}>{TARGET_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: "1 1 220px" }}>
          <VenuePicker label="Prefill from venue (optional)" venueId={venueId} onChange={onVenueChange} placeholder="Search venues..." disabled={submitting} />
        </div>
        <button
          onClick={submit}
          disabled={submitting || !handle.trim()}
          style={{
            padding: "10px 18px", borderRadius: 8, fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer",
            background: "#111827", color: "#fff", opacity: submitting || !handle.trim() ? 0.6 : 1, height: 38,
          }}
        >
          {submitting ? "Starting…" : "Start scrape"}
        </button>
      </div>
      {runId && (
        <p style={{ fontSize: 13, color: "#15803d", fontWeight: 600, margin: "10px 0 0" }}>
          Run started (runId: {runId})
        </p>
      )}
      {error && (
        <p style={{ fontSize: 13, color: "#b91c1c", fontWeight: 600, margin: "10px 0 0" }}>
          {error}
        </p>
      )}
    </div>
  )
}
