"use client"
import { useEffect, useState, useCallback, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"

export const dynamic = 'force-dynamic'
import { collection, doc, onSnapshot, updateDoc, addDoc, serverTimestamp, query, orderBy } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { logAudit } from "@/lib/auditLog"
import { useAuthContext } from "@/context/AuthContext"
import DashboardLayout from "@/components/DashboardLayout"

const CARD = { background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  approved:       { bg: "#dcfce7", color: "#15803d" },
  pending_review: { bg: "#fef9c3", color: "#a16207" },
  unclaimed:      { bg: "#e0f2fe", color: "#0369a1" },
  rejected:       { bg: "#fee2e2", color: "#b91c1c" },
  closed:         { bg: "#f3f4f6", color: "#6b7280" },
  disabled:       { bg: "#f3f4f6", color: "#9ca3af" },
}

type Venue = { id: string; name: string; category: string; address: string; status: string; isFeatured?: boolean; neighborhood?: string }
type VenueForm = { name: string; category: string; address: string; phone: string; website: string; instagram: string; about: string; neighborhood: string; status: string; isFeatured: boolean; vibes: string[] }

const EMPTY_FORM: VenueForm = { name: "", category: "", address: "", phone: "", website: "", instagram: "", about: "", neighborhood: "", status: "pending_review", isFeatured: false, vibes: [] }

function VenuesPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { user, hasDashboardAccess, hasUserDocument, loading } = useAuthContext()
  const [venues, setVenues] = useState<Venue[]>([])
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [modal, setModal] = useState<"create" | "edit" | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<VenueForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
    if (!loading && hasUserDocument && !hasDashboardAccess) router.replace("/unauthorized")
  }, [loading, user, hasDashboardAccess, router])

  useEffect(() => {
    if (!user) return
    const unsub = onSnapshot(collection(db, "venues"), snap => {
      setVenues(snap.docs.map(d => ({ id: d.id, name: d.data().name || "Unnamed", category: d.data().category || "", address: d.data().address || "", status: d.data().status || "unknown", isFeatured: d.data().isFeatured || false, neighborhood: d.data().neighborhood || "" })))
    })
    return unsub
  }, [user])

  useEffect(() => { if (params.get("new") === "1") openCreate() }, [params])

  function openCreate() { setForm(EMPTY_FORM); setEditId(null); setModal("create"); setError("") }
  function openEdit(v: Venue) {
    setEditId(v.id)
    setForm({ name: v.name, category: v.category, address: v.address, phone: "", website: "", instagram: "", about: "", neighborhood: v.neighborhood || "", status: v.status, isFeatured: v.isFeatured || false, vibes: [] })
    setModal("edit"); setError("")
  }

  async function save() {
    if (!form.name.trim()) { setError("Name is required"); return }
    setSaving(true); setError("")
    try {
      const data = { ...form, updatedAt: serverTimestamp(), market: "atlanta" }
      if (modal === "create") {
        const ref = await addDoc(collection(db, "venues"), { ...data, createdAt: serverTimestamp() })
        await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: "created_venue", targetId: ref.id, targetName: form.name })
      } else if (editId) {
        await updateDoc(doc(db, "venues", editId), data)
        await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: "updated_venue", targetId: editId, targetName: form.name })
      }
      setModal(null)
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function setStatus(id: string, name: string, status: string) {
    await updateDoc(doc(db, "venues", id), { status, updatedAt: serverTimestamp() })
    await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: `${status}_venue`, targetId: id, targetName: name })
  }

  const displayed = venues.filter(v => (filter === "all" || v.status === filter) && (!search || v.name.toLowerCase().includes(search.toLowerCase())))

  if (loading || !user || !hasDashboardAccess) return null

  return (
    <DashboardLayout>
      <div className="dash-page">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, gap: 12, flexWrap: "wrap" as const }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Venues</h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>{venues.length} total venues</p>
          </div>
          <button onClick={openCreate} style={{ padding: "10px 20px", borderRadius: 8, background: "#2a7a5a", color: "#fff", border: "none", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
            + Add Venue
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" as const, alignItems: "center" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search venues..."
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, width: 200, outline: "none" }}/>
          {["all","approved","pending_review","unclaimed","rejected"].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{
              padding: "8px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: filter === s ? 600 : 400,
              background: filter === s ? "#111827" : "#fff", color: filter === s ? "#fff" : "#374151",
              border: "1px solid " + (filter === s ? "#111827" : "#e5e7eb"),
            }}>{s === "all" ? "All" : s.replace("_", " ")}</button>
          ))}
        </div>

        {/* Table */}
        <div className="dash-table-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 600 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                {["Name","Category","Neighborhood","Status","Featured","Actions"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>No venues found</td></tr>
              ) : displayed.map((v, i) => {
                const sc = STATUS_COLORS[v.status] || { bg: "#f3f4f6", color: "#6b7280" }
                return (
                  <tr key={v.id} style={{ borderBottom: i < displayed.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                    <td style={{ padding: "12px 16px", fontWeight: 600, color: "#111827" }}>{v.name}</td>
                    <td style={{ padding: "12px 16px", color: "#6b7280" }}>{v.category}</td>
                    <td style={{ padding: "12px 16px", color: "#6b7280" }}>{v.neighborhood || "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: sc.bg, color: sc.color }}>{v.status}</span>
                    </td>
                    <td style={{ padding: "12px 16px", color: v.isFeatured ? "#2a7a5a" : "#d1d5db" }}>{v.isFeatured ? "★" : "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => openEdit(v)} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, background: "#f3f4f6", border: "none", cursor: "pointer", color: "#374151" }}>Edit</button>
                        {v.status !== "approved" && <button onClick={() => setStatus(v.id, v.name, "approved")} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, background: "#dcfce7", border: "none", cursor: "pointer", color: "#15803d", fontWeight: 600 }}>Approve</button>}
                        {v.status !== "rejected" && <button onClick={() => setStatus(v.id, v.name, "rejected")} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, background: "#fee2e2", border: "none", cursor: "pointer", color: "#b91c1c" }}>Reject</button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {modal && <VenueModal form={form} setForm={setForm} onSave={save} onClose={() => setModal(null)} saving={saving} error={error} isEdit={modal === "edit"}/>}
    </DashboardLayout>
  )
}
// VenueModal — create/edit form
const OVERLAY = { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }
const MODAL   = { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto" as const, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }
const MFIELD  = { display: "flex" as const, flexDirection: "column" as const, gap: 6 }
const MLABEL  = { fontSize: 13, fontWeight: 600, color: "#374151" } as const
const MINPUT  = { padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" as const }

const MVIB  = ["High Energy","Boujee","Divey","Rooftop","Speakeasy","Sports Bar","Lounge","Late Night","Hip-Hop","R&B","EDM","Jazz","Live Music","Brunch","LGBTQ+","Karaoke"]
const MCATS = ["Bar","Nightclub","Lounge","Restaurant","Rooftop","Sports Bar","Live Music Venue","Hotel Bar","Event Space"]


function VenueModal({ form, setForm, onSave, onClose, saving, error, isEdit }: {
  form: VenueForm; setForm: (f: VenueForm) => void; onSave: () => void
  onClose: () => void; saving: boolean; error: string; isEdit: boolean
}) {
  const f = (field: keyof VenueForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [field]: e.target.value })

  function toggleVibe(v: string) {
    setForm({ ...form, vibes: form.vibes.includes(v) ? form.vibes.filter(x => x !== v) : [...form.vibes, v] })
  }

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={MODAL} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "24px 28px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{isEdit ? "Edit Venue" : "Add Venue"}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>
        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
          {error && <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>{error}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={MFIELD}>
              <label style={MLABEL}>Venue Name *</label>
              <input style={MINPUT} value={form.name} onChange={f("name")} placeholder="e.g. Clermont Lounge"/>
            </div>
            <div style={MFIELD}>
              <label style={MLABEL}>Category</label>
              <select style={MINPUT} value={form.category} onChange={f("category")}>
                <option value="">Select category...</option>
                {MCATS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div style={MFIELD}>
            <label style={MLABEL}>Address</label>
            <input style={MINPUT} value={form.address} onChange={f("address")} placeholder="123 Main St, Atlanta, GA 30308"/>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={MFIELD}>
              <label style={MLABEL}>Phone</label>
              <input style={MINPUT} value={form.phone} onChange={f("phone")} placeholder="(404) 555-0100"/>
            </div>
            <div style={MFIELD}>
              <label style={MLABEL}>Neighborhood</label>
              <input style={MINPUT} value={form.neighborhood} onChange={f("neighborhood")} placeholder="e.g. Ponce City"/>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={MFIELD}>
              <label style={MLABEL}>Website</label>
              <input style={MINPUT} value={form.website} onChange={f("website")} placeholder="https://..."/>
            </div>
            <div style={MFIELD}>
              <label style={MLABEL}>Instagram</label>
              <input style={MINPUT} value={form.instagram} onChange={f("instagram")} placeholder="@handle"/>
            </div>
          </div>

          <div style={MFIELD}>
            <label style={MLABEL}>About</label>
            <textarea style={{ ...MINPUT, minHeight: 80, resize: "vertical" }} value={form.about} onChange={f("about")} placeholder="Describe this venue..."/>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={MFIELD}>
              <label style={MLABEL}>Status</label>
              <select style={MINPUT} value={form.status} onChange={f("status")}>
                {["pending_review","approved","unclaimed","rejected","closed","disabled"].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div style={MFIELD}>
              <label style={MLABEL}>Featured</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <input type="checkbox" id="featured" checked={form.isFeatured} onChange={e => setForm({ ...form, isFeatured: e.target.checked })} style={{ width: 18, height: 18, cursor: "pointer" }}/>
                <label htmlFor="featured" style={{ fontSize: 14, cursor: "pointer", color: "#374151" }}>Show in featured spots</label>
              </div>
            </div>
          </div>

          <div style={MFIELD}>
            <label style={MLABEL}>Vibes</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
              {MVIB.map(v => {
                const sel = form.vibes.includes(v)
                return (
                  <button key={v} onClick={() => toggleVibe(v)} style={{
                    padding: "5px 12px", borderRadius: 20, fontSize: 13, cursor: "pointer", fontWeight: sel ? 600 : 400,
                    background: sel ? "#111827" : "#f3f4f6", color: sel ? "#fff" : "#374151",
                    border: "1px solid " + (sel ? "#111827" : "#e5e7eb"),
                  }}>{v}</button>
                )
              })}
            </div>
          </div>
        </div>
        <div style={{ padding: "16px 28px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 8, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 14, color: "#374151" }}>Cancel</button>
          <button onClick={onSave} disabled={saving} style={{ padding: "10px 24px", borderRadius: 8, background: "#2a7a5a", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Venue"}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function VenuesPage() {
  return (
    <Suspense fallback={null}>
      <VenuesPageInner />
    </Suspense>
  )
}
