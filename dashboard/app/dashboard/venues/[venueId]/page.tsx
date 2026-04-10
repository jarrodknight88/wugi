// ─────────────────────────────────────────────────────────────────────
// Wugi Dashboard — Venue Detail Page
// /dashboard/venues/[venueId]
// Tabs: Info | Door Access | Tables
// ─────────────────────────────────────────────────────────────────────
"use client"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { doc, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"
import DashboardLayout from "@/components/DashboardLayout"
import DoorAccessPanel from "@/components/DoorAccessPanel"
import TableGroupManager from "@/components/TableGroupManager"
import Link from "next/link"

type Venue = {
  id: string; name: string; category: string; address: string
  neighborhood: string; phone: string; website: string; instagram: string
  about: string; status: string; isFeatured: boolean; vibes: string[]
  venueLatitude?: number; venueLongitude?: number
  // Payment settings
  paymentDescriptor?: string
  idVerificationThreshold?: number
  stripeConnectAccountId?: string
  paymentDescriptorNote?: string
}

const INPUT: React.CSSProperties = {
  padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb",
  fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box",
}
const LABEL: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6,
}
const CARD: React.CSSProperties = {
  background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: "24px",
}

// ── Google Places Autocomplete ────────────────────────────────────────
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""

function loadMapsScript(onLoad: () => void) {
  if (typeof window === "undefined") return
  if ((window as any).__googleMapsLoaded) { onLoad(); return }
  const existing = document.getElementById("google-maps-script")
  if (existing) {
    existing.addEventListener("load", onLoad)
    return
  }
  const script = document.createElement("script")
  script.id = "google-maps-script"
  script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places`
  script.async = true
  script.onload = () => {
    ;(window as any).__googleMapsLoaded = true
    onLoad()
  }
  document.head.appendChild(script)
}

type AddressResult = {
  address: string
  lat: number
  lng: number
  neighborhood?: string
}

function AddressAutocomplete({
  value,
  onChange,
}: {
  value: string
  onChange: (result: AddressResult) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const [inputVal, setInputVal] = useState(value)

  useEffect(() => { setInputVal(value) }, [value])

  useEffect(() => {
    loadMapsScript(() => {
      if (!inputRef.current) return
      const ac = new (window as any).google.maps.places.Autocomplete(inputRef.current, {
        types: ["establishment", "geocode"],
        componentRestrictions: { country: "us" },
        fields: ["formatted_address", "geometry", "address_components"],
      })
      autocompleteRef.current = ac
      ac.addListener("place_changed", () => {
        const place = ac.getPlace()
        if (!place.geometry) return
        const lat = place.geometry.location.lat()
        const lng = place.geometry.location.lng()
        const address = place.formatted_address ?? inputRef.current?.value ?? ""
        // extract neighborhood from address_components
        let neighborhood = ""
        for (const comp of place.address_components ?? []) {
          if (comp.types.includes("neighborhood") || comp.types.includes("sublocality")) {
            neighborhood = comp.long_name
            break
          }
        }
        setInputVal(address)
        onChange({ address, lat, lng, neighborhood })
      })
    })
    return () => {
      if (autocompleteRef.current) {
        (window as any).google?.maps?.event?.clearInstanceListeners?.(autocompleteRef.current)
      }
    }
  }, [])

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        style={INPUT}
        value={inputVal}
        placeholder="Start typing an address…"
        onChange={e => setInputVal(e.target.value)}
      />
    </div>
  )
}

// ── Main page component ───────────────────────────────────────────────
export default function VenueDetailPage({ params }: { params: Promise<{ venueId: string }> }) {
  const router = useRouter()
  const { user, loading, hasDashboardAccess, canWrite, canManageTables } = useAuthContext()
  const [venueId, setVenueId] = useState("")
  const [venue, setVenue] = useState<Venue | null>(null)
  const [tab, setTab] = useState<"info" | "door" | "tables" | "payments">("info")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
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
        paymentDescriptor: d.paymentDescriptor || "",
        idVerificationThreshold: d.idVerificationThreshold ?? 30000,
        stripeConnectAccountId: d.stripeConnectAccountId || "",
        paymentDescriptorNote: d.paymentDescriptorNote || "",
      }
      setVenue(v); setForm(v)
    })
  }, [venueId])

  async function handleSave() {
    if (!venueId || !canWrite) return
    setSaving(true)
    setSaveError(null)
    try {
      await updateDoc(doc(db, "venues", venueId), { ...form, updatedAt: serverTimestamp() })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: any) {
      setSaveError(err?.message ?? "Save failed. Check your permissions.")
    } finally {
      setSaving(false)
    }
  }

  if (loading || !user || !hasDashboardAccess) return null
  if (!venue) return (
    <DashboardLayout>
      <div className="dash-page" style={{ color: "#9ca3af", fontSize: 14 }}>Loading venue...</div>
    </DashboardLayout>
  )

  const TABS = [
    { key: "info",     label: "Venue Info" },
    { key: "door",     label: "Door Access" },
    { key: "tables",   label: "Tables" },
    { key: "payments", label: "Payments & ID" },
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
              <div>
                <label style={LABEL}>Name</label>
                <input style={INPUT} value={form.name || ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label style={LABEL}>Category</label>
                <input style={INPUT} value={form.category || ""} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
              </div>

              {/* Address with Google Places Autocomplete */}
              <div style={{ gridColumn: "1/-1" }}>
                <label style={LABEL}>Address</label>
                <AddressAutocomplete
                  value={form.address || ""}
                  onChange={({ address, lat, lng, neighborhood }) => {
                    setForm(f => ({
                      ...f,
                      address,
                      venueLatitude: lat,
                      venueLongitude: lng,
                      // only overwrite neighborhood if it's currently empty
                      ...((!f.neighborhood || f.neighborhood === "") && neighborhood ? { neighborhood } : {}),
                    }))
                  }}
                />
                {form.venueLatitude && form.venueLongitude && (
                  <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                    📍 {form.venueLatitude.toFixed(5)}, {form.venueLongitude.toFixed(5)}
                  </p>
                )}
              </div>

              <div>
                <label style={LABEL}>Neighborhood</label>
                <input style={INPUT} value={form.neighborhood || ""} onChange={e => setForm(f => ({ ...f, neighborhood: e.target.value }))} />
              </div>
              <div>
                <label style={LABEL}>Phone</label>
                <input style={INPUT} value={form.phone || ""} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <label style={LABEL}>Website</label>
                <input style={INPUT} value={form.website || ""} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />
              </div>
              <div>
                <label style={LABEL}>Instagram</label>
                <input style={INPUT} value={form.instagram || ""} onChange={e => setForm(f => ({ ...f, instagram: e.target.value }))} />
              </div>
              <div style={{ gridColumn: "1/-1" }}>
                <label style={LABEL}>About</label>
                <textarea style={{ ...INPUT, minHeight: 80, resize: "vertical" }} value={form.about || ""} onChange={e => setForm(f => ({ ...f, about: e.target.value }))} />
              </div>
              <div>
                <label style={LABEL}>Status</label>
                <select style={INPUT} value={form.status || ""} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {["pending_review", "approved", "unclaimed", "rejected", "closed"].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 24 }}>
                <input type="checkbox" id="featured" checked={form.isFeatured || false} onChange={e => setForm(f => ({ ...f, isFeatured: e.target.checked }))} style={{ width: 18, height: 18 }} />
                <label htmlFor="featured" style={{ fontSize: 14, color: "#374151", cursor: "pointer" }}>Featured venue</label>
              </div>
            </div>

            {/* Save controls */}
            <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}>
              {canWrite ? (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{ padding: "10px 24px", borderRadius: 8, background: "#2a7a5a", color: "#fff", border: "none", cursor: saving ? "default" : "pointer", fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? "Saving…" : saved ? "✓ Saved!" : "Save Changes"}
                </button>
              ) : (
                <p style={{ fontSize: 13, color: "#9ca3af" }}>You don't have permission to edit venues.</p>
              )}
              {saveError && (
                <p style={{ fontSize: 13, color: "#ef4444", margin: 0 }}>⚠️ {saveError}</p>
              )}
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
          <TableGroupManager venueId={venueId} canWrite={canManageTables} />
        )}

        {/* ── Payments & ID Tab ── */}
        {tab === "payments" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Payment descriptor card */}
            <div style={CARD}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
                Billing Statement Descriptor
              </h3>
              <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 20px", lineHeight: 1.5 }}>
                This is what appears on your guests' bank and credit card statements. Keep it recognizable but discreet if needed. Max 22 characters, letters and numbers only.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={LABEL}>Payment Descriptor</label>
                  <input
                    style={INPUT}
                    maxLength={22}
                    value={form.paymentDescriptor || ""}
                    placeholder={form.name?.slice(0, 22) || "VENUE NAME"}
                    onChange={e => setForm(f => ({ ...f, paymentDescriptor: e.target.value.replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 22) }))}
                  />
                  <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                    {(form.paymentDescriptor || "").length}/22 characters used
                  </p>
                </div>
                <div>
                  <label style={LABEL}>Internal Note (optional)</label>
                  <input
                    style={INPUT}
                    value={form.paymentDescriptorNote || ""}
                    placeholder="e.g. Adult venue — using discreet descriptor"
                    onChange={e => setForm(f => ({ ...f, paymentDescriptorNote: e.target.value }))}
                  />
                  <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                    For your records only — not shown to guests
                  </p>
                </div>
              </div>
            </div>

            {/* ID Verification threshold card */}
            <div style={CARD}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
                ID Verification Threshold
              </h3>
              <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 20px", lineHeight: 1.5 }}>
                Set the minimum transaction amount that requires an ID scan at the door. Set to $0 to require ID on every transaction. Set to a very high value to never require ID.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={LABEL}>Require ID when charge is at least</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: "#2a7a5a" }}>$</span>
                    <input
                      style={{ ...INPUT, width: 120 }}
                      type="number"
                      min={0}
                      step={1}
                      value={((form.idVerificationThreshold ?? 30000) / 100).toFixed(0)}
                      onChange={e => setForm(f => ({ ...f, idVerificationThreshold: Math.round(parseFloat(e.target.value || "0") * 100) }))}
                    />
                  </div>
                  <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                    Currently: ID required for charges ≥ ${((form.idVerificationThreshold ?? 30000) / 100).toFixed(0)}
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 24 }}>
                  <button
                    onClick={() => setForm(f => ({ ...f, idVerificationThreshold: 0 }))}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb", cursor: "pointer", fontSize: 13, textAlign: "left" }}
                  >
                    🪪 Always require ID ($0+)
                  </button>
                  <button
                    onClick={() => setForm(f => ({ ...f, idVerificationThreshold: 30000 }))}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb", cursor: "pointer", fontSize: 13, textAlign: "left" }}
                  >
                    💳 $300+ (default)
                  </button>
                  <button
                    onClick={() => setForm(f => ({ ...f, idVerificationThreshold: 9999999 }))}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb", cursor: "pointer", fontSize: 13, textAlign: "left" }}
                  >
                    🚫 Never require ID
                  </button>
                </div>
              </div>
            </div>

            {/* Stripe Connect card */}
            <div style={CARD}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
                Stripe Connect Account
              </h3>
              <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 20px", lineHeight: 1.5 }}>
                The venue's Stripe connected account ID. Door sale payouts are transferred here after each transaction. Starts with <code>acct_</code>.
              </p>
              <div>
                <label style={LABEL}>Stripe Connect Account ID</label>
                <input
                  style={INPUT}
                  value={form.stripeConnectAccountId || ""}
                  placeholder="acct_1234567890"
                  onChange={e => setForm(f => ({ ...f, stripeConnectAccountId: e.target.value.trim() }))}
                />
                {form.stripeConnectAccountId && !form.stripeConnectAccountId.startsWith("acct_") && (
                  <p style={{ fontSize: 12, color: "#ef4444", marginTop: 4 }}>⚠️ Should start with acct_</p>
                )}
                {form.stripeConnectAccountId?.startsWith("acct_") && (
                  <p style={{ fontSize: 12, color: "#2a7a5a", marginTop: 4 }}>✓ Valid format</p>
                )}
              </div>
            </div>

            {/* Save */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {canWrite ? (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{ padding: "10px 24px", borderRadius: 8, background: "#2a7a5a", color: "#fff", border: "none", cursor: saving ? "default" : "pointer", fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? "Saving…" : saved ? "✓ Saved!" : "Save Payment Settings"}
                </button>
              ) : (
                <p style={{ fontSize: 13, color: "#9ca3af" }}>You don't have permission to edit venues.</p>
              )}
              {saveError && <p style={{ fontSize: 13, color: "#ef4444", margin: 0 }}>⚠️ {saveError}</p>}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
