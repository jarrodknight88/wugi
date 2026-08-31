"use client"
import { useEffect, useState } from "react"
import { authedFetch, errorMessage } from "@/lib/authedFetch"

const CARD = { background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: "24px" }

type TokenInfo = {
  token: string
  url: string
  galleryId: string
  active: boolean
  createdAt: string | null
  expiresAt: string | null
  lastUploadAt: string | null
  uploadCount: number
}

// Bronze upload link panel (issue #255) — mints a shareable, no-login link
// a photographer with their own gear can drag-and-drop photos into from a
// browser. Dual purpose per the launch task: (1) lets Bronze-tier
// photographers participate at zero hardware cost, (2) hardware-failure
// insurance — if a Lens device slips or fails, this is the fallback that
// still gets the gallery published. Photo processing (renditions, EXIF
// ordering) happens off-request in the ingestWebUpload Cloud Function; this
// panel only mints/revokes the token via bronze-upload-link/route.ts.
export default function EventBronzeUploadPanel({ eventId, canWrite }: { eventId: string; canWrite: boolean }) {
  const [info, setInfo] = useState<TokenInfo | null | undefined>(undefined) // undefined = loading
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    authedFetch(`/api/events/${eventId}/bronze-upload-link`)
      .then((data: { token: TokenInfo | null }) => { if (!cancelled) setInfo(data.token) })
      .catch((e) => { if (!cancelled) setError(errorMessage(e)) })
    return () => { cancelled = true }
  }, [eventId])

  async function generate() {
    setBusy(true)
    setError("")
    try {
      const data: { token: TokenInfo } = await authedFetch(`/api/events/${eventId}/bronze-upload-link`, { method: "POST" })
      setInfo(data.token)
      setCopied(false)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (!confirm("Revoke this upload link? Anyone still holding it will no longer be able to upload.")) return
    setBusy(true)
    setError("")
    try {
      await authedFetch(`/api/events/${eventId}/bronze-upload-link`, { method: "DELETE" })
      setInfo(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function copy() {
    if (!info) return
    navigator.clipboard?.writeText(info.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={CARD}>
      <p style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#111827" }}>Bronze upload link</p>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "#6b7280" }}>
        A no-login link a photographer can open on their phone or laptop to drag-and-drop photos straight into this
        event&apos;s gallery. Photos are processed in the background and ordered by EXIF capture time, not upload order.
      </p>

      {error && <p style={{ fontSize: 13, color: "#ef4444", margin: "0 0 12px" }}>⚠️ {error}</p>}

      {info === undefined && <p style={{ fontSize: 13, color: "#9ca3af" }}>Loading…</p>}

      {info === null && canWrite && (
        <button onClick={generate} disabled={busy} style={{
          padding: "9px 16px", borderRadius: 8, background: "#2a7a5a", color: "#fff", border: "none",
          fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
        }}>
          {busy ? "Generating…" : "Generate upload link"}
        </button>
      )}

      {info && (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ fontSize: 13, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, padding: "8px 10px", flex: "1 1 260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {info.url}
            </code>
            <button onClick={copy} style={{ padding: "8px 14px", borderRadius: 8, background: "#f3f4f6", color: "#111827", border: "1px solid #e5e7eb", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p style={{ fontSize: 12, color: "#9ca3af", margin: "10px 0 0" }}>
            {info.uploadCount} photo{info.uploadCount === 1 ? "" : "s"} uploaded
            {info.expiresAt && ` · expires ${new Date(info.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
          </p>
          {canWrite && (
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={generate} disabled={busy} style={{ padding: "7px 14px", borderRadius: 8, background: "#fff", color: "#374151", border: "1px solid #e5e7eb", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer" }}>
                Generate new link
              </button>
              <button onClick={revoke} disabled={busy} style={{ padding: "7px 14px", borderRadius: 8, background: "#fff", color: "#ef4444", border: "1px solid #fecaca", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer" }}>
                Revoke
              </button>
            </div>
          )}
        </div>
      )}

      {!canWrite && info === null && <p style={{ fontSize: 13, color: "#9ca3af" }}>You don&apos;t have permission to generate an upload link.</p>}
    </div>
  )
}
