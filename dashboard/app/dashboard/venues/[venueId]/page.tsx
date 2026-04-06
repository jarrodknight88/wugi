// ─────────────────────────────────────────────────────────────────────
// Wugi Dashboard — Venue Detail Page
// /dashboard/venues/[venueId]
// Tabs: Info | Door Access | Tables
// ─────────────────────────────────────────────────────────────────────
"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { doc, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"
import DashboardLayout from "@/components/DashboardLayout"
import DoorAccessPanel from "@/components/DoorAccessPanel"
import Link from "next/link"

type Venue = {
  id: string; name: string; category: string; address: string
  neighborhood: string; phone: string; website: string; instagram: string
  about: string; status: string; isFeatured: boolean; vibes: string[]
  venueLatitude?: number; venueLongitude?: number
}

const INPUT: React.CSSProperties = {
  padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb",
  fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box",
}
const LABEL: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }
const CARD: React.CSSProperties = { background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: "24px" }

export default function VenueDetailPage({ params }: { params: Promise<{ venueId: string }> }) {
  const router = useRouter()
  const { user, loading, hasDashboardAccess } = useAuthContext()
  const [venueId, setVenueId] = useState("")
  const [venue, setVenue] = useState<Venue | null>(null)
  const [tab, setTab] = useState<"info" | "door" | "tables">("info")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState<Partial<Venue>>({})

  useEffect(() => {
    params.then(p => setVenueId(p.venueId))
  }, [params])

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
  }, [loading, user, router])

  useEffect(() => {
    if (!venueId) return
    return onSnapshot(doc(db, "venues", venueId), snap => {
      if (!snap.exists()) return
      const d = snap.data()!
      const v: Venue = {
        id: snap.id, name: d.name || "", category: d.category || "",
        address: d.address || "", neighborhood: d.neighborhood || "",
        phone: d.phone || "", website: d.website || "", instagram: d.instagram || "",
        about: d.about || "", status: d.status || "", isFeatured: d.isFeatured || false,
        vibes: d.vibes || [], venueLatitude: d.venueLatitude, venueLongitude: d.venueLongitude,
      }
      setVenue(v); setForm(v)
    })
  }, [venueId])

  async function handleSave() {
    if (!venueId) return
    setSaving(true)
    await updateDoc(doc(db, "venues", venueId), { ...form, updatedAt: serverTimestamp() })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading || !user || !hasDashboardAccess) return null
  if (!venue) return (
    <DashboardLayout>
      <div className="dash-page" style={{ color: "#9ca3af", fontSize: 14 }}>Loading venue...</div>
    </DashboardLayout>
  )

  const TABS = [
    { key: "info",   label: "Venue Info" },
    { key: "door",   label: "Door Access" },
    { key: "tables", label: "Tables" },
  ] as const

  return (
    <DashboardLayout>
      <div className="dash-page">
        {/* Back + title */}
        <div style={{ marginBottom: 24 }}>
          <Link href="/dashboard/venues" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
            ← All Venues
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>{venue.name}</h1>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>{venue.address}</p>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid #e5e7eb", paddingBottom: 0 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: "10px 18px", border: "none", cursor: "pointer", fontSize: 14, fontWeight: tab === t.key ? 600 : 400,
              background: "transparent", color: tab === t.key ? "#111827" : "#6b7280",
              borderBottom: tab === t.key ? "2px solid #111827" : "2px solid transparent",
              marginBottom: -1,
            }}>{t.label}</button>
          ))}
        </div>

        {/* ── Info Tab ── */}
        {tab === "info" && (
          <div style={CARD}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div><label style={LABEL}>Name</label><input style={INPUT} value={form.name || ""} onChange={e => setForm(f => ({...f, name: e.target.value}))}/></div>
              <div><label style={LABEL}>Category</label><input style={INPUT} value={form.category || ""} onChange={e => setForm(f => ({...f, category: e.target.value}))}/></div>
              <div style={{ gridColumn: "1/-1" }}><label style={LABEL}>Address</label><input style={INPUT} value={form.address || ""} onChange={e => setForm(f => ({...f, address: e.target.value}))}/></div>
              <div><label style={LABEL}>Neighborhood</label><input style={INPUT} value={form.neighborhood || ""} onChange={e => setForm(f => ({...f, neighborhood: e.target.value}))}/></div>
              <div><label style={LABEL}>Phone</label><input style={INPUT} value={form.phone || ""} onChange={e => setForm(f => ({...f, phone: e.target.value}))}/></div>
              <div><label style={LABEL}>Website</label><input style={INPUT} value={form.website || ""} onChange={e => setForm(f => ({...f, website: e.target.value}))}/></div>
              <div><label style={LABEL}>Instagram</label><input style={INPUT} value={form.instagram || ""} onChange={e => setForm(f => ({...f, instagram: e.target.value}))}/></div>
              <div style={{ gridColumn: "1/-1" }}><label style={LABEL}>About</label><textarea style={{ ...INPUT, minHeight: 80, resize: "vertical" }} value={form.about || ""} onChange={e => setForm(f => ({...f, about: e.target.value}))}/></div>
              <div><label style={LABEL}>Status</label>
                <select style={INPUT} value={form.status || ""} onChange={e => setForm(f => ({...f, status: e.target.value}))}>
                  {["pending_review","approved","unclaimed","rejected","closed"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 24 }}>
                <input type="checkbox" id="featured" checked={form.isFeatured || false} onChange={e => setForm(f => ({...f, isFeatured: e.target.checked}))} style={{ width: 18, height: 18 }}/>
                <label htmlFor="featured" style={{ fontSize: 14, color: "#374151", cursor: "pointer" }}>Featured venue</label>
              </div>
            </div>
            <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
              <button onClick={handleSave} disabled={saving} style={{ padding: "10px 24px", borderRadius: 8, background: "#2a7a5a", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Saving..." : saved ? "✓ Saved!" : "Save Changes"}
              </button>
            </div>
          </div>
        )}

        {/* ── Door Access Tab ── */}
        {tab === "door" && (
          <DoorAccessPanel
            scope="venue"
            venueId={venueId}
            venueName={venue.name}
            venueLatitude={venue.venueLatitude}
            venueLongitude={venue.venueLongitude}
          />
        )}

        {/* ── Tables Tab ── */}
        {tab === "tables" && (
          <div style={{ ...CARD, textAlign: "center", color: "#9ca3af", padding: 48 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🪑</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#374151", margin: "0 0 6px" }}>Table management coming soon</p>
            <p style={{ fontSize: 14, margin: 0 }}>Set up your floor plan, VIP tables, and bottle service sections.</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
