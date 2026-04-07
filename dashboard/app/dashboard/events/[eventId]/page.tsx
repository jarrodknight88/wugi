"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  doc, onSnapshot, collection, updateDoc, addDoc, deleteDoc,
  serverTimestamp, getDocs, query, orderBy,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"
import DashboardLayout from "@/components/DashboardLayout"
import DoorAccessPanel from "@/components/DoorAccessPanel"
import DatePicker from "@/components/DatePicker"
import TimePicker from "@/components/TimePicker"
import SearchSelect from "@/components/SearchSelect"
import type { SelectOption } from "@/components/SearchSelect"
import { GROUP_COLORS } from "@/components/TableGroupManager"
import Link from "next/link"

// ── Types ─────────────────────────────────────────────────────────────
type EventDoc = {
  id: string; title: string; venue: string; venueId: string; date: string
  time: string; age: string; about: string; status: string; hasTickets: boolean
  venueLatitude?: number; venueLongitude?: number; vibes?: string[]
  idVerificationThreshold?: number  // cents; -1=never, 0=always, >0=threshold
}
type TicketType = {
  id: string; name: string; price: number; capacity: number
  sold: number; remaining: number; active: boolean; color?: string
}
type TableGroup = { id: string; name: string; color: string }
type EditForm = {
  title: string; venue: string; venueId: string; date: string
  time: string; age: string; about: string; status: string; vibes: string[]
  idVerificationThreshold: number
}
type TicketForm = {
  name: string; price: number; capacity: number; active: boolean; color: string
}

// ── Constants ─────────────────────────────────────────────────────────
const CARD: React.CSSProperties = {
  background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: 24,
}
const INPUT: React.CSSProperties = {
  padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb",
  fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box",
}
const LABEL: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5,
}
const SC: Record<string, { bg: string; color: string }> = {
  approved: { bg: "#dcfce7", color: "#15803d" },
  pending:  { bg: "#fef9c3", color: "#a16207" },
  rejected: { bg: "#fee2e2", color: "#b91c1c" },
}
const VIBES = ["High Energy","Boujee","Divey","Rooftop","Speakeasy","Late Night","Hip-Hop","R&B","Live Music","Brunch","LGBTQ+"]
const EMPTY_TICKET: TicketForm = { name: "", price: 0, capacity: 100, active: true, color: GROUP_COLORS[0] }

// ── Color picker (inline) ─────────────────────────────────────────────
function ColorDots({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
      {GROUP_COLORS.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} style={{
          width: 22, height: 22, borderRadius: "50%", background: c, border: "none",
          cursor: "pointer", outline: value === c ? `3px solid ${c}` : "none",
          outlineOffset: 2, transform: value === c ? "scale(1.2)" : "scale(1)",
          transition: "transform 0.1s",
        }} />
      ))}
    </div>
  )
}

// ── Ticket Tier Modal ─────────────────────────────────────────────────
function TicketModal({
  initial, tableGroups, soldCount, onSave, onClose,
}: {
  initial: TicketForm & { id?: string }
  tableGroups: TableGroup[]
  soldCount: number
  onSave: (f: TicketForm) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<TicketForm>(initial)
  const [importMode, setImportMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  function importGroup(g: TableGroup) {
    setForm(f => ({ ...f, name: g.name, color: g.color }))
    setImportMode(false)
  }

  async function submit() {
    if (!form.name.trim()) { setError("Name required"); return }
    if (form.capacity < soldCount) { setError(`Capacity can't be below ${soldCount} (already sold)`); return }
    setSaving(true)
    try { await onSave(form); onClose() }
    catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const isEdit = !!initial.id
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 500, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{isEdit ? "Edit Ticket Tier" : "Add Ticket Tier"}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          {error && <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>{error}</div>}

          {/* Import from table group */}
          {tableGroups.length > 0 && (
            <div style={{ background: "#f8faff", borderRadius: 8, padding: "12px 14px", border: "1px solid #dbeafe" }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#2563eb", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: 0.5 }}>Import from Table Group</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {tableGroups.map(g => (
                  <button key={g.id} type="button" onClick={() => importGroup(g)}
                    style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", background: g.color, color: "#fff", border: "none" }}>
                    {g.name}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: "#6b7280", margin: "6px 0 0" }}>Clicking a group pre-fills name and color from that group.</p>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={LABEL}>Tier Name *</label>
              <input style={INPUT} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="GA, VIP, Table, etc." />
            </div>
            <div>
              <label style={LABEL}>Price ($)</label>
              <input style={INPUT} type="number" min={0} step={0.01} value={(form.price / 100).toFixed(2)}
                onChange={e => setForm(f => ({ ...f, price: Math.round(Number(e.target.value) * 100) }))} />
            </div>
            <div>
              <label style={LABEL}>Capacity{isEdit && soldCount > 0 ? ` (min ${soldCount})` : ""}</label>
              <input style={INPUT} type="number" min={soldCount || 1} value={form.capacity}
                onChange={e => setForm(f => ({ ...f, capacity: Number(e.target.value) }))} />
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={LABEL}>Tier Color (shows on Apple Wallet pass)</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: form.color, border: "1px solid #e5e7eb" }} />
                <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "monospace" }}>{form.color}</span>
              </div>
              <ColorDots value={form.color} onChange={c => setForm(f => ({ ...f, color: c }))} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" id="ttActive" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} style={{ width: 16, height: 16 }} />
              <label htmlFor="ttActive" style={{ fontSize: 13, color: "#374151", cursor: "pointer" }}>Active (on sale)</label>
            </div>
          </div>
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 8, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 14 }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ padding: "9px 22px", borderRadius: 8, background: "#111827", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Tier"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────
export default function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const router = useRouter()
  const { user, loading, hasDashboardAccess, canWrite } = useAuthContext()
  const [eventId, setEventId]     = useState("")
  const [event, setEvent]         = useState<EventDoc | null>(null)
  const [tickets, setTickets]     = useState<TicketType[]>([])
  const [tableGroups, setTableGroups] = useState<TableGroup[]>([])
  const [venueOpts, setVenueOpts] = useState<SelectOption[]>([])
  const [tab, setTab]             = useState<"info" | "door" | "tickets">("info")
  const [editing, setEditing]     = useState(false)
  const [ticketModal, setTicketModal] = useState<{ form: TicketForm & { id?: string } } | null>(null)
  const [form, setForm]           = useState<EditForm>({ title: "", venue: "", venueId: "", date: "", time: "", age: "21+", about: "", status: "approved", vibes: [], idVerificationThreshold: 30000 })
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [error, setError]         = useState("")

  useEffect(() => { params.then(p => setEventId(p.eventId)) }, [params])
  useEffect(() => { if (loading) return; if (!user) router.replace("/login") }, [loading, user, router])

  useEffect(() => {
    if (!eventId) return
    const u1 = onSnapshot(doc(db, "events", eventId), snap => {
      if (!snap.exists()) return
      const d = snap.data()!
      const ev: EventDoc = {
        id: snap.id, title: d.title || "", venue: d.venue || "", venueId: d.venueId || "",
        date: d.date || "", time: d.time || "", age: d.age || "21+", about: d.about || "",
        status: d.status || "pending", hasTickets: d.hasTickets || false,
        venueLatitude: d.venueLatitude, venueLongitude: d.venueLongitude, vibes: d.vibes || [],
        idVerificationThreshold: d.idVerificationThreshold ?? 30000,
      }
      setEvent(ev)
      setForm({ title: ev.title, venue: ev.venue, venueId: ev.venueId, date: ev.date, time: ev.time, age: ev.age, about: ev.about, status: ev.status, vibes: ev.vibes || [], idVerificationThreshold: ev.idVerificationThreshold ?? 30000 })
    })
    const u2 = onSnapshot(collection(db, "events", eventId, "ticketTypes"), snap =>
      setTickets(snap.docs.map(d => ({
        id: d.id, name: d.data().name, price: d.data().price, capacity: d.data().capacity,
        sold: d.data().sold || 0, remaining: d.data().remaining ?? d.data().capacity,
        active: d.data().active !== false, color: d.data().color || "#2a7a5a",
      })))
    )
    const u3 = onSnapshot(collection(db, "venues"), snap =>
      setVenueOpts(snap.docs.map(d => ({ id: d.id, label: d.data().name || "Unnamed", sub: d.data().neighborhood || "" })).sort((a, b) => a.label.localeCompare(b.label)))
    )
    return () => { u1(); u2(); u3() }
  }, [eventId])

  // Load table groups when venue is known
  useEffect(() => {
    if (!event?.venueId) return
    return onSnapshot(collection(db, "venues", event.venueId, "tableGroups"), snap =>
      setTableGroups(snap.docs.map(d => ({ id: d.id, name: d.data().name || "", color: d.data().color || "#2a7a5a" })))
    )
  }, [event?.venueId])

  async function saveEdits() {
    if (!form.title.trim()) { setError("Title is required"); return }
    setSaving(true); setError("")
    try {
      await updateDoc(doc(db, "events", eventId), { ...form, updatedAt: serverTimestamp() })
      setSaved(true); setEditing(false)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function saveTicket(f: TicketForm, id?: string) {
    const data = {
      name: f.name, price: f.price, capacity: f.capacity, active: f.active,
      color: f.color, remaining: id
        ? f.capacity - (tickets.find(t => t.id === id)?.sold ?? 0)
        : f.capacity,
      updatedAt: serverTimestamp(),
    }
    if (id) {
      await updateDoc(doc(db, "events", eventId, "ticketTypes", id), data)
    } else {
      await addDoc(collection(db, "events", eventId, "ticketTypes"), { ...data, sold: 0, createdAt: serverTimestamp() })
      await updateDoc(doc(db, "events", eventId), { hasTickets: true, updatedAt: serverTimestamp() })
    }
  }

  async function deleteTicket(id: string, sold: number) {
    if (sold > 0) { alert("Can't delete a tier with sold tickets."); return }
    if (!confirm("Delete this ticket tier?")) return
    await deleteDoc(doc(db, "events", eventId, "ticketTypes", id))
  }

  async function setStatus(status: string) {
    await updateDoc(doc(db, "events", eventId), { status, updatedAt: serverTimestamp() })
  }

  if (loading || !user || !hasDashboardAccess) return null
  if (!event) return <DashboardLayout><div className="dash-page" style={{ color: "#9ca3af" }}>Loading event...</div></DashboardLayout>

  const sc = SC[event.status] || { bg: "#f3f4f6", color: "#6b7280" }
  const TABS = [
    { key: "info", label: "Event Info" },
    { key: "door", label: "Door Access" },
    { key: "tickets", label: `Ticket Tiers${tickets.length > 0 ? ` (${tickets.length})` : ""}` },
  ] as const
  const totalRevenue = tickets.reduce((s, t) => s + t.sold * t.price, 0)
  const totalSold    = tickets.reduce((s, t) => s + t.sold, 0)

  return (
    <DashboardLayout>
      <div className="dash-page">
        {/* Back + header */}
        <div style={{ marginBottom: 24 }}>
          <Link href="/dashboard/events" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 8 }}>← All Events</Link>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>{event.title}</h1>
            <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: sc.bg, color: sc.color }}>{event.status}</span>
            {saved && <span style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>✓ Saved!</span>}
          </div>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>{event.venue} · {event.date} {event.time}</p>
          {/* Quick links */}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {event.venueId && (
              <Link href={`/dashboard/venues/${event.venueId}?tab=tables`}
                style={{ fontSize: 12, fontWeight: 600, color: "#2a7a5a", textDecoration: "none", padding: "4px 12px", borderRadius: 20, background: "#ecfdf5", border: "1px solid #a7f3d0", display: "inline-flex", alignItems: "center", gap: 5 }}>
                🪑 Venue Tables
              </Link>
            )}
            <Link href={`/dashboard/events/${eventId}/checkin`}
              style={{ fontSize: 12, fontWeight: 600, color: "#7c3aed", textDecoration: "none", padding: "4px 12px", borderRadius: 20, background: "#f5f3ff", border: "1px solid #ddd6fe", display: "inline-flex", alignItems: "center", gap: 5 }}>
              ✓ Check-in
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid #e5e7eb" }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setEditing(false) }} style={{
              padding: "10px 18px", border: "none", cursor: "pointer", fontSize: 14,
              fontWeight: tab === t.key ? 600 : 400, background: "transparent",
              color: tab === t.key ? "#111827" : "#6b7280",
              borderBottom: tab === t.key ? "2px solid #111827" : "2px solid transparent", marginBottom: -1,
            }}>{t.label}</button>
          ))}
        </div>

        {/* ── Info Tab VIEW ── */}
        {tab === "info" && !editing && (
          <div style={CARD}>
            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {([["Venue", event.venue || "—"], ["Date & Time", `${event.date} · ${event.time}`], ["Age", event.age], ["Tickets", event.hasTickets ? `✓ Live (${totalSold} sold)` : "Not selling"],
                  ["ID Verification", event.idVerificationThreshold === -1 ? "Disabled" : event.idVerificationThreshold === 0 ? "Always required" : `Required over $${((event.idVerificationThreshold ?? 30000) / 100).toFixed(0)}`]
                ] as [string,string][]).map(([label, val]) => (
                  <div key={label}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, margin: "0 0 4px" }}>{label}</p>
                    <p style={{ fontSize: 14, color: label === "Tickets" && event.hasTickets ? "#15803d" : "#111827", margin: 0, fontWeight: 500 }}>{val}</p>
                  </div>
                ))}
              </div>
              {event.about && <div><p style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, margin: "0 0 6px" }}>About</p><p style={{ fontSize: 14, color: "#374151", margin: 0, lineHeight: 1.6 }}>{event.about}</p></div>}
              {(event.vibes || []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(event.vibes || []).map(v => <span key={v} style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, background: "#f3f4f6", color: "#374151" }}>{v}</span>)}
                </div>
              )}
              <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => setEditing(true)} style={{ padding: "9px 20px", borderRadius: 8, background: "#111827", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Edit Event</button>
                {event.status !== "approved" && <button onClick={() => setStatus("approved")} style={{ padding: "9px 20px", borderRadius: 8, background: "#dcfce7", color: "#15803d", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Approve</button>}
                {event.status !== "rejected" && <button onClick={() => setStatus("rejected")} style={{ padding: "9px 20px", borderRadius: 8, background: "#fee2e2", color: "#b91c1c", border: "none", cursor: "pointer", fontSize: 13 }}>Reject</button>}
              </div>
            </div>
          </div>
        )}

        {/* ── Info Tab EDIT ── */}
        {tab === "info" && editing && (
          <div style={CARD}>
            {error && <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>{error}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div><label style={LABEL}>Event Title *</label><input style={INPUT} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Euphoria Fridays" /></div>
              <SearchSelect label="Venue" value={form.venueId} options={venueOpts} placeholder="Search venues..." onChange={(id, label) => setForm(f => ({ ...f, venueId: id, venue: label }))} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <DatePicker label="Date" value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} placeholder="Pick a date" />
                <TimePicker label="Time" value={form.time} onChange={v => setForm(f => ({ ...f, time: v }))} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div><label style={LABEL}>Status</label><select style={INPUT} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>{["pending","approved","rejected"].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                <div><label style={LABEL}>Age</label><select style={INPUT} value={form.age} onChange={e => setForm(f => ({ ...f, age: e.target.value }))}>{["18+","21+","All Ages"].map(a => <option key={a} value={a}>{a}</option>)}</select></div>
              </div>

              {/* ID Verification Threshold */}
              <div style={{ background: "#f8faff", borderRadius: 10, padding: "14px 16px", border: "1px solid #dbeafe" }}>
                <label style={{ ...LABEL, color: "#1d4ed8" }}>🪪 ID Verification Threshold</label>
                <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 10px" }}>
                  Wugi Door staff will be required to scan guest ID for transactions at or above this amount.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  {[{ label: "Always", value: 0 }, { label: "Never", value: -1 }].map(opt => (
                    <button key={opt.label} type="button"
                      onClick={() => setForm(f => ({ ...f, idVerificationThreshold: opt.value }))}
                      style={{ padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none",
                        background: form.idVerificationThreshold === opt.value ? "#1d4ed8" : "#e0e7ff",
                        color: form.idVerificationThreshold === opt.value ? "#fff" : "#1d4ed8" }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, color: "#374151", fontWeight: 500 }}>Or require over $</span>
                  <input
                    style={{ ...INPUT, width: 100 }}
                    type="number" min={0} step={1}
                    value={form.idVerificationThreshold > 0 ? (form.idVerificationThreshold / 100).toFixed(0) : ""}
                    placeholder="300"
                    onChange={e => {
                      const val = Math.round(Number(e.target.value) * 100)
                      setForm(f => ({ ...f, idVerificationThreshold: val > 0 ? val : 30000 }))
                    }}
                  />
                  <span style={{ fontSize: 12, color: "#6b7280" }}>
                    {form.idVerificationThreshold === -1 ? "— Disabled" : form.idVerificationThreshold === 0 ? "— Always required" : `— Required for $${(form.idVerificationThreshold / 100).toFixed(0)}+ transactions`}
                  </span>
                </div>
              </div>
              <div><label style={LABEL}>About</label><textarea style={{ ...INPUT, minHeight: 80, resize: "vertical" }} value={form.about} onChange={e => setForm(f => ({ ...f, about: e.target.value }))} placeholder="Describe this event..." /></div>
              <div>
                <label style={LABEL}>Vibes</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {VIBES.map(v => { const sel = form.vibes.includes(v); return <button key={v} type="button" onClick={() => setForm(f => ({ ...f, vibes: sel ? f.vibes.filter(x => x !== v) : [...f.vibes, v] }))} style={{ padding: "5px 12px", borderRadius: 20, fontSize: 13, cursor: "pointer", fontWeight: sel ? 600 : 400, background: sel ? "#111827" : "#f3f4f6", color: sel ? "#fff" : "#374151", border: `1px solid ${sel ? "#111827" : "#e5e7eb"}` }}>{v}</button> })}
                </div>
              </div>
              <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 16, display: "flex", gap: 10 }}>
                <button onClick={saveEdits} disabled={saving} style={{ padding: "10px 24px", borderRadius: 8, background: "#2a7a5a", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>{saving ? "Saving..." : "Save Changes"}</button>
                <button onClick={() => { setEditing(false); setError("") }} style={{ padding: "10px 20px", borderRadius: 8, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 14, color: "#374151" }}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Door Tab ── */}
        {tab === "door" && event.venueId && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <DoorAccessPanel scope="event" venueId={event.venueId} venueName={event.venue}
              venueLatitude={event.venueLatitude} venueLongitude={event.venueLongitude}
              eventId={eventId} eventName={event.title} eventDate={event.date} />
            <div style={{ background: "#f9fafb", borderRadius: 12, border: "1px solid #e5e7eb", padding: "14px 20px" }}>
              <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
                Venue-level PIN → <Link href={`/dashboard/venues/${event.venueId}`} style={{ color: "#2a7a5a", fontWeight: 600, textDecoration: "none" }}>{event.venue} venue page</Link>
              </p>
            </div>
          </div>
        )}
        {tab === "door" && !event.venueId && (
          <div style={{ ...CARD, textAlign: "center", color: "#9ca3af", padding: 48 }}>
            <p style={{ fontSize: 14 }}>No venue linked. Edit the event and select a venue first.</p>
          </div>
        )}

        {/* ── Ticket Tiers Tab ── */}
        {tab === "tickets" && (
          <div>
            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
                  {totalSold} sold · <strong style={{ color: "#111827" }}>${(totalRevenue / 100).toFixed(2)}</strong> revenue
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Link href={`/dashboard/events/${eventId}/checkin`}
                  style={{ padding: "8px 16px", borderRadius: 8, background: "#f5f3ff", color: "#7c3aed", border: "1px solid #ddd6fe", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
                  ✓ Open Check-in
                </Link>
                {canWrite && (
                  <button onClick={() => setTicketModal({ form: EMPTY_TICKET })}
                    style={{ padding: "8px 18px", borderRadius: 8, background: "#111827", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                    + Add Tier
                  </button>
                )}
              </div>
            </div>

            {tickets.length === 0 ? (
              <div style={{ ...CARD, textAlign: "center", padding: 48 }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>🎟</div>
                <p style={{ fontSize: 15, fontWeight: 600, color: "#374151", margin: "0 0 6px" }}>No ticket tiers yet</p>
                <p style={{ fontSize: 14, color: "#9ca3af", margin: "0 0 20px" }}>Add a GA, VIP, or Table tier to start selling tickets.</p>
                {canWrite && <button onClick={() => setTicketModal({ form: EMPTY_TICKET })} style={{ padding: "10px 24px", borderRadius: 8, background: "#111827", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>+ Add First Tier</button>}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {tickets.map(tt => {
                  const pct = tt.capacity > 0 ? Math.round((tt.sold / tt.capacity) * 100) : 0
                  const tierColor = tt.color || "#2a7a5a"
                  return (
                    <div key={tt.id} style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", borderLeft: `5px solid ${tierColor}`, padding: 16, opacity: tt.active ? 1 : 0.6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: "#111827" }}>{tt.name}</p>
                            {!tt.active && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#f3f4f6", color: "#9ca3af", fontWeight: 600 }}>INACTIVE</span>}
                          </div>
                          <p style={{ margin: "3px 0 0", fontSize: 13, color: "#6b7280" }}>${(tt.price / 100).toFixed(2)} · {tt.capacity} capacity</p>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: 20, color: "#111827" }}>{tt.sold}</p>
                          <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>sold</p>
                        </div>
                      </div>
                      <div style={{ background: "#f3f4f6", borderRadius: 4, height: 6, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 4, width: `${pct}%`, background: pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : tierColor, transition: "width 0.3s" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                        <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>{tt.remaining} remaining · {pct}%</p>
                        {canWrite && (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => setTicketModal({ form: { name: tt.name, price: tt.price, capacity: tt.capacity, active: tt.active, color: tt.color || GROUP_COLORS[0], id: tt.id } as any })}
                              style={{ padding: "4px 12px", borderRadius: 6, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 12, color: "#374151", fontWeight: 500 }}>Edit</button>
                            <button onClick={() => deleteTicket(tt.id, tt.sold)}
                              style={{ padding: "4px 10px", borderRadius: 6, background: "#fee2e2", border: "none", cursor: "pointer", fontSize: 12, color: "#b91c1c" }}>✕</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
                <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Total revenue</span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>${(totalRevenue / 100).toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Ticket modal */}
      {ticketModal && (
        <TicketModal
          initial={ticketModal.form}
          tableGroups={tableGroups}
          soldCount={(ticketModal.form as any).id ? (tickets.find(t => t.id === (ticketModal.form as any).id)?.sold ?? 0) : 0}
          onSave={f => saveTicket(f, (ticketModal.form as any).id)}
          onClose={() => setTicketModal(null)}
        />
      )}
    </DashboardLayout>
  )
}
