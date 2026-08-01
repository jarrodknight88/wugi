"use client"
import { useState } from "react"
import { authedFetch, errorMessage } from "@/lib/authedFetch"
import type { VenueIntelNeedsAttentionPost } from "@/app/api/venue-intel/route"

type PlaceResult = { placeId: string; name: string; address: string; rating: number | null; userRatingCount: number; businessStatus: string | null }

const OVERLAY: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }
const MODAL: React.CSSProperties = { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }
const MFIELD: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 }
const MLABEL: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#374151" }
const MINPUT: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" }

// Only a handle is available (no IG display name in the venueIntel doc) —
// this is a starting point for the required Google Places search, not the
// final venue name. The human picks the actual match.
function nameGuessFromHandle(handle: string): string {
  const cleaned = handle.replace(/[._]+/g, " ").trim()
  if (!cleaned) return ""
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function NewVenueModal({
  post,
  onClose,
  onCreated,
}: {
  post: VenueIntelNeedsAttentionPost
  onClose: () => void
  onCreated: (postId: string, venueId: string, venueName: string) => void
}) {
  const nameGuess = nameGuessFromHandle(post.sourceAccount)
  const [step, setStep] = useState<"search" | "manual">("search")
  const [query, setQuery] = useState(nameGuess ? `${nameGuess} Atlanta` : "Atlanta")
  const [results, setResults] = useState<PlaceResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)
  const [manualName, setManualName] = useState(nameGuess)
  const [manualNeighborhood, setManualNeighborhood] = useState("")
  const [error, setError] = useState("")

  async function runSearch() {
    if (!query.trim()) return
    setSearching(true)
    setError("")
    try {
      const data = await authedFetch(`/api/venue-intel/create-venue?q=${encodeURIComponent(query.trim())}`)
      setResults(data.results)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSearching(false)
    }
  }

  async function pickPlace(placeId: string) {
    setPicking(placeId)
    setError("")
    try {
      const data = await authedFetch("/api/venue-intel/create-venue", {
        method: "POST",
        body: JSON.stringify({ mode: "google", venueIntelId: post.id, placeId }),
      })
      onCreated(post.id, data.venueId, data.venueName)
    } catch (e) {
      setError(errorMessage(e))
      setPicking(null)
    }
  }

  async function createManual() {
    if (!manualName.trim() || !manualNeighborhood.trim()) {
      setError("Name and neighborhood are required")
      return
    }
    setPicking("manual")
    setError("")
    try {
      const data = await authedFetch("/api/venue-intel/create-venue", {
        method: "POST",
        body: JSON.stringify({ mode: "manual", venueIntelId: post.id, name: manualName.trim(), neighborhood: manualNeighborhood.trim() }),
      })
      onCreated(post.id, data.venueId, data.venueName)
    } catch (e) {
      setError(errorMessage(e))
      setPicking(null)
    }
  }

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={MODAL} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "24px 28px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>New venue</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>

        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
          {error && <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>{error}</div>}

          <div style={{ fontSize: 13, color: "#6b7280" }}>
            From <strong>@{post.sourceAccount || "unknown"}</strong> — its Instagram handle will be saved on the new venue so future posts route here automatically.
          </div>

          {step === "search" ? (
            <>
              <div style={MFIELD}>
                <label style={MLABEL}>Google Places search *</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    style={MINPUT}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                    placeholder="Venue name + Atlanta"
                  />
                  <button
                    onClick={runSearch}
                    disabled={searching || !query.trim()}
                    style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", opacity: searching ? 0.6 : 1 }}
                  >
                    {searching ? "Searching…" : "Search"}
                  </button>
                </div>
              </div>

              {results !== null && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {results.length === 0 ? (
                    <div style={{ padding: "16px", textAlign: "center", color: "#9ca3af", fontSize: 13, background: "#f9fafb", borderRadius: 8 }}>
                      No results
                    </div>
                  ) : (
                    results.map((r) => (
                      <button
                        key={r.placeId}
                        onClick={() => pickPlace(r.placeId)}
                        disabled={picking !== null}
                        style={{
                          display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
                          padding: "10px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff",
                          cursor: picking !== null ? "default" : "pointer", textAlign: "left", opacity: picking !== null && picking !== r.placeId ? 0.5 : 1,
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>
                          {picking === r.placeId ? "Importing…" : r.name}
                        </span>
                        <span style={{ fontSize: 12, color: "#6b7280" }}>{r.address || "No address"}</span>
                        {r.businessStatus && r.businessStatus !== "OPERATIONAL" && (
                          <span style={{ fontSize: 11, color: "#b91c1c", fontWeight: 600 }}>{r.businessStatus.replace(/_/g, " ").toLowerCase()}</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}

              <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 12 }}>
                <button
                  onClick={() => setStep("manual")}
                  style={{ background: "none", border: "none", color: "#6b7280", fontSize: 13, cursor: "pointer", textDecoration: "underline", padding: 0 }}
                >
                  No Google match — create manually
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={MFIELD}>
                <label style={MLABEL}>Venue name *</label>
                <input style={MINPUT} value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="e.g. Tabu" />
              </div>
              <div style={MFIELD}>
                <label style={MLABEL}>Neighborhood *</label>
                <input style={MINPUT} value={manualNeighborhood} onChange={(e) => setManualNeighborhood(e.target.value)} placeholder="e.g. Buckhead" />
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af" }}>
                Created without Google verification — flagged for enrichment later.
              </div>
              <div>
                <button
                  onClick={() => setStep("search")}
                  style={{ background: "none", border: "none", color: "#6b7280", fontSize: 13, cursor: "pointer", textDecoration: "underline", padding: 0 }}
                >
                  ← Back to Google search
                </button>
              </div>
            </>
          )}
        </div>

        {step === "manual" && (
          <div style={{ padding: "16px 28px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 8, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 14, color: "#374151" }}>Cancel</button>
            <button
              onClick={createManual}
              disabled={picking !== null}
              style={{ padding: "10px 24px", borderRadius: 8, background: "#2a7a5a", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, opacity: picking !== null ? 0.7 : 1 }}
            >
              {picking === "manual" ? "Creating…" : "Create Venue"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
