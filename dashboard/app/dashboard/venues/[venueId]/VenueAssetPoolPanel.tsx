"use client"
import { useEffect, useRef, useState } from "react"
import { auth } from "@/lib/firebase"
import { authedFetch, errorMessage } from "@/lib/authedFetch"
import type { VenueAssetPoolItem } from "@/app/api/venues/[venueId]/asset-pool/route"

const CARD = { background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: "24px" }
const TAGS = ["interior", "crowd", "bar", "exterior", "performance"] as const
const COVERAGE_TARGET = 6

// Venue Asset Pool tab (issue #269) — the evergreen media library
// functions/src/venues/venueAssetGallery.ts draws from automatically to
// compose each event's supporting gallery (1 scraped hero + up to 6 of
// these). Distinct from the Media tab (VenueMediaPanel): that one curates
// the venue's OWN hero reel (venues.media, manually ordered); this one is a
// flat, tag-and-approve pool with no ordering — selection/rotation happens
// server-side, weighted by least-recently-used.
export default function VenueAssetPoolPanel({ venueId, canWrite }: { venueId: string; canWrite: boolean }) {
  const [assets, setAssets] = useState<VenueAssetPoolItem[] | null>(null)
  const [error, setError] = useState("")
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function load() {
    authedFetch(`/api/venues/${venueId}/asset-pool`)
      .then((data: { assets: VenueAssetPoolItem[] }) => setAssets(data.assets))
      .catch((e) => setError(errorMessage(e)))
  }

  useEffect(() => { load() }, [venueId])

  async function upload(file: File) {
    setUploading(true); setError("")
    try {
      const token = await auth.currentUser?.getIdToken()
      const fd = new FormData()
      fd.append("file", file)
      // Bypasses authedFetch — it force-sets Content-Type: application/json,
      // which stomps the multipart boundary FormData needs (same fix as
      // MediaManager.tsx's uploadFile).
      const res = await fetch(`/api/venues/${venueId}/asset-pool/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Upload failed (${res.status})`)
      }
      load()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function setApproved(assetId: string, approved: boolean) {
    setBusyId(assetId); setError("")
    try {
      await authedFetch(`/api/venues/${venueId}/asset-pool/${assetId}`, { method: "PATCH", body: JSON.stringify({ approved }) })
      setAssets((prev) => prev?.map((a) => (a.id === assetId ? { ...a, approved, approvedBy: approved ? "you" : a.approvedBy } : a)) ?? prev)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  async function toggleTag(asset: VenueAssetPoolItem, tag: string) {
    const tags = asset.tags.includes(tag) ? asset.tags.filter((t) => t !== tag) : [...asset.tags, tag]
    setBusyId(asset.id); setError("")
    try {
      await authedFetch(`/api/venues/${venueId}/asset-pool/${asset.id}`, { method: "PATCH", body: JSON.stringify({ tags }) })
      setAssets((prev) => prev?.map((a) => (a.id === asset.id ? { ...a, tags } : a)) ?? prev)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(assetId: string) {
    if (!window.confirm("Delete this asset? This can't be undone.")) return
    setBusyId(assetId); setError("")
    try {
      await authedFetch(`/api/venues/${venueId}/asset-pool/${assetId}`, { method: "DELETE" })
      setAssets((prev) => prev?.filter((a) => a.id !== assetId) ?? prev)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  if (assets === null) return <div style={CARD}><p style={{ fontSize: 14, color: "#9ca3af", margin: 0 }}>Loading asset pool…</p></div>

  const approvedCount = assets.filter((a) => a.approved).length
  const lowCoverage = approvedCount < COVERAGE_TARGET

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...CARD, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" as const, gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>Evergreen asset pool</h3>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
            Approved assets rotate automatically into each event&apos;s gallery (up to 6, least-recently-used first). Unapproved assets never appear in the app.
          </p>
        </div>
        <span style={{
          padding: "4px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600,
          background: lowCoverage ? "#fef9c3" : "#dcfce7", color: lowCoverage ? "#a16207" : "#15803d",
        }}>
          {approvedCount} approved{lowCoverage ? ` · low coverage (target ${COVERAGE_TARGET})` : ""}
        </span>
      </div>

      {error && <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>{error}</div>}

      {canWrite && (
        <div style={CARD}>
          <label style={{
            display: "inline-block", padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: "#111827", color: "#fff", cursor: uploading ? "default" : "pointer", opacity: uploading ? 0.6 : 1,
          }}>
            {uploading ? "Uploading…" : "+ Upload asset"}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/mp4"
              style={{ display: "none" }}
              disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }}
            />
          </label>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
        {assets.length === 0 && (
          <div style={{ ...CARD, gridColumn: "1/-1", textAlign: "center", color: "#9ca3af" }}>No assets uploaded yet.</div>
        )}
        {assets.map((asset) => (
          <div key={asset.id} style={{ ...CARD, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ position: "relative", width: "100%", aspectRatio: "1", borderRadius: 8, overflow: "hidden", background: "#f3f4f6" }}>
              {asset.type === "video" ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={asset.thumbnailUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={asset.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              )}
              <span style={{
                position: "absolute", top: 6, left: 6, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700,
                background: asset.approved ? "#dcfce7" : "#f3f4f6", color: asset.approved ? "#15803d" : "#6b7280",
              }}>
                {asset.approved ? "Approved" : "Pending"}
              </span>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4 }}>
              {TAGS.map((tag) => {
                const active = asset.tags.includes(tag)
                return (
                  <button
                    key={tag}
                    disabled={!canWrite || busyId === asset.id}
                    onClick={() => toggleTag(asset, tag)}
                    style={{
                      padding: "2px 8px", borderRadius: 12, fontSize: 11, cursor: canWrite ? "pointer" : "default",
                      background: active ? "#111827" : "#f3f4f6", color: active ? "#fff" : "#6b7280",
                      border: "1px solid " + (active ? "#111827" : "#e5e7eb"),
                    }}
                  >{tag}</button>
                )
              })}
            </div>

            {canWrite && (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  disabled={busyId === asset.id}
                  onClick={() => setApproved(asset.id, !asset.approved)}
                  style={{
                    flex: 1, padding: "6px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none",
                    background: asset.approved ? "#fef9c3" : "#dcfce7", color: asset.approved ? "#a16207" : "#15803d",
                  }}
                >{asset.approved ? "Unapprove" : "Approve"}</button>
                <button
                  disabled={busyId === asset.id}
                  onClick={() => remove(asset.id)}
                  style={{ padding: "6px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", background: "#fee2e2", color: "#b91c1c" }}
                >Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {!canWrite && <p style={{ fontSize: 13, color: "#9ca3af" }}>You don&apos;t have permission to edit this venue&apos;s asset pool.</p>}
    </div>
  )
}
