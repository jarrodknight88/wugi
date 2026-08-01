"use client"
import DashboardLayout from "@/components/DashboardLayout"
import SearchSelect from "@/components/SearchSelect"
import DatePicker from "@/components/DatePicker"
import TimePicker from "@/components/TimePicker"
import type { SelectOption } from "@/components/SearchSelect"
import { useAuthContext } from "@/context/AuthContext"
import { useVenueFilter } from "@/hooks/useVenueFilter"
import { useEffect, useState } from "react"
import { collection, doc, setDoc, onSnapshot, updateDoc, deleteDoc, getDocs, query, where, writeBatch, serverTimestamp } from "firebase/firestore"
import { getFunctions, httpsCallable } from "firebase/functions"
import { db } from "@/lib/firebase"
import { useRouter } from "next/navigation"
import SeriesMediaManager from "./SeriesMediaManager"
import type { SelectedMedia } from "@/lib/mediaSelection"

type Series = {
  id: string; name: string; venueId: string; venueName: string
  day: string; frequency: string; time: string; age: string
  about: string; vibes: string[]; status: string; coverImage: string
  startDate: string; endDate: string; promoterId: string
  totalGenerated: number; lastGenerated: any
  // Fields the generator (generateSeriesEvents) actually reads. Script-seeded
  // docs carry these but not name/day/frequency; docs saved here carry both.
  title?: string
  seriesSlug?: string
  recurrence?: { dayOfWeek: number; frequency: string; timezone: string }
  media?: { type?: string; uri?: string; path?: string }[]
}
// `media` is remodeled here as the full SelectedMedia[] the edit form's
// SeriesMediaManager operates on (issue #171 Bug 2) — save() flattens it
// back down to the persisted {type,uri,path?} shape.
type SF = Omit<Series, 'id' | 'totalGenerated' | 'lastGenerated' | 'media'> & { media: SelectedMedia[] }

const EMPTY: SF = {
  name:"", venueId:"", venueName:"", day:"friday", frequency:"weekly",
  time:"10:00 PM", age:"21+", about:"", vibes:[], status:"active",
  coverImage:"", startDate:"", endDate:"", promoterId:"", media:[],
}

const DAYS    = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]
const FREQS   = ["weekly","biweekly","monthly"]
const TIMEZONE = "America/New_York"
const DOW_TO_DAY = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"]
const DAY_TO_DOW: Record<string, number> = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 }
function toSlug(s: string) {
  return s.toLowerCase().replace(/['’]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}
// Day/frequency for display + edit, reading whichever schema the doc has.
function dayOf(s: Series)  { return s.day || (s.recurrence ? DOW_TO_DAY[s.recurrence.dayOfWeek] : "") }
function freqOf(s: Series) { return s.frequency || s.recurrence?.frequency || "" }
const VIBES   = ["High Energy","Boujee","Divey","Rooftop","Speakeasy","Late Night","Hip-Hop","R&B","Live Music","Brunch","LGBTQ+"]
const INPUT: React.CSSProperties = { padding:"9px 12px", borderRadius:8, border:"1px solid #e5e7eb", fontSize:14, outline:"none", width:"100%", boxSizing:"border-box" }
const CARD: React.CSSProperties  = { background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", boxShadow:"0 1px 3px rgba(0,0,0,0.06)", overflow:"hidden" }
const LABEL: React.CSSProperties = { fontSize:13, fontWeight:600, color:"#374151" }
const HINT: React.CSSProperties  = { fontSize:12, color:"#9ca3af", margin:0, lineHeight:1.5 }

function Section({ title, hint, children }: { title:string; hint?:string; children:React.ReactNode }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div>
        <p style={{ margin:0, fontSize:11, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase" as const, color:"#6b7280" }}>{title}</p>
        {hint && <p style={{ ...HINT, marginTop:3 }}>{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function Segmented({ options, value, onChange, format }: { options:string[]; value:string; onChange:(v:string)=>void; format?:(v:string)=>string }) {
  return (
    <div style={{ display:"flex", background:"#f3f4f6", borderRadius:9, padding:3, gap:2 }}>
      {options.map(o => {
        const sel = o === value
        return (
          <button key={o} type="button" onClick={() => onChange(o)}
            style={{ flex:1, padding:"7px 0", borderRadius:7, border:"none", cursor:"pointer", fontSize:13, fontWeight:sel?600:500,
              background:sel?"#fff":"transparent", color:sel?"#111827":"#6b7280", boxShadow:sel?"0 1px 2px rgba(0,0,0,0.08)":"none", transition:"all .15s" }}>
            {format ? format(o) : o}
          </button>
        )
      })}
    </div>
  )
}

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
  const [deleting, setDeleting]   = useState<string|null>(null)
  // A brand-new series has no Firestore id yet, but SeriesMediaManager's
  // browse/upload routes are keyed by seriesId — pre-allocate the doc id at
  // openCreate() so media can be added before the first Save (save() uses
  // setDoc against this same id instead of addDoc).
  const [pendingId, setPendingId] = useState<string|null>(null)
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

  function openCreate() {
    setPendingId(doc(collection(db, "eventSeries")).id)
    setForm(EMPTY); setEditId(null); setModal(true); setError("")
  }

  // Media items read off a Firestore series doc, tolerating the legacy
  // single-coverImage-only shape (pre-#171 docs, or ones a slow client still
  // saves mid-rollout) by synthesizing a one-item array from it.
  function mediaFromSeries(s: Series): SelectedMedia[] {
    if (Array.isArray(s.media) && s.media.length) {
      return s.media
        .filter((m): m is { type?: string; uri: string; path?: string } => typeof m?.uri === "string" && !!m.uri)
        .map(m => ({ uri: m.uri, type: m.type === "video" ? "video" as const : "image" as const, path: m.path }))
    }
    return s.coverImage ? [{ uri: s.coverImage, type: "image" }] : []
  }

  function openEdit(s: Series) {
    setPendingId(null)
    const media = mediaFromSeries(s)
    setForm({ name:s.name||s.title||"", venueId:s.venueId, venueName:s.venueName, day:dayOf(s)||"friday", frequency:freqOf(s)||"weekly", time:s.time, age:s.age, about:s.about, vibes:s.vibes||[], status:s.status, coverImage:media[0]?.uri||"", startDate:s.startDate||"", endDate:s.endDate||"", promoterId:s.promoterId||"", media })
    setEditId(s.id); setModal(true); setError("")
  }

  async function save() {
    if (!form.name.trim()) { setError("Series name required"); return }
    if (!form.venueId)     { setError("Venue required"); return }
    setSaving(true); setError("")
    try {
      // The generator requires recurrence + seriesSlug — without them the series
      // is skipped as invalid-recurrence and never produces events. Keep an
      // existing slug on edit: instance ids are `${seriesSlug}-YYYY-MM-DD`, so
      // changing it would break idempotent dedupe against already-generated docs.
      const existing = editId ? series.find(x => x.id === editId) : null
      const seriesSlug = existing?.seriesSlug || toSlug(`${form.name}-${form.venueName}`)
      // Full array, never collapsed to a single cover (issue #171 Bug 2) —
      // the generator (generateSeriesEvents.ts) copies this verbatim onto
      // every occurrence it creates, so only persist the fields that belong
      // in that contract; thumbUrl/rightsStatus are picker-only display aids.
      const media = form.media.map(m => ({ type: m.type, uri: m.uri, ...(m.path ? { path: m.path } : {}) }))
      const coverImage = media[0]?.uri || ""
      const data = {
        ...form,
        coverImage,
        title: form.name,   // generator instance docs read title || name
        seriesSlug,
        media,
        recurrence: { dayOfWeek: DAY_TO_DOW[form.day] ?? 5, frequency: form.frequency, timezone: TIMEZONE },
        updatedAt: serverTimestamp(),
      }
      if (editId) {
        // Deliberately does NOT retroactively push media changes onto
        // already-generated upcoming occurrences (the old single-coverImage
        // path used to batch-update those) — a full-array diff against each
        // occurrence's own media is ambiguous once occurrences can carry
        // their own custom overrides. Future-generated occurrences pick up
        // this change automatically (the generator reads `media` fresh);
        // already-generated ones keep what they have — edit those
        // individually if a specific past occurrence needs the new media.
        await updateDoc(doc(db, "eventSeries", editId), data)
      } else {
        const ref = doc(db, "eventSeries", pendingId || doc(collection(db, "eventSeries")).id)
        await setDoc(ref, { ...data, totalGenerated:0, createdAt: serverTimestamp() })
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

  async function toggleArchive(s: Series) {
    setError("")
    try {
      await updateDoc(doc(db, "eventSeries", s.id), { status: s.status === "archived" ? "active" : "archived", updatedAt: serverTimestamp() })
    } catch(e:any) { setError(e.message) }
  }

  // Deletes the series AND its upcoming occurrences (dateISO >= today).
  // Past occurrences are kept for history/galleries.
  async function deleteSeries(s: Series) {
    setError("")
    try {
      const todayISO = new Date().toISOString().slice(0, 10)
      const snap = await getDocs(query(collection(db, "events"), where("seriesId", "==", s.id)))
      const upcoming = snap.docs.filter(d => typeof d.data().dateISO === "string" && d.data().dateISO >= todayISO)
      const label = s.name || s.title || s.id
      if (!confirm(`Delete "${label}"?\n\nThis also deletes ${upcoming.length} upcoming event${upcoming.length === 1 ? "" : "s"}. Past events are kept.`)) return
      setDeleting(s.id)
      const batch = writeBatch(db)
      upcoming.forEach(d => batch.delete(d.ref))
      await batch.commit()
      await deleteDoc(doc(db, "eventSeries", s.id))
    } catch(e:any) { setError(e.message) } finally { setDeleting(null) }
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
                        <p style={{ margin:0, fontSize:15, fontWeight:700, color:"#fff" }}>{s.name || s.title}</p>
                        <p style={{ margin:"2px 0 0", fontSize:12, color:"rgba(255,255,255,0.6)" }}>{s.venueName}</p>
                      </div>
                      <span style={{ padding:"2px 8px", borderRadius:20, fontSize:11, fontWeight:600, background:sc.bg, color:sc.color }}>{s.status}</span>
                    </div>
                  </div>
                  {/* Stats */}
                  <div style={{ padding:"14px 18px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <div>
                      <p style={{ fontSize:11, fontWeight:600, color:"#9ca3af", textTransform:"uppercase" as const, letterSpacing:1, margin:"0 0 2px" }}>Day</p>
                      <p style={{ fontSize:14, fontWeight:600, color:"#111827", margin:0, textTransform:"capitalize" as const }}>{dayOf(s) || "—"}</p>
                    </div>
                    <div>
                      <p style={{ fontSize:11, fontWeight:600, color:"#9ca3af", textTransform:"uppercase" as const, letterSpacing:1, margin:"0 0 2px" }}>Frequency</p>
                      <p style={{ fontSize:14, fontWeight:600, color:"#111827", margin:0, textTransform:"capitalize" as const }}>{freqOf(s) || "—"}</p>
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
                    <div style={{ padding:"10px 18px 0", borderTop:"1px solid #f3f4f6", display:"flex", gap:8 }}>
                      <button onClick={() => openEdit(s)} style={{ flex:1, padding:"7px 0", borderRadius:7, background:"#f3f4f6", border:"none", cursor:"pointer", fontSize:13, fontWeight:500, color:"#374151" }}>Edit</button>
                      {s.status !== "archived" && (
                        <button onClick={() => generateEvents(s.id)} disabled={generating === s.id} style={{ flex:1, padding:"7px 0", borderRadius:7, background:"#064e3b", border:"none", cursor:"pointer", fontSize:13, fontWeight:600, color:"#fff", opacity:generating===s.id?0.7:1 }}>
                          {generating===s.id ? "Generating..." : "+ Generate"}
                        </button>
                      )}
                    </div>
                  )}
                  {canWrite && (
                    <div style={{ padding:"8px 18px 12px", display:"flex", gap:8 }}>
                      <button onClick={() => toggleArchive(s)} style={{ flex:1, padding:"6px 0", borderRadius:7, background:"#fff", border:"1px solid #e5e7eb", cursor:"pointer", fontSize:12, fontWeight:500, color:"#6b7280" }}>
                        {s.status === "archived" ? "Unarchive" : "Archive"}
                      </button>
                      <button onClick={() => deleteSeries(s)} disabled={deleting === s.id} style={{ flex:1, padding:"6px 0", borderRadius:7, background:"#fff", border:"1px solid #fecaca", cursor:"pointer", fontSize:12, fontWeight:500, color:"#b91c1c", opacity:deleting===s.id?0.6:1 }}>
                        {deleting===s.id ? "Deleting..." : "Delete"}
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
        <div style={{ position:"fixed" as const, inset:0, background:"rgba(15,23,42,0.55)", backdropFilter:"blur(2px)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={() => setModal(false)}>
          <div style={{ background:"#fff", borderRadius:16, width:"100%", maxWidth:680, maxHeight:"92vh", display:"flex", flexDirection:"column" as const, boxShadow:"0 24px 70px rgba(0,0,0,0.25)" }} onClick={e=>e.stopPropagation()}>

            {/* Header */}
            <div style={{ padding:"20px 28px", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <h2 style={{ margin:0, fontSize:18, fontWeight:700, color:"#111827" }}>{editId ? "Edit Series" : "New Event Series"}</h2>
                <p style={{ ...HINT, marginTop:3 }}>
                  {editId ? "Changes apply to this series and its upcoming occurrences." : "Define the template once — occurrences are generated automatically."}
                </p>
              </div>
              <button onClick={() => setModal(false)} aria-label="Close" style={{ background:"#f3f4f6", border:"none", width:30, height:30, borderRadius:8, fontSize:16, cursor:"pointer", color:"#6b7280", lineHeight:1 }}>×</button>
            </div>

            {/* Body */}
            <div style={{ padding:"24px 28px", display:"flex", flexDirection:"column" as const, gap:24, overflowY:"auto" as const }}>
              {error && (
                <div style={{ padding:"10px 14px", background:"#fef2f2", border:"1px solid #fecaca", borderRadius:8, color:"#b91c1c", fontSize:13, display:"flex", gap:8 }}>
                  <span>⚠</span><span>{error}</span>
                </div>
              )}

              <Section title="Basics">
                <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                  <label style={LABEL}>Series name <span style={{ color:"#b91c1c" }}>*</span></label>
                  <input style={INPUT} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Fridayz ATL 🔥"/>
                </div>
                <SearchSelect label="Venue *" value={form.venueId} options={venueOpts} placeholder="Search venues..."
                  onChange={(id,label) => setForm(f=>({...f,venueId:id,venueName:label}))}/>
              </Section>

              <div style={{ height:1, background:"#f3f4f6" }}/>

              <Section title="Schedule" hint="Occurrences are generated on this cadence for a rolling 8-week window.">
                <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                  <label style={LABEL}>Day of week</label>
                  <Segmented options={DAYS} value={form.day} onChange={v=>setForm(f=>({...f,day:v}))} format={d=>d.slice(0,3).toUpperCase()}/>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                    <label style={LABEL}>Frequency</label>
                    <Segmented options={FREQS} value={form.frequency} onChange={v=>setForm(f=>({...f,frequency:v}))} format={x=>x.charAt(0).toUpperCase()+x.slice(1)}/>
                  </div>
                  <TimePicker label="Start Time" value={form.time} onChange={v=>setForm(f=>({...f,time:v}))}/>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  <DatePicker label="Start Date" value={form.startDate} onChange={v=>setForm(f=>({...f,startDate:v}))} placeholder="Series begins"/>
                  <DatePicker label="End Date (optional)" value={form.endDate} onChange={v=>setForm(f=>({...f,endDate:v}))} placeholder="Leave blank for ongoing"/>
                </div>
              </Section>

              <div style={{ height:1, background:"#f3f4f6" }}/>

              <Section title="Media" hint="First item is the cover, shown on the marquee for every FUTURE-generated occurrence. Already-generated upcoming occurrences keep their existing media — edit those individually to change them. Edit an individual event to override a single date going forward.">
                <SeriesMediaManager
                  seriesId={editId || pendingId || ""}
                  venueId={form.venueId}
                  media={form.media}
                  onChange={(media) => setForm(f => ({ ...f, media, coverImage: media[0]?.uri || "" }))}
                  disabled={saving}
                />
              </Section>

              <div style={{ height:1, background:"#f3f4f6" }}/>

              <Section title="Details">
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                    <label style={LABEL}>Age requirement</label>
                    <Segmented options={["18+","21+","All Ages"]} value={form.age} onChange={v=>setForm(f=>({...f,age:v}))}/>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                    <label style={LABEL}>Status</label>
                    <Segmented options={["active","paused","archived"]} value={form.status} onChange={v=>setForm(f=>({...f,status:v}))} format={x=>x.charAt(0).toUpperCase()+x.slice(1)}/>
                  </div>
                </div>
                <div style={{ display:"flex", flexDirection:"column" as const, gap:6 }}>
                  <label style={LABEL}>About</label>
                  <textarea style={{ ...INPUT, minHeight:70, resize:"vertical" as const }} value={form.about} onChange={e=>setForm(f=>({...f,about:e.target.value}))} placeholder="What should guests expect? This appears on every occurrence."/>
                </div>
                <div>
                  <label style={LABEL}>Vibes</label>
                  <div style={{ display:"flex", flexWrap:"wrap" as const, gap:8, marginTop:8 }}>
                    {VIBES.map(v => {
                      const sel = form.vibes.includes(v)
                      return <button key={v} type="button" onClick={()=>setForm(f=>({...f,vibes:sel?f.vibes.filter(x=>x!==v):[...f.vibes,v]}))}
                        style={{ padding:"5px 12px", borderRadius:20, fontSize:13, cursor:"pointer", fontWeight:sel?600:400, background:sel?"#111827":"#f3f4f6", color:sel?"#fff":"#374151", border:"1px solid "+(sel?"#111827":"#e5e7eb") }}>{v}</button>
                    })}
                  </div>
                </div>
              </Section>
            </div>

            {/* Footer */}
            <div style={{ padding:"14px 28px", borderTop:"1px solid #f3f4f6", display:"flex", alignItems:"center", gap:10 }}>
              <p style={{ ...HINT, flex:1 }}>
                {editId ? "Media changes apply to future-generated occurrences only — already-generated upcoming events keep what they have." : "The next 8 weeks of events are generated on create."}
              </p>
              <button onClick={()=>setModal(false)} style={{ padding:"10px 20px", borderRadius:8, background:"#fff", border:"1px solid #e5e7eb", cursor:"pointer", fontSize:14, color:"#374151" }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding:"10px 24px", borderRadius:8, background:"#111827", color:"#fff", border:"none", cursor:"pointer", fontSize:14, fontWeight:600, opacity:saving?0.6:1 }}>
                {saving ? (editId?"Saving…":"Creating & Generating…") : (editId?"Save Changes":"Create Series")}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
