"use client"
import { useEffect, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
export const dynamic = 'force-dynamic'
import { collection, doc, onSnapshot, updateDoc, addDoc, serverTimestamp, getDocs, getDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { logAudit } from "@/lib/auditLog"
import { useAuthContext } from "@/context/AuthContext"
import DashboardLayout from "@/components/DashboardLayout"
import DatePicker from "@/components/DatePicker"
import TimePicker from "@/components/TimePicker"
import SearchSelect from "@/components/SearchSelect"
import type { SelectOption } from "@/components/SearchSelect"
import { useVenueFilter } from "@/hooks/useVenueFilter"

const INPUT = { padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" as const }
const OVERLAY = { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }
const MODAL = { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 680, maxHeight: "92vh", overflowY: "auto" as const, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }
const VIBES = ["High Energy","Boujee","Divey","Rooftop","Speakeasy","Late Night","Hip-Hop","R&B","Live Music","Brunch","LGBTQ+"]
const SC: Record<string,{bg:string;color:string}> = { approved:{bg:"#dcfce7",color:"#15803d"}, pending:{bg:"#fef9c3",color:"#a16207"}, rejected:{bg:"#fee2e2",color:"#b91c1c"} }

type EventItem = { id:string; title:string; venue:string; date:string; time:string; status:string; hasTickets:boolean }
type TicketType = { id:string; name:string; price:number; capacity:number; tableCapacity:number|null; isFree:boolean; maxPerOrder:number|null; status:string }
type EF = { title:string; venue:string; venueId:string; date:string; time:string; age:string; about:string; status:string; vibes:string[]; media:string }
const EMPTY: EF = { title:"", venue:"", venueId:"", date:"", time:"10:00 PM", age:"21+", about:"", status:"approved", vibes:[], media:"" }

function EventsPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { user, hasDashboardAccess, hasUserDocument, loading, canWrite } = useAuthContext()
  const { venueIds, eventIds } = useVenueFilter()
  const [events, setEvents] = useState<EventItem[]>([])
  const [venueOptions, setVenueOptions] = useState<SelectOption[]>([])
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [modal, setModal] = useState<"create"|"edit"|null>(null)
  const [editId, setEditId] = useState<string|null>(null)
  const [form, setForm] = useState<EF>(EMPTY)
  const [origMedia, setOrigMedia] = useState<{type?:string; uri?:string}[]>([])
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
    if (hasUserDocument && !hasDashboardAccess) router.replace("/unauthorized")
  }, [loading, user, hasDashboardAccess, hasUserDocument, router])

  useEffect(() => {
    if (!user) return
    const u1 = onSnapshot(collection(db, "events"), s => {
      let all = s.docs.map(d => ({ id:d.id, title:d.data().title||"Untitled", venue:d.data().venue||"", venueId:d.data().venueId||"", date:d.data().date||"", time:d.data().time||"", status:d.data().status||"pending", hasTickets:d.data().hasTickets||false }))
      // Scope by venueIds (venue_admin/staff) or eventIds (event_admin/staff)
      if (venueIds !== null) all = all.filter(e => venueIds.includes(e.venueId))
      if (eventIds !== null) all = all.filter(e => eventIds.includes(e.id))
      setEvents(all)
    })
    const u2 = onSnapshot(collection(db, "venues"), s => {
      let opts = s.docs.map(d => ({ id:d.id, label:d.data().name||"Unnamed", sub:d.data().neighborhood||d.data().category||"" })).sort((a,b)=>a.label.localeCompare(b.label))
      // Scope venue picker to only venues this user can access
      if (venueIds !== null) opts = opts.filter(v => venueIds.includes(v.id))
      setVenueOptions(opts)
    })
    return () => { u1(); u2() }
  }, [user, venueIds, eventIds])

  useEffect(() => { if (params.get("new")==="1") openCreate() }, [params])

  function openCreate() { setForm(EMPTY); setOrigMedia([]); setTicketTypes([]); setEditId(null); setModal("create"); setError("") }
  async function openEdit(ev: EventItem) {
    setEditId(ev.id)
    // Load the FULL doc — the list only carries a thin projection. Filling the
    // form with blanks here made every edit wipe venueId/age/about/vibes/media
    // on save (and detach the event from its venue).
    const full = await getDoc(doc(db, "events", ev.id))
    const d: any = full.exists() ? full.data() : {}
    const mediaArr = Array.isArray(d.media) ? d.media : []
    setOrigMedia(mediaArr)
    setForm({
      title: d.title ?? ev.title, venue: d.venue ?? ev.venue, venueId: d.venueId || "",
      date: d.date ?? ev.date, time: d.time ?? ev.time, age: d.age || "21+",
      about: d.about || "", status: d.status ?? ev.status, vibes: d.vibes || [],
      media: mediaArr[0]?.uri || "",
    })
    const snap = await getDocs(collection(db,"events",ev.id,"ticketTypes"))
    setTicketTypes(snap.docs.map(d => ({ id:d.id, name:d.data().name, price:d.data().price, capacity:d.data().capacity, tableCapacity:d.data().tableCapacity||null, isFree:d.data().isFree||false, maxPerOrder:d.data().maxPerOrder||null, status:d.data().status||"on_sale" })))
    setModal("edit"); setError("")
  }

  async function save() {
    if (!form.title.trim()) { setError("Title is required"); return }
    setSaving(true); setError("")
    try {
      // Keep a multi-image media array intact when the cover URL is unchanged.
      const media = form.media
        ? (form.media === origMedia[0]?.uri && origMedia.length ? origMedia : [{ type:"image", uri:form.media }])
        : []
      const data = { title:form.title, venue:form.venue, venueId:form.venueId, date:form.date, time:form.time, age:form.age, about:form.about, status:form.status, vibes:form.vibes, media, updatedAt:serverTimestamp() }
      let evId = editId
      if (modal==="create") {
        const ref = await addDoc(collection(db,"events"), { ...data, createdAt:serverTimestamp() })
        evId = ref.id
        await logAudit({ adminId:user!.uid, adminEmail:user!.email!, action:"created_event", targetId:ref.id, targetName:form.title })
      } else if (evId) {
        await updateDoc(doc(db,"events",evId), data)
        await logAudit({ adminId:user!.uid, adminEmail:user!.email!, action:"updated_event", targetId:evId, targetName:form.title })
      }
      if (evId && ticketTypes.length > 0) {
        for (const tt of ticketTypes) {
        const ttd = { name:tt.name, price:tt.isFree?0:tt.price, capacity:tt.capacity, sold:0, remaining:tt.capacity, active:true, isFree:tt.isFree||false, maxPerOrder:tt.maxPerOrder||null, tableCapacity:tt.tableCapacity||null, status:tt.status||"on_sale", updatedAt:serverTimestamp() }
          if (tt.id) await updateDoc(doc(db,"events",evId,"ticketTypes",tt.id), ttd)
          else await addDoc(collection(db,"events",evId,"ticketTypes"), { ...ttd, createdAt:serverTimestamp() })
        }
        await updateDoc(doc(db,"events",evId!), { hasTickets:true })
      }
      setModal(null)
    } catch(e:any) { setError(e.message) } finally { setSaving(false) }
  }

  async function setStatus(id:string, title:string, status:string) {
    await updateDoc(doc(db,"events",id), { status, updatedAt:serverTimestamp() })
    await logAudit({ adminId:user!.uid, adminEmail:user!.email!, action:`${status}_event`, targetId:id, targetName:title })
  }

  const displayed = events.filter(e => (filter==="all"||e.status===filter) && (!search||e.title.toLowerCase().includes(search.toLowerCase())))
  if (loading || !user || !hasDashboardAccess) return null

  return (
    <DashboardLayout>
      <div className="dash-page">
        <div className="dash-header">
          <div>
            <h1 style={{ fontSize:22, fontWeight:700, color:"#111827", margin:0 }}>Events</h1>
            <p style={{ fontSize:14, color:"#6b7280", marginTop:4 }}>{events.length} total events</p>
          </div>
          <button onClick={openCreate} style={{ padding:"10px 20px", borderRadius:8, background:"#1d4ed8", color:"#fff", border:"none", fontWeight:600, fontSize:14, cursor:"pointer" }}>+ Add Event</button>
        </div>

        <div className="dash-filters">
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search events..."
            style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #e5e7eb", fontSize:14, width:200, outline:"none" }}/>
          {["all","approved","pending","rejected"].map(s => (
            <button key={s} onClick={()=>setFilter(s)} style={{ padding:"8px 14px", borderRadius:8, fontSize:13, cursor:"pointer", fontWeight:filter===s?600:400, background:filter===s?"#111827":"#fff", color:filter===s?"#fff":"#374151", border:"1px solid "+(filter===s?"#111827":"#e5e7eb") }}>{s==="all"?"All":s}</button>
          ))}
        </div>

        <div className="dash-table-wrap">
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:14, minWidth:600 }}>
            <thead><tr style={{ background:"#f9fafb", borderBottom:"1px solid #e5e7eb" }}>
              {["Event","Venue","Date","Status","Tickets","Actions"].map(h => <th key={h} style={{ padding:"12px 16px", textAlign:"left", fontWeight:600, color:"#374151", fontSize:13 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {displayed.length===0 ? <tr><td colSpan={6} style={{ padding:"40px 16px", textAlign:"center", color:"#9ca3af" }}>No events found</td></tr>
              : displayed.map((ev,i) => {
                const s = SC[ev.status]||{bg:"#f3f4f6",color:"#6b7280"}
                return <tr key={ev.id} style={{ borderBottom:i<displayed.length-1?"1px solid #f3f4f6":"none" }}>
                  <td style={{ padding:"12px 16px", fontWeight:600, color:"#111827" }}>{ev.title}</td>
                  <td style={{ padding:"12px 16px", color:"#6b7280" }}>{ev.venue}</td>
                  <td style={{ padding:"12px 16px", color:"#6b7280", whiteSpace:"nowrap" }}>{ev.date} {ev.time}</td>
                  <td style={{ padding:"12px 16px" }}><span style={{ padding:"3px 10px", borderRadius:20, fontSize:12, fontWeight:600, background:s.bg, color:s.color }}>{ev.status}</span></td>
                  <td style={{ padding:"12px 16px", color:ev.hasTickets?"#2a7a5a":"#d1d5db", fontSize:13 }}>{ev.hasTickets?"✓ Live":"—"}</td>
                  <td style={{ padding:"12px 16px" }}>
                    <div style={{ display:"flex", gap:6 }}>
                      <button onClick={()=>router.push(`/dashboard/events/${ev.id}`)} style={{ padding:"5px 10px", borderRadius:6, fontSize:12, background:"#f3f4f6", border:"none", cursor:"pointer", color:"#374151" }}>Edit</button>
                      {ev.status!=="approved" && <button onClick={()=>setStatus(ev.id,ev.title,"approved")} style={{ padding:"5px 10px", borderRadius:6, fontSize:12, background:"#dcfce7", border:"none", cursor:"pointer", color:"#15803d", fontWeight:600 }}>Approve</button>}
                      {ev.status!=="rejected" && <button onClick={()=>setStatus(ev.id,ev.title,"rejected")} style={{ padding:"5px 10px", borderRadius:6, fontSize:12, background:"#fee2e2", border:"none", cursor:"pointer", color:"#b91c1c" }}>Reject</button>}
                    </div>
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div style={OVERLAY} onClick={()=>setModal(null)}>
          <div style={MODAL} onClick={e=>e.stopPropagation()}>
            <div style={{ padding:"24px 28px", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <h2 style={{ margin:0, fontSize:18, fontWeight:700 }}>{modal==="edit"?"Edit Event":"Add Event"}</h2>
              <button onClick={()=>setModal(null)} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#9ca3af" }}>×</button>
            </div>
            <div style={{ padding:"24px 28px", display:"flex", flexDirection:"column", gap:16 }}>
              {error && <div style={{ padding:"10px 14px", background:"#fee2e2", borderRadius:8, color:"#b91c1c", fontSize:13 }}>{error}</div>}

              {/* Title */}
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Event Title *</label>
                <input style={INPUT} value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Euphoria Fridays"/>
              </div>

              {/* Venue search */}
              <SearchSelect
                label="Venue"
                value={form.venueId}
                options={venueOptions}
                placeholder="Search venues..."
                onChange={(id,label)=>setForm(f=>({...f,venueId:id,venue:label}))}
              />

              {/* Date + Time */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                <DatePicker label="Date" value={form.date} onChange={v=>setForm(f=>({...f,date:v}))} placeholder="Pick a date"/>
                <TimePicker label="Time" value={form.time} onChange={v=>setForm(f=>({...f,time:v}))}/>
              </div>

              {/* Status + Age */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Status</label>
                  <select style={INPUT} value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                    {["pending","approved","rejected"].map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Age Requirement</label>
                  <select style={INPUT} value={form.age} onChange={e=>setForm(f=>({...f,age:e.target.value}))}>
                    {["18+","21+","All Ages"].map(a=><option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              {/* Cover + About */}
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Cover Image URL</label>
                <input style={INPUT} value={form.media} onChange={e=>setForm(f=>({...f,media:e.target.value}))} placeholder="https://..."/>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>About</label>
                <textarea style={{ ...INPUT, minHeight:80, resize:"vertical" }} value={form.about} onChange={e=>setForm(f=>({...f,about:e.target.value}))} placeholder="Describe this event..."/>
              </div>

              {/* Vibes */}
              <div>
                <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Vibes</label>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:8 }}>
                  {VIBES.map(v => {
                    const sel = form.vibes.includes(v)
                    return <button key={v} type="button" onClick={()=>setForm(f=>({...f,vibes:sel?f.vibes.filter(x=>x!==v):[...f.vibes,v]}))}
                      style={{ padding:"5px 12px", borderRadius:20, fontSize:13, cursor:"pointer", fontWeight:sel?600:400, background:sel?"#111827":"#f3f4f6", color:sel?"#fff":"#374151", border:"1px solid "+(sel?"#111827":"#e5e7eb") }}>{v}</button>
                  })}
                </div>
              </div>

              {/* Ticket tiers */}
              <div style={{ borderTop:"1px solid #f3f4f6", paddingTop:16 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Ticket Tiers</label>
                  <button type="button" onClick={()=>setTicketTypes(t=>[...t,{id:"",name:"",price:0,capacity:100,tableCapacity:null,isFree:false,maxPerOrder:null,status:"on_sale"}])}
                    style={{ padding:"5px 12px", borderRadius:6, fontSize:13, background:"#f3f4f6", border:"1px solid #e5e7eb", cursor:"pointer", color:"#374151" }}>+ Add Tier</button>
                </div>
                {ticketTypes.map((tt,i) => (
                  <div key={i} style={{ background:"#f9fafb", borderRadius:10, border:"1px solid #e5e7eb", padding:"12px 14px", marginBottom:10 }}>
                    {/* Row 1: Name + Status + Remove */}
                    <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr auto", gap:8, marginBottom:8 }}>
                      <input style={INPUT} placeholder="Tier name (GA, VIP Table…)" value={tt.name}
                        onChange={e=>setTicketTypes(t=>t.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/>
                      <select style={INPUT} value={tt.status}
                        onChange={e=>setTicketTypes(t=>t.map((x,j)=>j===i?{...x,status:e.target.value}:x))}>
                        {["on_sale","sold_out","cancelled"].map(s=><option key={s} value={s}>{s}</option>)}
                      </select>
                      <button type="button" onClick={()=>setTicketTypes(t=>t.filter((_,j)=>j!==i))}
                        style={{ padding:"8px 10px", borderRadius:6, background:"#fee2e2", border:"none", cursor:"pointer", color:"#b91c1c", fontWeight:700 }}>×</button>
                    </div>
                    {/* Row 2: Price + Total qty + Max per order */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:8 }}>
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#6b7280", display:"block", marginBottom:3 }}>Price (cents)</label>
                        <input style={{ ...INPUT, opacity:tt.isFree?0.4:1 }} type="number" placeholder="e.g. 5000" value={tt.price} disabled={tt.isFree}
                          onChange={e=>setTicketTypes(t=>t.map((x,j)=>j===i?{...x,price:Number(e.target.value)}:x))}/>
                      </div>
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#6b7280", display:"block", marginBottom:3 }}>Total capacity</label>
                        <input style={INPUT} type="number" placeholder="e.g. 200" value={tt.capacity}
                          onChange={e=>setTicketTypes(t=>t.map((x,j)=>j===i?{...x,capacity:Number(e.target.value)}:x))}/>
                      </div>
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#6b7280", display:"block", marginBottom:3 }}>Max per order</label>
                        <input style={INPUT} type="number" placeholder="e.g. 10" value={tt.maxPerOrder??""} 
                          onChange={e=>setTicketTypes(t=>t.map((x,j)=>j===i?{...x,maxPerOrder:e.target.value?Number(e.target.value):null}:x))}/>
                      </div>
                    </div>
                    {/* Row 3: Table capacity + Free toggle */}
                    <div style={{ display:"flex", gap:16, alignItems:"center", flexWrap:"wrap" }}>
                      <div style={{ flex:1, minWidth:140 }}>
                        <label style={{ fontSize:11, fontWeight:600, color:"#6b7280", display:"block", marginBottom:3 }}>
                          Table capacity <span style={{ color:"#2a7a5a" }}>(VIP tables only)</span>
                        </label>
                        <input style={INPUT} type="number" placeholder="e.g. 10 (locks qty at checkout)"
                          value={tt.tableCapacity??""} 
                          onChange={e=>setTicketTypes(t=>t.map((x,j)=>j===i?{...x,tableCapacity:e.target.value?Number(e.target.value):null}:x))}/>
                      </div>
                      <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:13, color:"#374151", userSelect:"none" as const }}>
                        <input type="checkbox" checked={tt.isFree}
                          onChange={e=>setTicketTypes(t=>t.map((x,j)=>j===i?{...x,isFree:e.target.checked,price:e.target.checked?0:x.price}:x))}
                          style={{ width:15, height:15 }}/>
                        Free ticket
                      </label>
                    </div>
                    {tt.tableCapacity && tt.tableCapacity > 1 && (
                      <p style={{ fontSize:11, color:"#2a7a5a", marginTop:6, marginBottom:0 }}>
                        🪑 Table package — 1 purchaser pass + {tt.tableCapacity-1} shareable guest passes per purchase
                      </p>
                    )}
                  </div>
                ))}
                {ticketTypes.length===0 && <p style={{ fontSize:13, color:"#9ca3af" }}>No tiers yet. Add GA, VIP, Table tiers above.</p>}
              </div>
            </div>
            <div style={{ padding:"16px 28px", borderTop:"1px solid #f3f4f6", display:"flex", justifyContent:"flex-end", gap:10 }}>
              <button onClick={()=>setModal(null)} style={{ padding:"10px 20px", borderRadius:8, background:"#f3f4f6", border:"none", cursor:"pointer", fontSize:14 }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding:"10px 24px", borderRadius:8, background:"#1d4ed8", color:"#fff", border:"none", cursor:"pointer", fontSize:14, fontWeight:600, opacity:saving?0.7:1 }}>
                {saving?"Saving...":modal==="edit"?"Save Changes":"Create Event"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

export default function EventsPage() {
  return <Suspense fallback={null}><EventsPageInner/></Suspense>
}
