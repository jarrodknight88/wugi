"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { doc, onSnapshot, collection, updateDoc, addDoc, serverTimestamp, getDocs } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"
import DashboardLayout from "@/components/DashboardLayout"
import DoorAccessPanel from "@/components/DoorAccessPanel"
import DatePicker from "@/components/DatePicker"
import TimePicker from "@/components/TimePicker"
import SearchSelect from "@/components/SearchSelect"
import type { SelectOption } from "@/components/SearchSelect"
import Link from "next/link"

type EventDoc = {
  id: string; title: string; venue: string; venueId: string; date: string
  time: string; age: string; about: string; status: string; hasTickets: boolean
  venueLatitude?: number; venueLongitude?: number; vibes?: string[]
}
type TicketType = { id: string; name: string; price: number; capacity: number; sold: number; remaining: number; active: boolean }
type EditForm  = { title: string; venue: string; venueId: string; date: string; time: string; age: string; about: string; status: string; vibes: string[] }

const CARD: React.CSSProperties = { background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: 24 }
const INPUT: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" }
const SC: Record<string,{bg:string;color:string}> = { approved:{bg:"#dcfce7",color:"#15803d"}, pending:{bg:"#fef9c3",color:"#a16207"}, rejected:{bg:"#fee2e2",color:"#b91c1c"} }
const VIBES = ["High Energy","Boujee","Divey","Rooftop","Speakeasy","Late Night","Hip-Hop","R&B","Live Music","Brunch","LGBTQ+"]

export default function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const router   = useRouter()
  const { user, loading, hasDashboardAccess } = useAuthContext()
  const [eventId, setEventId]   = useState("")
  const [event, setEvent]       = useState<EventDoc | null>(null)
  const [tickets, setTickets]   = useState<TicketType[]>([])
  const [venueOpts, setVenueOpts] = useState<SelectOption[]>([])
  const [tab, setTab]           = useState<"info"|"door"|"tickets">("info")
  const [editing, setEditing]   = useState(false)
  const [form, setForm]         = useState<EditForm>({ title:"", venue:"", venueId:"", date:"", time:"", age:"21+", about:"", status:"approved", vibes:[] })
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState("")

  useEffect(() => { params.then(p => setEventId(p.eventId)) }, [params])

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
  }, [loading, user, router])

  useEffect(() => {
    if (!eventId) return
    const u1 = onSnapshot(doc(db, "events", eventId), snap => {
      if (!snap.exists()) return
      const d = snap.data()!
      const ev: EventDoc = {
        id: snap.id, title: d.title||"", venue: d.venue||"", venueId: d.venueId||"",
        date: d.date||"", time: d.time||"", age: d.age||"21+", about: d.about||"",
        status: d.status||"pending", hasTickets: d.hasTickets||false,
        venueLatitude: d.venueLatitude, venueLongitude: d.venueLongitude, vibes: d.vibes||[],
      }
      setEvent(ev)
      setForm({ title:ev.title, venue:ev.venue, venueId:ev.venueId, date:ev.date, time:ev.time, age:ev.age, about:ev.about, status:ev.status, vibes:ev.vibes||[] })
    })
    const u2 = onSnapshot(collection(db, "events", eventId, "ticketTypes"), snap =>
      setTickets(snap.docs.map(d => ({ id:d.id, name:d.data().name, price:d.data().price, capacity:d.data().capacity, sold:d.data().sold||0, remaining:d.data().remaining||d.data().capacity, active:d.data().active!==false })))
    )
    const u3 = onSnapshot(collection(db, "venues"), snap =>
      setVenueOpts(snap.docs.map(d => ({ id:d.id, label:d.data().name||"Unnamed", sub:d.data().neighborhood||"" })).sort((a,b)=>a.label.localeCompare(b.label)))
    )
    return () => { u1(); u2(); u3() }
  }, [eventId])

  async function saveEdits() {
    if (!form.title.trim()) { setError("Title is required"); return }
    setSaving(true); setError("")
    try {
      await updateDoc(doc(db,"events",eventId), { ...form, updatedAt: serverTimestamp() })
      setSaved(true); setEditing(false)
      setTimeout(() => setSaved(false), 2000)
    } catch(e:any) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function setStatus(status: string) {
    await updateDoc(doc(db,"events",eventId), { status, updatedAt: serverTimestamp() })
  }

  if (loading || !user || !hasDashboardAccess) return null
  if (!event) return <DashboardLayout><div className="dash-page" style={{ color:"#9ca3af" }}>Loading event...</div></DashboardLayout>

  const sc   = SC[event.status] || { bg:"#f3f4f6", color:"#6b7280" }
  const TABS = [{ key:"info", label:"Event Info" }, { key:"door", label:"Door Access" }, { key:"tickets", label:"Ticket Tiers" }] as const

  return (
    <DashboardLayout>
      <div className="dash-page">
        {/* Back + header */}
        <div style={{ marginBottom: 24 }}>
          <Link href="/dashboard/events" style={{ fontSize:13, color:"#6b7280", textDecoration:"none", display:"inline-flex", alignItems:"center", gap:4, marginBottom:8 }}>← All Events</Link>
          <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
            <h1 style={{ fontSize:22, fontWeight:700, color:"#111827", margin:0 }}>{event.title}</h1>
            <span style={{ padding:"3px 10px", borderRadius:20, fontSize:12, fontWeight:600, background:sc.bg, color:sc.color }}>{event.status}</span>
            {saved && <span style={{ fontSize:13, color:"#15803d", fontWeight:600 }}>✓ Saved!</span>}
          </div>
          <p style={{ fontSize:14, color:"#6b7280", marginTop:4 }}>{event.venue} · {event.date} {event.time}</p>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:4, marginBottom:24, borderBottom:"1px solid #e5e7eb" }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setEditing(false) }} style={{
              padding:"10px 18px", border:"none", cursor:"pointer", fontSize:14,
              fontWeight:tab===t.key?600:400, background:"transparent",
              color:tab===t.key?"#111827":"#6b7280",
              borderBottom:tab===t.key?"2px solid #111827":"2px solid transparent", marginBottom:-1,
            }}>{t.label}</button>
          ))}
        </div>

        {/* ── Info Tab: VIEW mode ── */}
        {tab==="info" && !editing && (
          <div style={CARD}>
            <div style={{ display:"grid", gap:16 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                {[["Venue", event.venue||"—"], ["Date & Time", `${event.date} · ${event.time}`], ["Age", event.age], ["Tickets", event.hasTickets?"✓ Live":"Not selling"]].map(([label, val]) => (
                  <div key={label}>
                    <p style={{ fontSize:11, fontWeight:600, color:"#9ca3af", textTransform:"uppercase" as const, letterSpacing:1, margin:"0 0 4px" }}>{label}</p>
                    <p style={{ fontSize:14, color: label==="Tickets" && event.hasTickets ? "#15803d" : "#111827", margin:0, fontWeight:500 }}>{val}</p>
                  </div>
                ))}
              </div>
              {event.about && (
                <div>
                  <p style={{ fontSize:11, fontWeight:600, color:"#9ca3af", textTransform:"uppercase" as const, letterSpacing:1, margin:"0 0 6px" }}>About</p>
                  <p style={{ fontSize:14, color:"#374151", margin:0, lineHeight:1.6 }}>{event.about}</p>
                </div>
              )}
              {(event.vibes||[]).length > 0 && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {(event.vibes||[]).map(v => <span key={v} style={{ padding:"3px 10px", borderRadius:20, fontSize:12, background:"#f3f4f6", color:"#374151" }}>{v}</span>)}
                </div>
              )}
              <div style={{ borderTop:"1px solid #f3f4f6", paddingTop:16, display:"flex", gap:8, flexWrap:"wrap" }}>
                <button onClick={() => setEditing(true)} style={{ padding:"9px 20px", borderRadius:8, background:"#111827", color:"#fff", border:"none", cursor:"pointer", fontSize:13, fontWeight:600 }}>Edit Event</button>
                {event.status!=="approved" && <button onClick={() => setStatus("approved")} style={{ padding:"9px 20px", borderRadius:8, background:"#dcfce7", color:"#15803d", border:"none", cursor:"pointer", fontSize:13, fontWeight:600 }}>Approve</button>}
                {event.status!=="rejected" && <button onClick={() => setStatus("rejected")} style={{ padding:"9px 20px", borderRadius:8, background:"#fee2e2", color:"#b91c1c", border:"none", cursor:"pointer", fontSize:13 }}>Reject</button>}
              </div>
            </div>
          </div>
        )}

        {/* ── Info Tab: EDIT mode ── */}
        {tab==="info" && editing && (
          <div style={CARD}>
            {error && <div style={{ padding:"10px 14px", background:"#fee2e2", borderRadius:8, color:"#b91c1c", fontSize:13, marginBottom:16 }}>{error}</div>}
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Event Title *</label>
                <input style={INPUT} value={form.title} onChange={e => setForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Euphoria Fridays"/>
              </div>

              <SearchSelect label="Venue" value={form.venueId} options={venueOpts} placeholder="Search venues..."
                onChange={(id,label) => setForm(f=>({...f,venueId:id,venue:label}))}/>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                <DatePicker label="Date" value={form.date} onChange={v => setForm(f=>({...f,date:v}))} placeholder="Pick a date"/>
                <TimePicker label="Time" value={form.time} onChange={v => setForm(f=>({...f,time:v}))}/>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Status</label>
                  <select style={INPUT} value={form.status} onChange={e => setForm(f=>({...f,status:e.target.value}))}>
                    {["pending","approved","rejected"].map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Age</label>
                  <select style={INPUT} value={form.age} onChange={e => setForm(f=>({...f,age:e.target.value}))}>
                    {["18+","21+","All Ages"].map(a=><option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>About</label>
                <textarea style={{ ...INPUT, minHeight:80, resize:"vertical" }} value={form.about} onChange={e => setForm(f=>({...f,about:e.target.value}))} placeholder="Describe this event..."/>
              </div>

              <div>
                <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Vibes</label>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:8 }}>
                  {VIBES.map(v => {
                    const sel = form.vibes.includes(v)
                    return <button key={v} type="button" onClick={() => setForm(f=>({...f,vibes:sel?f.vibes.filter(x=>x!==v):[...f.vibes,v]}))}
                      style={{ padding:"5px 12px", borderRadius:20, fontSize:13, cursor:"pointer", fontWeight:sel?600:400, background:sel?"#111827":"#f3f4f6", color:sel?"#fff":"#374151", border:"1px solid "+(sel?"#111827":"#e5e7eb") }}>{v}</button>
                  })}
                </div>
              </div>

              <div style={{ borderTop:"1px solid #f3f4f6", paddingTop:16, display:"flex", gap:10 }}>
                <button onClick={saveEdits} disabled={saving} style={{ padding:"10px 24px", borderRadius:8, background:"#2a7a5a", color:"#fff", border:"none", cursor:"pointer", fontSize:14, fontWeight:600, opacity:saving?0.7:1 }}>
                  {saving?"Saving...":"Save Changes"}
                </button>
                <button onClick={() => { setEditing(false); setError("") }} style={{ padding:"10px 20px", borderRadius:8, background:"#f3f4f6", border:"none", cursor:"pointer", fontSize:14, color:"#374151" }}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Door Access Tab ── */}
        {tab==="door" && event.venueId && (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <DoorAccessPanel scope="event" venueId={event.venueId} venueName={event.venue}
              venueLatitude={event.venueLatitude} venueLongitude={event.venueLongitude}
              eventId={eventId} eventName={event.title} eventDate={event.date}/>
            <div style={{ background:"#f9fafb", borderRadius:12, border:"1px solid #e5e7eb", padding:"14px 20px", display:"flex", alignItems:"center", gap:10 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <p style={{ fontSize:13, color:"#6b7280", margin:0 }}>
                Venue-level PIN →{" "}
                <Link href={`/dashboard/venues/${event.venueId}`} style={{ color:"#2a7a5a", fontWeight:600, textDecoration:"none" }}>{event.venue} venue page</Link>
              </p>
            </div>
          </div>
        )}
        {tab==="door" && !event.venueId && (
          <div style={{ ...CARD, textAlign:"center", color:"#9ca3af", padding:48 }}>
            <p style={{ fontSize:14 }}>No venue linked. Edit the event and select a venue first.</p>
          </div>
        )}

        {/* ── Ticket Tiers Tab ── */}
        {tab==="tickets" && (
          <div style={CARD}>
            {tickets.length===0 ? (
              <div style={{ textAlign:"center", padding:32, color:"#9ca3af" }}>
                <div style={{ fontSize:32, marginBottom:8 }}>🎟</div>
                <p style={{ fontSize:14, margin:0 }}>No ticket tiers yet. Go to Event Info → Edit Event to add GA, VIP, or Table tiers.</p>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                {tickets.map(tt => {
                  const pct = tt.capacity>0 ? Math.round((tt.sold/tt.capacity)*100) : 0
                  return (
                    <div key={tt.id} style={{ padding:16, borderRadius:10, border:"1px solid #e5e7eb" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                        <div>
                          <p style={{ margin:"0 0 2px", fontWeight:700, fontSize:15, color:"#111827" }}>{tt.name}</p>
                          <p style={{ margin:0, fontSize:13, color:"#6b7280" }}>${(tt.price/100).toFixed(2)} · {tt.capacity} capacity</p>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <p style={{ margin:"0 0 2px", fontWeight:700, fontSize:18, color:"#111827" }}>{tt.sold}</p>
                          <p style={{ margin:0, fontSize:12, color:"#9ca3af" }}>sold</p>
                        </div>
                      </div>
                      <div style={{ background:"#f3f4f6", borderRadius:4, height:6, overflow:"hidden" }}>
                        <div style={{ height:"100%", borderRadius:4, width:`${pct}%`, background:pct>80?"#ef4444":pct>50?"#f59e0b":"#2a7a5a", transition:"width 0.3s" }}/>
                      </div>
                      <p style={{ fontSize:12, color:"#9ca3af", margin:"6px 0 0" }}>{tt.remaining} remaining · {pct}% sold</p>
                    </div>
                  )
                })}
                <div style={{ borderTop:"1px solid #f3f4f6", paddingTop:16, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Total revenue</span>
                  <span style={{ fontSize:18, fontWeight:700, color:"#111827" }}>
                    ${(tickets.reduce((sum,tt)=>sum+(tt.sold*tt.price),0)/100).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
