// ─────────────────────────────────────────────────────────────────────
// DoorAccessPanel — shared PIN management UI
// Used on both Venue detail and Event detail pages.
// scope: 'venue' | 'event'
// ─────────────────────────────────────────────────────────────────────
"use client"
import { useState, useEffect } from "react"
import { collection, query, where, onSnapshot, updateDoc, doc } from "firebase/firestore"
import { getFunctions, httpsCallable } from "firebase/functions"
import { db } from "@/lib/firebase"

type Pin = {
  id: string
  pin: string
  scope: string
  label: string
  active: boolean
  createdAt: any
  expiresAt: any
  eventId?: string
  eventName?: string
}

type Props = {
  scope: "venue" | "event"
  venueId: string
  venueName?: string
  venueLatitude?: number
  venueLongitude?: number
  eventId?: string
  eventName?: string
  eventDate?: string
}

const CARD: React.CSSProperties = {
  background: "#fff", borderRadius: 12,
  border: "1px solid #e5e7eb",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  overflow: "hidden",
}

const PIN_DISPLAY: React.CSSProperties = {
  fontFamily: "monospace", fontSize: 36, fontWeight: 900,
  letterSpacing: 10, color: "#111827",
  padding: "20px 0 4px", textAlign: "center",
}

export default function DoorAccessPanel({
  scope, venueId, venueName, venueLatitude, venueLongitude,
  eventId, eventName, eventDate,
}: Props) {
  const [pins, setPins] = useState<Pin[]>([])
  const [generating, setGenerating] = useState(false)
  const [deactivating, setDeactivating] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [expiresInHours, setExpiresInHours] = useState<number | "">("")

  useEffect(() => {
    if (!venueId) return
    let q = query(
      collection(db, "eventPins"),
      where("venueId", "==", venueId),
      where("scope", "==", scope)
    )
    return onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as Pin))
      // Sort: active first, then by createdAt desc
      all.sort((a, b) => {
        if (a.active && !b.active) return -1
        if (!a.active && b.active) return 1
        return (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
      })
      setPins(all.filter(p => scope === "event" ? p.eventId === eventId : !p.eventId))
    })
  }, [venueId, scope, eventId])

  async function generatePin() {
    setGenerating(true); setError("")
    try {
      const fn = httpsCallable(getFunctions(), "generateDoorPin")
      await fn({
        scope, venueId, venueName, venueLatitude, venueLongitude,
        eventId: eventId || null,
        eventName: eventName || null,
        eventDate: eventDate || null,
        label: scope === "venue" ? "Venue Access" : `${eventName || "Event"} Door`,
        expiresInHours: expiresInHours || null,
      })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  async function deactivatePin(pinId: string) {
    setDeactivating(pinId); setError("")
    try {
      await updateDoc(doc(db, "eventPins", pinId), { active: false })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDeactivating(null)
    }
  }

  function copyPin(pin: string) {
    navigator.clipboard.writeText(pin).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const activePin = pins.find(p => p.active)
  const pastPins  = pins.filter(p => !p.active).slice(0, 3)

  const scopeColor = scope === "venue" ? "#064e3b" : "#1d4ed8"
  const scopeLabel = scope === "venue" ? "Venue" : "Event"

  return (
    <div style={CARD}>
      {/* Header */}
      <div style={{ background: scopeColor, padding: "16px 20px", display: "flex", alignItems: "center", gap: 10 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#fff" }}>
            Wugi Door — {scopeLabel} PIN
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
            {scope === "venue" ? "Permanent access for venue staff" : "Event-specific access for door staff"}
          </p>
        </div>
      </div>

      <div style={{ padding: "20px" }}>
        {error && (
          <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>{error}</div>
        )}

        {/* Active PIN display */}
        {activePin ? (
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", letterSpacing: 1, margin: "0 0 4px", textTransform: "uppercase" }}>Active PIN</p>
            <div style={PIN_DISPLAY}>{activePin.pin}</div>
            <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 16px" }}>
              {activePin.label}
              {activePin.expiresAt && ` · Expires ${activePin.expiresAt.toDate?.()?.toLocaleString?.() || ""}`}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={() => copyPin(activePin.pin)} style={{
                padding: "9px 20px", borderRadius: 8, border: "1px solid #e5e7eb",
                background: copied ? "#f0fdf4" : "#f9fafb", cursor: "pointer",
                fontSize: 13, fontWeight: 600, color: copied ? "#15803d" : "#374151",
              }}>
                {copied ? "✓ Copied!" : "Copy PIN"}
              </button>
              <button onClick={generatePin} disabled={generating} style={{
                padding: "9px 20px", borderRadius: 8, border: "none",
                background: scopeColor, color: "#fff", cursor: "pointer",
                fontSize: 13, fontWeight: 600, opacity: generating ? 0.7 : 1,
              }}>
                {generating ? "Generating..." : "Regenerate"}
              </button>
              <button onClick={() => deactivatePin(activePin.id)} disabled={!!deactivating} style={{
                padding: "9px 20px", borderRadius: 8, border: "1px solid #fee2e2",
                background: "#fff", color: "#b91c1c", cursor: "pointer", fontSize: 13,
              }}>
                Deactivate
              </button>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", marginBottom: 20, padding: "24px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🔒</div>
            <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 16px" }}>No active PIN for this {scopeLabel.toLowerCase()}</p>
            <button onClick={generatePin} disabled={generating} style={{
              padding: "11px 28px", borderRadius: 8, border: "none",
              background: scopeColor, color: "#fff", cursor: "pointer",
              fontSize: 14, fontWeight: 700, opacity: generating ? 0.7 : 1,
            }}>
              {generating ? "Generating..." : `Generate ${scopeLabel} PIN`}
            </button>
          </div>
        )}

        {/* Expiry option */}
        <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 16, display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", whiteSpace: "nowrap" }}>Auto-expire after</label>
          <select value={expiresInHours} onChange={e => setExpiresInHours(e.target.value ? Number(e.target.value) : "")}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 13, flex: 1, outline: "none" }}>
            <option value="">No expiry</option>
            <option value="6">6 hours</option>
            <option value="12">12 hours</option>
            <option value="24">24 hours (1 day)</option>
            <option value="48">48 hours (2 days)</option>
            <option value="168">7 days</option>
          </select>
        </div>

        {/* Past PINs */}
        {pastPins.length > 0 && (
          <div style={{ marginTop: 16, borderTop: "1px solid #f3f4f6", paddingTop: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", letterSpacing: 1, margin: "0 0 8px", textTransform: "uppercase" }}>Recent Past PINs</p>
            {pastPins.map(p => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f9fafb" }}>
                <span style={{ fontFamily: "monospace", fontSize: 16, color: "#9ca3af", letterSpacing: 4 }}>{p.pin}</span>
                <span style={{ fontSize: 11, color: "#d1d5db" }}>
                  {p.createdAt?.toDate?.()?.toLocaleDateString?.() || ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
