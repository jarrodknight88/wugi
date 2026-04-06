"use client"
import DashboardLayout from "@/components/DashboardLayout"
import SearchSelect from "@/components/SearchSelect"
import DatePicker from "@/components/DatePicker"
import TimePicker from "@/components/TimePicker"
import type { SelectOption } from "@/components/SearchSelect"
import { useAuthContext } from "@/context/AuthContext"
import { useVenueFilter } from "@/hooks/useVenueFilter"
import { useEffect, useState } from "react"
import { collection, doc, onSnapshot, addDoc, updateDoc, serverTimestamp } from "firebase/firestore"
import { getFunctions, httpsCallable } from "firebase/functions"
import { db } from "@/lib/firebase"
import { useRouter } from "next/navigation"

type Series = {
  id: string; name: string; venueId: string; venueName: string
  day: string; frequency: string; time: string; age: string
  about: string; vibes: string[]; status: string; coverImage: string
  startDate: string; endDate: string; promoterId: string
  totalGenerated: number; lastGenerated: any
}
type SF = Omit<Series, 'id' | 'totalGenerated' | 'lastGenerated'>

const EMPTY: SF = {
  name:"", venueId:"", venueName:"", day:"friday", frequency:"weekly",
  time:"10:00 PM", age:"21+", about:"", vibes:[], status:"active",
  coverImage:"", startDate:"", endDate:"", promoterId:"",
}

const DAYS    = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]
const FREQS   = ["weekly","biweekly","monthly"]
const VIBES   = ["High Energy","Boujee","Divey","Rooftop","Speakeasy","Late Night","Hip-Hop","R&B","Live Music","Brunch","LGBTQ+"]
const INPUT: React.CSSProperties = { padding:"9px 12px", borderRadius:8, border:"1px solid #e5e7eb", fontSize:14, outline:"none", width:"100%", boxSizing:"border-box" }
const CARD: React.CSSProperties  = { background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", boxShadow:"0 1px 3px rgba(0,0,0,0.06)", overflow:"hidden" }

export default function SeriesPage() {
  const router = useRouter()
  const { user, loading, hasDashboardAccess, canWrite } = useAuthContext()
  const { venueIds } = useVenueFilter()
  const [series, setSeries]       = useState<Series[]>([])
  const [venueOpts, setVenueOpts] = useState<SelectOption[]>([])
  const [modal, setModal]         = useState(false)
  const [editId, setEditId]       = useState<string|null>(null)
  const [form, setForm]           = useState<SF>(EMPTY)
  const [saving, setSaving]       = useState(false)
  const [generating, setGenerating] = useState<string|null>(null)
  const [error, setError]         = useState("")

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
  }, [loading, user, router])

  useEffect(() => {
    if (!user) return
    const u1 = onSnapshot(collection(db, "eventSeries"), s => {
      let all = s.docs.map(d => ({ id:d.id, ...d.data() } as Series))
      if (venueIds !== null) all = all.filter(s => venueIds.includes(s.venueId))
      setSeries(all)
    })
    const u2 = onSnapshot(collection(db, "venues"), s => {
      let opts = s.docs.map(d => ({ id:d.id, label:d.data().name||"Unnamed", sub:d.data().neighborhood||"" })).sort((a,b)=>a.label.localeCompare(b.label))
      if (venueIds !== null) opts = opts.filter(v => venueIds.includes(v.id))
      setVenueOpts(opts)
    })
    return () => { u1(); u2() }
  }, [user, venueIds])

  function openCreate() { setForm(EMPTY); setEditId(null); setModal(true); setError("") }
  function openEdit(s: Series) {
    setForm({ name:s.name, venueId:s.venueId, venueName:s.venueName, day:s.day, frequency:s.frequency, time:s.time, age:s.age, about:s.about, vibes:s.vibes||[], status:s.status, coverImage:s.coverImage||"", startDate:s.startDate||"", endDate:s.endDate||"", promoterId:s.promoterId||"" })
    setEditId(s.id); setModal(true); setError("")
  }

  async function save() {
    if (!form.name.trim()) { setError("Series name required"); return }
    if (!form.venueId)     { setError("Venue required"); return }
    setSaving(true); setError("")
    try {
      const data = { ...form, updatedAt: serverTimestamp() }
      if (editId) {
        await updateDoc(doc(db, "eventSeries", editId), data)
      } else {
        const ref = await addDoc(collection(db, "eventSeries"), { ...data, totalGenerated:0, createdAt: serverTimestamp() })
        // Auto-generate first 8 weeks on create
        const fn = httpsCallable(getFunctions(), "generateSeriesEvents")
        await fn({ seriesId: ref.id, weeksAhead: 8 })
      }
      setModal(false)
    } catch(e:any) { setError(e.message) } finally { setSaving(false) }
  }

  async function generateEvents(seriesId: string) {
    setGenerating(seriesId); setError("")
    try {
      const fn = httpsCallable(getFunctions(), "generateSeriesEvents")
      const res: any = await fn({ seriesId, weeksAhead: 8 })
      alert(`Generated ${res.data.generated} new event${res.data.generated !== 1 ? "s" : ""}`)
    } catch(e:any) { setError(e.message) } finally { setGenerating(null) }
  }

  const SC: Record<string,{bg:string;color:string}> = {
    active:   { bg:"#dcfce7", color:"#15803d" },
    paused:   { bg:"#fef9c3", color:"#a16207" },
    archived: { bg:"#f3f4f6", color:"#6b7280" },
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
          {canWrite && <button onClick={openCreate} style={{ padding:"10px 20px", borderRadius:8, background:"#111827", color:"#fff", border:"none", fontWeight:600, fontSize:14, cursor:"pointer" }}>+ New Series</button>}
        </div>

        {error && <div style={{ padding:"10px 16px", background:"#fee2e2", borderRadius:8, color:"#b91c1c", fontSize:13, marginBottom:16 }}>{error}</div>}

        {series.length === 0 ? (
          <div style={{ ...CARD, padding:48, textAlign:"center" as const }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🔄</div>
            <p style={{ fontSize:15, fontWeight:600, color:"#374151", margin:"0 0 8px" }}>No series yet</p>
            <p style={{ fontSize:14, color:"#9ca3af", margin:0 }}>Create a recurring series like Fridayz ATL and the system will auto-generate weekly events.</p>
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(300px, 1fr))", gap:16 }}>
            {series.map(s => {
              const sc = SC[s.status] || SC.archived
              return (
                <div key={s.id} style={CARD}>
                  {/* Header band */}
                  <div style={{ background:"#064e3b", padding:"16px 18px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <div>
                        <p style={{ margin:0, fontSize:15, fontWeight:700, color:"#fff" }}>{s.name}</p>
                        <p style={{ margin:"2px 0 0", fontSize:12, color:"rgba(255,255,255,0.6)" }}>{s.venueName}</p>
                      </div>
                      <span style={{ padding:"2px 8px", borderRadius:20, fontSize:11, fontWeight:600, background:sc.bg, color:sc.color }}>{s.status}</span>
                    </div>
                  </div>
                  {/* Stats */}
                  <div style={{ padding:"14px 18px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <div>
                      <p style={{ fontSize:11, fontWeight:600, color:"#9ca3af", textTransform:"uppercase" as const, letterSpacing:1, margin:"0 0 2px" }}>Day</p>
                      <p style={{ fontSize:14, fontWeight:600, color:"#111827", margin:0, textTransform:"capitalize" as const }}>{s.day}</p>
                    </div>
                    <div>
                      <p style={{ fontSize:11, fontWeight:600, color:"#9ca3af", textTransform:"uppercase" as const, letterSpacing:1, margin:"0 0 2px" }}>Frequency</p>
                      <p style={{ fontSize:14, fontWeight:600, color:"#111827", margin:0, textTransform:"capitalize" as const }}>{s.frequency}</p>
                    </div>
                    <div>
                      <p style={{ fontSize:11, fontWeight:600, color:"#9ca3af", textTransform:"uppercase" as const, letterSpacing:1, margin:"0 0 2px" }}>Time</p>
                      <p style={{ fontSize:14, fontWeight:600, color:"#111827", margin:0 }}>{s.time}</p>
                    </div>
                    <div>
                      <p style={{ fontSize:11, fontWeight:600, color:"#9ca3af", textTransform:"uppercase" as const, letterSpacing:1, margin:"0 0 2px" }}>Events Generated</p>
                      <p style={{ fontSize:14, fontWeight:600, color:"#2a7a5a", margin:0 }}>{s.totalGenerated || 0}</p>
                    </div>
                  </div>
                  {/* Actions */}
                  {canWrite && (
                    <div style={{ padding:"10px 18px", borderTop:"1px solid #f3f4f6", display:"flex", gap:8 }}>
                      <button onClick={() => openEdit(s)} style={{ flex:1, padding:"7px 0", borderRadius:7, background:"#f3f4f6", border:"none", cursor:"pointer", fontSize:13, fontWeight:500, color:"#374151" }}>Edit</button>
                      <button onClick={() => generateEvents(s.id)} disabled={generating === s.id} style={{ flex:1, padding:"7px 0", borderRadius:7, background:"#064e3b", border:"none", cursor:"pointer", fontSize:13, fontWeight:600, color:"#fff", opacity:generating===s.id?0.7:1 }}>
                        {generating===s.id ? "Generating..." : "+ Generate"}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      {modal && (
        <div style={{ position:"fixed" as const, inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={() => setModal(false)}>
          <div style={{ background:"#fff", borderRadius:16, width:"100%", maxWidth:600, maxHeight:"92vh", overflowY:"auto" as const, boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }} onClick={e=>e.stopPropagation()}>
            <div style={{ padding:"22px 28px", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <h2 style={{ margin:0, fontSize:18, fontWeight:700 }}>{editId ? "Edit Series" : "New Event Series"}</h2>
              <button onClick={() => setModal(false)} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#9ca3af" }}>×</button>
            </div>
            <div style={{ padding:"22px 28px", display:"flex", flexDirection:"column" as const, gap:16 }}>
              {error && <div style={{ padding:"10px 14px", background:"#fee2e2", borderRadius:8, color:"#b91c1c", fontSize:13 }}>{error}</div>}

              <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Series Name *</label>
                <input style={INPUT} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Fridayz ATL 🔥"/>
              </div>

              <SearchSelect label="Venue *" value={form.venueId} options={venueOpts} placeholder="Search venues..."
                onChange={(id,label) => setForm(f=>({...f,venueId:id,venueName:label}))}/>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
                <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Day of Week</label>
                  <select style={INPUT} value={form.day} onChange={e=>setForm(f=>({...f,day:e.target.value}))}>
                    {DAYS.map(d=><option key={d} value={d} style={{ textTransform:"capitalize" }}>{d.charAt(0).toUpperCase()+d.slice(1)}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Frequency</label>
                  <select style={INPUT} value={form.frequency} onChange={e=>setForm(f=>({...f,frequency:e.target.value}))}>
                    {FREQS.map(f=><option key={f} value={f} style={{ textTransform:"capitalize" }}>{f.charAt(0).toUpperCase()+f.slice(1)}</option>)}
                  </select>
                </div>
                <TimePicker label="Start Time" value={form.time} onChange={v=>setForm(f=>({...f,time:v}))}/>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <DatePicker label="Start Date" value={form.startDate} onChange={v=>setForm(f=>({...f,startDate:v}))} placeholder="Series begins"/>
                <DatePicker label="End Date (optional)" value={form.endDate} onChange={v=>setForm(f=>({...f,endDate:v}))} placeholder="Leave blank for ongoing"/>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Age</label>
                  <select style={INPUT} value={form.age} onChange={e=>setForm(f=>({...f,age:e.target.value}))}>
                    {["18+","21+","All Ages"].map(a=><option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Status</label>
                  <select style={INPUT} value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                    {["active","paused","archived"].map(s=><option key={s} value={s} style={{ textTransform:"capitalize" }}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>About</label>
                <textarea style={{ ...INPUT, minHeight:70, resize:"vertical" as const }} value={form.about} onChange={e=>setForm(f=>({...f,about:e.target.value}))} placeholder="What's this series about?"/>
              </div>

              <div>
                <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Vibes</label>
                <div style={{ display:"flex", flexWrap:"wrap" as const, gap:8, marginTop:8 }}>
                  {VIBES.map(v => {
                    const sel = form.vibes.includes(v)
                    return <button key={v} type="button" onClick={()=>setForm(f=>({...f,vibes:sel?f.vibes.filter(x=>x!==v):[...f.vibes,v]}))}
                      style={{ padding:"5px 12px", borderRadius:20, fontSize:13, cursor:"pointer", fontWeight:sel?600:400, background:sel?"#111827":"#f3f4f6", color:sel?"#fff":"#374151", border:"1px solid "+(sel?"#111827":"#e5e7eb") }}>{v}</button>
                  })}
                </div>
              </div>

              {!editId && (
                <div style={{ padding:"10px 14px", background:"#f0fdf4", borderRadius:8, fontSize:13, color:"#15803d" }}>
                  ✓ Creating this series will automatically generate the next 8 weeks of events.
                </div>
              )}
            </div>
            <div style={{ padding:"16px 28px", borderTop:"1px solid #f3f4f6", display:"flex", justifyContent:"flex-end", gap:10 }}>
              <button onClick={()=>setModal(false)} style={{ padding:"10px 20px", borderRadius:8, background:"#f3f4f6", border:"none", cursor:"pointer", fontSize:14 }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding:"10px 24px", borderRadius:8, background:"#111827", color:"#fff", border:"none", cursor:"pointer", fontSize:14, fontWeight:600, opacity:saving?0.7:1 }}>
                {saving ? (editId?"Saving...":"Creating & Generating...") : (editId?"Save Changes":"Create Series")}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
