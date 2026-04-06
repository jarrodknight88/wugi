"use client"
import { useEffect, useState } from "react"
import { collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"

type Table = { id:string; name:string; section:string; capacity:number; minSpend:number; description:string; active:boolean }
type Form  = { name:string; section:string; capacity:number; minSpend:number; description:string; active:boolean }
const EMPTY: Form = { name:"", section:"VIP Section", capacity:6, minSpend:0, description:"", active:true }
const INPUT: React.CSSProperties = { padding:"9px 12px", borderRadius:8, border:"1px solid #e5e7eb", fontSize:14, outline:"none", width:"100%", boxSizing:"border-box" }

export default function TableManager({ venueId, canWrite }: { venueId: string; canWrite: boolean }) {
  const [tables, setTables]   = useState<Table[]>([])
  const [modal, setModal]     = useState(false)
  const [editId, setEditId]   = useState<string|null>(null)
  const [form, setForm]       = useState<Form>(EMPTY)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState("")

  useEffect(() => {
    if (!venueId) return
    return onSnapshot(collection(db, "venues", venueId, "tables"), snap =>
      setTables(snap.docs.map(d => ({ id:d.id, name:d.data().name||"", section:d.data().section||"", capacity:d.data().capacity||0, minSpend:d.data().minSpend||0, description:d.data().description||"", active:d.data().active!==false })))
    )
  }, [venueId])

  function openCreate() { setForm(EMPTY); setEditId(null); setModal(true); setError("") }
  function openEdit(t: Table) { setForm({ name:t.name, section:t.section, capacity:t.capacity, minSpend:t.minSpend, description:t.description, active:t.active }); setEditId(t.id); setModal(true); setError("") }

  async function save() {
    if (!form.name.trim()) { setError("Table name required"); return }
    setSaving(true); setError("")
    try {
      const data = { ...form, updatedAt: serverTimestamp() }
      if (editId) { await updateDoc(doc(db, "venues", venueId, "tables", editId), data) }
      else { await addDoc(collection(db, "venues", venueId, "tables"), { ...data, createdAt: serverTimestamp() }) }
      setModal(false)
    } catch(e:any) { setError(e.message) } finally { setSaving(false) }
  }

  async function remove(id: string) {
    if (!confirm("Delete this table?")) return
    await deleteDoc(doc(db, "venues", venueId, "tables", id))
  }

  // Group by section
  const sections = [...new Set(tables.map(t => t.section))].sort()
  const CARD: React.CSSProperties = { background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", boxShadow:"0 1px 3px rgba(0,0,0,0.06)", overflow:"hidden" }

  return (
    <>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div>
          <h2 style={{ fontSize:16, fontWeight:700, color:"#111827", margin:0 }}>Tables</h2>
          <p style={{ fontSize:13, color:"#6b7280", marginTop:2 }}>{tables.length} tables configured</p>
        </div>
        {canWrite && (
          <button onClick={openCreate} style={{ padding:"9px 18px", borderRadius:8, background:"#111827", color:"#fff", border:"none", cursor:"pointer", fontSize:13, fontWeight:600 }}>
            + Add Table
          </button>
        )}
      </div>

      {tables.length === 0 ? (
        <div style={{ ...CARD, padding:48, textAlign:"center" as const }}>
          <div style={{ fontSize:36, marginBottom:10 }}>🪑</div>
          <p style={{ fontSize:15, fontWeight:600, color:"#374151", margin:"0 0 6px" }}>No tables yet</p>
          <p style={{ fontSize:14, color:"#9ca3af", margin:0 }}>Add your VIP tables, sections, and bottle service setups.</p>
        </div>
      ) : (
        sections.map(section => (
          <div key={section} style={{ marginBottom:20 }}>
            <p style={{ fontSize:12, fontWeight:700, color:"#6b7280", letterSpacing:1, textTransform:"uppercase" as const, margin:"0 0 10px" }}>{section}</p>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))", gap:12 }}>
              {tables.filter(t => t.section === section).map(t => (
                <div key={t.id} style={{ ...CARD, padding:16, opacity:t.active?1:0.5 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                    <div>
                      <p style={{ margin:0, fontWeight:700, fontSize:15, color:"#111827" }}>{t.name}</p>
                      <p style={{ margin:"2px 0 0", fontSize:12, color:"#6b7280" }}>{t.capacity} guests</p>
                    </div>
                    <div style={{ textAlign:"right" as const }}>
                      <p style={{ margin:0, fontWeight:700, fontSize:15, color:"#2a7a5a" }}>${(t.minSpend/100).toFixed(0)}</p>
                      <p style={{ margin:"2px 0 0", fontSize:11, color:"#9ca3af" }}>min spend</p>
                    </div>
                  </div>
                  {t.description && <p style={{ fontSize:12, color:"#6b7280", margin:"0 0 10px", lineHeight:1.5 }}>{t.description}</p>}
                  {canWrite && (
                    <div style={{ display:"flex", gap:6 }}>
                      <button onClick={() => openEdit(t)} style={{ flex:1, padding:"6px 0", borderRadius:6, background:"#f3f4f6", border:"none", cursor:"pointer", fontSize:12, color:"#374151", fontWeight:500 }}>Edit</button>
                      <button onClick={() => remove(t.id)} style={{ padding:"6px 10px", borderRadius:6, background:"#fee2e2", border:"none", cursor:"pointer", fontSize:12, color:"#b91c1c" }}>✕</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {modal && (
        <div style={{ position:"fixed" as const, inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={() => setModal(false)}>
          <div style={{ background:"#fff", borderRadius:16, width:"100%", maxWidth:480, boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ padding:"22px 24px", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <h3 style={{ margin:0, fontSize:17, fontWeight:700 }}>{editId ? "Edit Table" : "Add Table"}</h3>
              <button onClick={() => setModal(false)} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#9ca3af" }}>×</button>
            </div>
            <div style={{ padding:"20px 24px", display:"flex", flexDirection:"column" as const, gap:14 }}>
              {error && <div style={{ padding:"10px 14px", background:"#fee2e2", borderRadius:8, color:"#b91c1c", fontSize:13 }}>{error}</div>}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div style={{ display:"flex", flexDirection:"column" as const, gap:5, gridColumn:"1/-1" }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Table Name *</label>
                  <input style={INPUT} value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. VIP Table 1"/>
                </div>
                <div style={{ display:"flex", flexDirection:"column" as const, gap:5 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Section</label>
                  <input style={INPUT} value={form.section} onChange={e => setForm(f=>({...f,section:e.target.value}))} placeholder="VIP Section"/>
                </div>
                <div style={{ display:"flex", flexDirection:"column" as const, gap:5 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Capacity (people)</label>
                  <input style={INPUT} type="number" value={form.capacity} onChange={e => setForm(f=>({...f,capacity:Number(e.target.value)}))}/>
                </div>
                <div style={{ display:"flex", flexDirection:"column" as const, gap:5, gridColumn:"1/-1" }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Minimum Spend ($)</label>
                  <input style={INPUT} type="number" value={form.minSpend/100} onChange={e => setForm(f=>({...f,minSpend:Number(e.target.value)*100}))} placeholder="500"/>
                </div>
                <div style={{ display:"flex", flexDirection:"column" as const, gap:5, gridColumn:"1/-1" }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Description</label>
                  <textarea style={{ ...INPUT, minHeight:60, resize:"vertical" as const }} value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))} placeholder="Bottle service included, prime view of stage..."/>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <input type="checkbox" id="tableActive" checked={form.active} onChange={e => setForm(f=>({...f,active:e.target.checked}))} style={{ width:16, height:16 }}/>
                  <label htmlFor="tableActive" style={{ fontSize:13, color:"#374151", cursor:"pointer" }}>Active (available for booking)</label>
                </div>
              </div>
            </div>
            <div style={{ padding:"14px 24px", borderTop:"1px solid #f3f4f6", display:"flex", justifyContent:"flex-end", gap:10 }}>
              <button onClick={() => setModal(false)} style={{ padding:"9px 18px", borderRadius:8, background:"#f3f4f6", border:"none", cursor:"pointer", fontSize:14 }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding:"9px 22px", borderRadius:8, background:"#111827", color:"#fff", border:"none", cursor:"pointer", fontSize:14, fontWeight:600, opacity:saving?0.7:1 }}>
                {saving?"Saving...":editId?"Save Changes":"Add Table"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
