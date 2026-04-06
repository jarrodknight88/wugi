"use client"
import DashboardLayout from "@/components/DashboardLayout"
import DatePicker from "@/components/DatePicker"
import TimePicker from "@/components/TimePicker"
import SearchSelect from "@/components/SearchSelect"
import type { SelectOption } from "@/components/SearchSelect"
import { useAuthContext } from "@/context/AuthContext"
import { useVenueFilter } from "@/hooks/useVenueFilter"
import { useEffect, useState } from "react"
import { collection, doc, onSnapshot, addDoc, updateDoc, serverTimestamp } from "firebase/firestore"
import { getFunctions, httpsCallable } from "firebase/functions"
import { db } from "@/lib/firebase"
import { useRouter } from "next/navigation"
import { logAudit } from "@/lib/auditLog"

type Series = {
  id: string; name: string; venueName: string; venueId: string
  day: string; frequency: string; time: string; status: string
  startDate: string; instanceCount: number
}
type SF = {
  name: string; venueId: string; venueName: string; day: string
  frequency: string; time: string; age: string; about: string
  vibes: string[]; startDate: string; endDate: string; status: string
  promoterId: string; coverImage: string
}

const EMPTY: SF = {
  name:"", venueId:"", venueName:"", day:"friday", frequency:"weekly",
  time:"10:00 PM", age:"21+", about:"", vibes:[], startDate:"", endDate:"",
  status:"active", promoterId:"", coverImage:"",
}

const DAYS    = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"]
const FREQS   = [{ v:"weekly", l:"Weekly" },{ v:"biweekly", l:"Every 2 Weeks" },{ v:"monthly", l:"Monthly" }]
const VIBES   = ["High Energy","Boujee","Divey","Rooftop","Speakeasy","Late Night","Hip-Hop","R&B","Live Music","Brunch","LGBTQ+"]
const INPUT: React.CSSProperties = { padding:"9px 12px", borderRadius:8, border:"1px solid #e5e7eb", fontSize:14, outline:"none", width:"100%", boxSizing:"border-box" }
const SC: Record<string,{bg:string;color:string}> = { active:{bg:"#dcfce7",color:"#15803d"}, paused:{bg:"#fef9c3",color:"#a16207"}, ended:{bg:"#f3f4f6",color:"#6b7280"} }

export default function SeriesPage() {
  const router    = useRouter()
  const { user, loading, hasDashboardAccess, canWrite } = useAuthContext()
  const { venueIds } = useVenueFilter()
  const [series, setSeries]       = useState<Series[]>([])
  const [venues, setVenues]       = useState<SelectOption[]>([])
  const [eventCounts, setEventCounts] = useState<Record<string,number>>({})
  const [modal, setModal]         = useState<"create"|"edit"|null>(null)
  const [editId, setEditId]       = useState<string|null>(null)
  const [form, setForm]           = useState<SF>(EMPTY)
  const [saving, setSaving]       = useState(false)
  const [generating, setGenerating] = useState<string|null>(null)
  const [error, setError]         = useState("")

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
    if (!hasDashboardAccess) router.replace("/unauthorized")
  }, [loading, user, hasDashboardAccess, router])

  useEffect(() => {
    if (!user) return
    const u1 = onSnapshot(collection(db,"eventSeries"), s => {
      let all = s.docs.map(d => ({ id:d.id, name:d.data().name||"", venueName:d.data().venueName||"", venueId:d.data().venueId||"", day:d.data().day||"friday", frequency:d.data().frequency||"weekly", time:d.data().time||"", status:d.data().status||"active", startDate:d.data().startDate?.toDate?.()?.toLocaleDateString?.()||"", instanceCount:0 }))
      if (venueIds !== null) all = all.filter(s => venueIds.includes(s.venueId))
      setSeries(all)
    })
    const u2 = onSnapshot(collection(db,"venues"), s => {
      let opts = s.docs.map(d => ({ id:d.id, label:d.data().name||"Unnamed", sub:d.data().neighborhood||"" })).sort((a,b)=>a.label.localeCompare(b.label))
      if (venueIds !== null) opts = opts.filter(v => venueIds.includes(v.id))
      setVenues(opts)
    })
    // Count events per series
    const u3 = onSnapshot(collection(db,"events"), s => {
      const counts: Record<string,number> = {}
      s.docs.forEach(d => { const sid = d.data().seriesId; if (sid) counts[sid] = (counts[sid]||0)+1 })
      setEventCounts(counts)
    })
    return () => { u1(); u2(); u3() }
  }, [user, venueIds])

  function openCreate() { setForm(EMPTY); setEditId(null); setModal("create"); setError("") }
  function openEdit(s: Series) {
    setForm({ name:s.name, venueId:s.venueId, venueName:s.venueName, day:s.day, frequency:s.frequency, time:s.time, age:"21+", about:"", vibes:[], startDate:s.startDate, endDate:"", status:s.status, promoterId:"", coverImage:"" })
    setEditId(s.id); setModal("edit"); setError("")
  }

  async function save() {
    if (!form.name.trim() || !form.venueId) { setError("Name and venue required"); return }
    setSaving(true); setError("")
    try {
      const data = { ...form, updatedAt: serverTimestamp() }
      if (modal === "create") {
        const ref = await addDoc(collection(db,"eventSeries"), { ...data, createdAt:serverTimestamp() })
        await logAudit({ adminId:user!.uid, adminEmail:user!.email!, action:"created_series", targetId:ref.id, targetName:form.name })
        // Auto-generate first 8 weeks
        const fn = httpsCallable(getFunctions(), "generateSeriesEvents")
        await fn({ seriesId:ref.id, weeksAhead:8 })
      } else if (editId) {
        await updateDoc(doc(db,"eventSeries",editId), data)
        await logAudit({ adminId:user!.uid, adminEmail:user!.email!, action:"updated_series", targetId:editId, targetName:form.name })
      }
      setModal(null)
    } catch(e:any) { setError(e.message) } finally { setSaving(false) }
  }

  async function generateMore(seriesId: string) {
    setGenerating(seriesId)
    try {
      const fn = httpsCallable(getFunctions(), "generateSeriesEvents")
      const res: any = await fn({ seriesId, weeksAhead:8 })
      alert(`Generated ${res.data.created} new events`)
    } catch(e:any) { alert("Error: " + e.message) }
    finally { setGenerating(null) }
  }

  if (loading || !user || !hasDashboardAccess) return null

  return (
    <DashboardLayout>
      <div className="dash-page">
        <div className="dash-header">
          <div>
            <h1 style={{ fontSize:22, fontWeight:700, color:"#111827", margin:0 }}>Event Series</h1>
            <p style={{ fontSize:14, color:"#6b7280", marginTop:4 }}>{series.length} recurring series</p>
          </div>
          {canWrite && (
            <button onClick={openCreate} style={{ padding:"10px 20px", borderRadius:8, background:"#2a7a5a", color:"#fff", border:"none", fontWeight:600, fontSize:14, cursor:"pointer" }}>
              + New Series
            </button>
          )}
        </div>

        {series.length === 0 ? (
          <div style={{ background:"#fff", borderRadius:16, border:"1px solid #e5e7eb", padding:48, textAlign:"center" as const }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🔄</div>
            <p style={{ fontSize:15, fontWeight:600, color:"#374151", margin:"0 0 8px" }}>No event series yet</p>
            <p style={{ fontSize:14, color:"#9ca3af", margin:"0 0 20px" }}>Create a series and events are auto-generated on your schedule.</p>
            {canWrite && <button onClick={openCreate} style={{ padding:"10px 24px", borderRadius:8, background:"#2a7a5a", color:"#fff", border:"none", cursor:"pointer", fontSize:14, fontWeight:600 }}>Create First Series</button>}
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(300px, 1fr))", gap:16 }}>
            {series.map(s => {
              const sc = SC[s.status] || SC.active
              const count = eventCounts[s.id] || 0
              return (
                <div key={s.id} style={{ background:"#fff", borderRadius:16, border:"1px solid #e5e7eb", boxShadow:"0 1px 4px rgba(0,0,0,0.06)", overflow:"hidden" }}>
                  <div style={{ background:"#064e3b", padding:"18px 20px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <div>
                        <p style={{ margin:0, fontWeight:700, fontSize:16, color:"#fff" }}>{s.name}</p>
                        <p style={{ margin:"4px 0 0", fontSize:13, color:"rgba(255,255,255,0.7)" }}>{s.venueName}</p>
                      </div>
                      <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:sc.bg, color:sc.color, textTransform:"uppercase" as const }}>{s.status}</span>
                    </div>
                  </div>
                  <div style={{ padding:"16px 20px" }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
                      {[["Day", s.day.charAt(0).toUpperCase()+s.day.slice(1)], ["Frequency", s.frequency], ["Time", s.time], ["Events", `${count} generated`]].map(([label,val]) => (
                        <div key={label}>
                          <p style={{ margin:0, fontSize:11, fontWeight:600, color:"#9ca3af", textTransform:"uppercase" as const, letterSpacing:1 }}>{label}</p>
                          <p style={{ margin:"2px 0 0", fontSize:13, fontWeight:600, color:"#111827" }}>{val}</p>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:"flex", gap:8 }}>
                      {canWrite && <button onClick={() => openEdit(s)} style={{ flex:1, padding:"8px 0", borderRadius:8, background:"#f3f4f6", border:"none", cursor:"pointer", fontSize:13, color:"#374151", fontWeight:500 }}>Edit</button>}
                      <button onClick={() => generateMore(s.id)} disabled={generating===s.id} style={{ flex:1, padding:"8px 0", borderRadius:8, background:"#064e3b", color:"#fff", border:"none", cursor:"pointer", fontSize:13, fontWeight:600, opacity:generating===s.id?0.7:1 }}>
                        {generating===s.id?"Generating...":"+ Generate Events"}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {modal && (
        <div style={{ position:"fixed" as const, inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={()=>setModal(null)}>
          <div style={{ background:"#fff", borderRadius:16, width:"100%", maxWidth:580, maxHeight:"90vh", overflowY:"auto" as const, boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }} onClick={e=>e.stopPropagation()}>
            <div style={{ padding:"24px 28px", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <h2 style={{ margin:0, fontSize:18, fontWeight:700 }}>{modal==="edit"?"Edit Series":"New Event Series"}</h2>
              <button onClick={()=>setModal(null)} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#9ca3af" }}>×</button>
            </div>
            <div style={{ padding:"24px 28px", display:"flex", flexDirection:"column" as const, gap:16 }}>
              {error && <div style={{ padding:"10px 14px", background:"#fee2e2", borderRadius:8, color:"#b91c1c", fontSize:13 }}>{error}</div>}

              <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Series Name *</label>
                <input style={INPUT} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Fridayz ATL 🔥"/>
              </div>

              <SearchSelect label="Venue *" value={form.venueId} options={venues} placeholder="Search venues..."
                onChange={(id,label)=>setForm(f=>({...f,venueId:id,venueName:label}))}/>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Day of Week</label>
                  <select style={INPUT} value={form.day} onChange={e=>setForm(f=>({...f,day:e.target.value}))}>
                    {DAYS.map(d=><option key={d} value={d}>{d.charAt(0).toUpperCase()+d.slice(1)}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Frequency</label>
                  <select style={INPUT} value={form.frequency} onChange={e=>setForm(f=>({...f,frequency:e.target.value}))}>
                    {FREQS.map(f=><option key={f.v} value={f.v}>{f.l}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                <TimePicker label="Start Time" value={form.time} onChange={v=>setForm(f=>({...f,time:v}))}/>
                <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Age</label>
                  <select style={INPUT} value={form.age} onChange={e=>setForm(f=>({...f,age:e.target.value}))}>
                    {["18+","21+","All Ages"].map(a=><option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                <DatePicker label="Series Start Date *" value={form.startDate} onChange={v=>setForm(f=>({...f,startDate:v}))} placeholder="First occurrence"/>
                <DatePicker label="End Date (optional)" value={form.endDate} onChange={v=>setForm(f=>({...f,endDate:v}))} placeholder="Leave blank = indefinite"/>
              </div>

              <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>About</label>
                <textarea style={{ ...INPUT, minHeight:70, resize:"vertical" as const }} value={form.about} onChange={e=>setForm(f=>({...f,about:e.target.value}))} placeholder="Describe this recurring event..."/>
              </div>

              <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Status</label>
                <select style={INPUT} value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                  {["active","paused","ended"].map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Vibes</label>
                <div style={{ display:"flex", flexWrap:"wrap" as const, gap:8, marginTop:8 }}>
                  {VIBES.map(v=>{
                    const sel=form.vibes.includes(v)
                    return <button key={v} type="button" onClick={()=>setForm(f=>({...f,vibes:sel?f.vibes.filter(x=>x!==v):[...f.vibes,v]}))}
                      style={{ padding:"5px 12px", borderRadius:20, fontSize:13, cursor:"pointer", fontWeight:sel?600:400, background:sel?"#111827":"#f3f4f6", color:sel?"#fff":"#374151", border:"1px solid "+(sel?"#111827":"#e5e7eb") }}>{v}</button>
                  })}
                </div>
              </div>

              {modal==="create" && (
                <div style={{ background:"#f0fdf4", borderRadius:8, padding:"12px 14px", fontSize:13, color:"#065f46" }}>
                  ✓ Creating this series will automatically generate the next 8 event instances.
                </div>
              )}
            </div>
            <div style={{ padding:"16px 28px", borderTop:"1px solid #f3f4f6", display:"flex", justifyContent:"flex-end", gap:10 }}>
              <button onClick={()=>setModal(null)} style={{ padding:"10px 20px", borderRadius:8, background:"#f3f4f6", border:"none", cursor:"pointer", fontSize:14 }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding:"10px 24px", borderRadius:8, background:"#2a7a5a", color:"#fff", border:"none", cursor:"pointer", fontSize:14, fontWeight:600, opacity:saving?0.7:1 }}>
                {saving?"Saving...":modal==="edit"?"Save Changes":"Create Series"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
