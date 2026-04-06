"use client"
import { useEffect, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"

export const dynamic = 'force-dynamic'
import { collection, doc, onSnapshot, updateDoc, addDoc, serverTimestamp, getDocs } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { logAudit } from "@/lib/auditLog"
import { useAuthContext } from "@/context/AuthContext"
import DashboardLayout from "@/components/DashboardLayout"

const CARD = { background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }
const INPUT = { padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" as const }
const OVERLAY = { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }
const MODAL   = { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 680, maxHeight: "92vh", overflowY: "auto" as const, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }

const VIBES = ["High Energy","Boujee","Divey","Rooftop","Speakeasy","Late Night","Hip-Hop","R&B","Live Music","Brunch","LGBTQ+"]
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  approved: { bg: "#dcfce7", color: "#15803d" },
  pending:  { bg: "#fef9c3", color: "#a16207" },
  rejected: { bg: "#fee2e2", color: "#b91c1c" },
}

type EventItem = { id: string; title: string; venue: string; date: string; time: string; status: string; hasTickets: boolean }
type TicketType = { id: string; name: string; price: number; capacity: number; color: string }
type EventForm = { title: string; venue: string; venueId: string; date: string; time: string; age: string; about: string; status: string; hasTickets: boolean; vibes: string[]; media: string }

const EMPTY: EventForm = { title: "", venue: "", venueId: "", date: "", time: "10:00 PM", age: "21+", about: "", status: "approved", hasTickets: false, vibes: [], media: "" }
const EMPTY_TT: TicketType = { id: "", name: "", price: 0, capacity: 100, color: "#2a7a5a" }

function EventsPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { user, hasDashboardAccess, hasUserDocument, loading } = useAuthContext()
  const [events, setEvents] = useState<EventItem[]>([])
  const [venues, setVenues] = useState<{ id: string; name: string }[]>([])
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [modal, setModal] = useState<"create" | "edit" | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<EventForm>(EMPTY)
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
    if (!loading && hasUserDocument && !hasDashboardAccess) router.replace("/unauthorized")  }, [loading, user, router])

  useEffect(() => {
    if (!user) return
    const u1 = onSnapshot(collection(db, "events"), s => setEvents(s.docs.map(d => ({ id: d.id, title: d.data().title || "Untitled", venue: d.data().venue || "", date: d.data().date || "", time: d.data().time || "", status: d.data().status || "pending", hasTickets: d.data().hasTickets || false }))))
    const u2 = onSnapshot(collection(db, "venues"), s => setVenues(s.docs.map(d => ({ id: d.id, name: d.data().name || "Unnamed" })).sort((a,b) => a.name.localeCompare(b.name))))
    return () => { u1(); u2() }
  }, [user])

  useEffect(() => { if (params.get("new") === "1") openCreate() }, [params])

  function openCreate() { setForm(EMPTY); setTicketTypes([]); setEditId(null); setModal("create"); setError("") }

  async function openEdit(ev: EventItem) {
    setEditId(ev.id)
    setForm({ title: ev.title, venue: ev.venue, venueId: "", date: ev.date, time: ev.time, age: "21+", about: "", status: ev.status, hasTickets: ev.hasTickets, vibes: [], media: "" })
    const ttSnap = await getDocs(collection(db, "events", ev.id, "ticketTypes"))
    setTicketTypes(ttSnap.docs.map(d => ({ id: d.id, name: d.data().name, price: d.data().price, capacity: d.data().capacity, color: d.data().color || "#2a7a5a" })))
    setModal("edit"); setError("")
  }

  function toggleVibe(v: string) { setForm(f => ({ ...f, vibes: f.vibes.includes(v) ? f.vibes.filter(x => x !== v) : [...f.vibes, v] })) }

  async function save() {
    if (!form.title.trim()) { setError("Title is required"); return }
    setSaving(true); setError("")
    try {
      const data = { title: form.title, venue: form.venue, venueId: form.venueId, date: form.date, time: form.time, age: form.age, about: form.about, status: form.status, hasTickets: form.hasTickets, vibes: form.vibes, media: form.media ? [{ type: "image", uri: form.media }] : [], updatedAt: serverTimestamp() }
      let eventId = editId
      if (modal === "create") {
        const ref = await addDoc(collection(db, "events"), { ...data, createdAt: serverTimestamp() })
        eventId = ref.id
        await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: "created_event", targetId: ref.id, targetName: form.title })
      } else if (eventId) {
        await updateDoc(doc(db, "events", eventId), data)
        await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: "updated_event", targetId: eventId, targetName: form.title })
      }
      // Save ticket types
      if (eventId && ticketTypes.length > 0) {
        for (const tt of ticketTypes) {
          const ttData = { name: tt.name, price: tt.price, capacity: tt.capacity, color: tt.color, sold: 0, remaining: tt.capacity, active: true, updatedAt: serverTimestamp() }
          if (tt.id) await updateDoc(doc(db, "events", eventId, "ticketTypes", tt.id), ttData)
          else await addDoc(collection(db, "events", eventId, "ticketTypes"), { ...ttData, createdAt: serverTimestamp() })
        }
        await updateDoc(doc(db, "events", eventId!), { hasTickets: true })
      }
      setModal(null)
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function setStatus(id: string, title: string, status: string) {
    await updateDoc(doc(db, "events", id), { status, updatedAt: serverTimestamp() })
    await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: `${status}_event`, targetId: id, targetName: title })
  }

  const displayed = events.filter(e => (filter === "all" || e.status === filter) && (!search || e.title.toLowerCase().includes(search.toLowerCase())))

  if (loading || !user || !hasDashboardAccess) return null

  return (
    <DashboardLayout>
      <div style={{ padding: "32px 36px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Events</h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>{events.length} total events</p>
          </div>
          <button onClick={openCreate} style={{ padding: "10px 20px", borderRadius: 8, background: "#1d4ed8", color: "#fff", border: "none", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
            + Add Event
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search events..."
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, width: 200, outline: "none" }}/>
          {["all","approved","pending","rejected"].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{
              padding: "8px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: filter === s ? 600 : 400,
              background: filter === s ? "#111827" : "#fff", color: filter === s ? "#fff" : "#374151",
              border: "1px solid " + (filter === s ? "#111827" : "#e5e7eb"),
            }}>{s === "all" ? "All" : s}</button>
          ))}
        </div>

        <div style={{ ...CARD, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                {["Event","Venue","Date","Status","Tickets","Actions"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>No events found</td></tr>
              ) : displayed.map((ev, i) => {
                const sc = STATUS_COLORS[ev.status] || { bg: "#f3f4f6", color: "#6b7280" }
                return (
                  <tr key={ev.id} style={{ borderBottom: i < displayed.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                    <td style={{ padding: "12px 16px", fontWeight: 600, color: "#111827" }}>{ev.title}</td>
                    <td style={{ padding: "12px 16px", color: "#6b7280" }}>{ev.venue}</td>
                    <td style={{ padding: "12px 16px", color: "#6b7280", whiteSpace: "nowrap" }}>{ev.date} {ev.time}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: sc.bg, color: sc.color }}>{ev.status}</span>
                    </td>
                    <td style={{ padding: "12px 16px", color: ev.hasTickets ? "#2a7a5a" : "#d1d5db", fontSize: 13 }}>{ev.hasTickets ? "✓ Live" : "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => openEdit(ev)} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, background: "#f3f4f6", border: "none", cursor: "pointer", color: "#374151" }}>Edit</button>
                        {ev.status !== "approved" && <button onClick={() => setStatus(ev.id, ev.title, "approved")} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, background: "#dcfce7", border: "none", cursor: "pointer", color: "#15803d", fontWeight: 600 }}>Approve</button>}
                        {ev.status !== "rejected" && <button onClick={() => setStatus(ev.id, ev.title, "rejected")} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, background: "#fee2e2", border: "none", cursor: "pointer", color: "#b91c1c" }}>Reject</button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div style={OVERLAY} onClick={() => setModal(null)}>
          <div style={MODAL} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "24px 28px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{modal === "edit" ? "Edit Event" : "Add Event"}</h2>
              <button onClick={() => setModal(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
            </div>
            <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
              {error && <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>{error}</div>}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1/-1" }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Event Title *</label>
                  <input style={INPUT} value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} placeholder="e.g. Euphoria Fridays"/>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Venue</label>
                  <select style={INPUT} value={form.venue} onChange={e => { const v = venues.find(x => x.name === e.target.value); setForm(f => ({...f, venue: e.target.value, venueId: v?.id || ""})) }}>
                    <option value="">Select venue...</option>
                    {venues.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Status</label>
                  <select style={INPUT} value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value}))}>
                    {["pending","approved","rejected"].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Date</label>
                  <input style={INPUT} value={form.date} onChange={e => setForm(f => ({...f, date: e.target.value}))} placeholder="SAT APR 12"/>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Time</label>
                  <input style={INPUT} value={form.time} onChange={e => setForm(f => ({...f, time: e.target.value}))} placeholder="10:00 PM"/>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Age Requirement</label>
                  <select style={INPUT} value={form.age} onChange={e => setForm(f => ({...f, age: e.target.value}))}>
                    {["18+","21+","All Ages"].map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1/-1" }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Cover Image URL</label>
                  <input style={INPUT} value={form.media} onChange={e => setForm(f => ({...f, media: e.target.value}))} placeholder="https://..."/>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1/-1" }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>About</label>
                  <textarea style={{ ...INPUT, minHeight: 80, resize: "vertical" }} value={form.about} onChange={e => setForm(f => ({...f, about: e.target.value}))} placeholder="Describe this event..."/>
                </div>
              </div>

              {/* Vibes */}
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Vibes</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {VIBES.map(v => {
                    const sel = form.vibes.includes(v)
                    return <button key={v} onClick={() => toggleVibe(v)} style={{ padding: "5px 12px", borderRadius: 20, fontSize: 13, cursor: "pointer", fontWeight: sel ? 600 : 400, background: sel ? "#111827" : "#f3f4f6", color: sel ? "#fff" : "#374151", border: "1px solid " + (sel ? "#111827" : "#e5e7eb") }}>{v}</button>
                  })}
                </div>
              </div>

              {/* Ticket Types */}
              <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Ticket Types</label>
                  <button onClick={() => setTicketTypes(t => [...t, { ...EMPTY_TT, id: "" }])} style={{ padding: "5px 12px", borderRadius: 6, fontSize: 13, background: "#f3f4f6", border: "1px solid #e5e7eb", cursor: "pointer", color: "#374151" }}>+ Add Tier</button>
                </div>
                {ticketTypes.map((tt, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <input style={INPUT} placeholder="Tier name (e.g. GA)" value={tt.name} onChange={e => setTicketTypes(t => t.map((x,j) => j===i ? {...x, name: e.target.value} : x))}/>
                    <input style={INPUT} type="number" placeholder="Price (cents)" value={tt.price} onChange={e => setTicketTypes(t => t.map((x,j) => j===i ? {...x, price: Number(e.target.value)} : x))}/>
                    <input style={INPUT} type="number" placeholder="Capacity" value={tt.capacity} onChange={e => setTicketTypes(t => t.map((x,j) => j===i ? {...x, capacity: Number(e.target.value)} : x))}/>
                    <button onClick={() => setTicketTypes(t => t.filter((_,j) => j !== i))} style={{ padding: "8px 10px", borderRadius: 6, background: "#fee2e2", border: "none", cursor: "pointer", color: "#b91c1c", fontWeight: 700 }}>×</button>
                  </div>
                ))}
                {ticketTypes.length === 0 && <p style={{ fontSize: 13, color: "#9ca3af" }}>No ticket types yet. Click "+ Add Tier" to add GA, VIP, etc.</p>}
              </div>
            </div>
            <div style={{ padding: "16px 28px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setModal(null)} style={{ padding: "10px 20px", borderRadius: 8, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 14 }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding: "10px 24px", borderRadius: 8, background: "#1d4ed8", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Saving..." : modal === "edit" ? "Save Changes" : "Create Event"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

export default function EventsPage() {
  return (
    <Suspense fallback={null}>
      <EventsPageInner />
    </Suspense>
  )
}
