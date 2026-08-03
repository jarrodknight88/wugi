"use client"
import { useEffect, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
export const dynamic = 'force-dynamic'
import { collection, doc, onSnapshot, updateDoc, addDoc, deleteDoc, getDoc, Timestamp, serverTimestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { logAudit } from "@/lib/auditLog"
import { useAuthContext } from "@/context/AuthContext"
import DatePicker from "@/components/DatePicker"
import TimePicker from "@/components/TimePicker"
import SearchSelect from "@/components/SearchSelect"
import type { SelectOption } from "@/components/SearchSelect"
import ConfirmDialog from "@/components/ConfirmDialog"
import { useVenueFilter } from "@/hooks/useVenueFilter"

const INPUT = { padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" as const }
const LABEL = { fontSize: 13, fontWeight: 600, color: "#374151", display: "block" as const, marginBottom: 6 }
const OVERLAY = { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }
const MODAL = { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 680, maxHeight: "92vh", overflowY: "auto" as const, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }

// Canonical enums mirror mobile-app/src/types/firestore-v2.ts (DealType/DealStatus)
// — that file is the source of truth; keep these in sync if it changes.
const DEAL_TYPES: { value: string; label: string }[] = [
  { value: "happyHour",    label: "Happy Hour" },
  { value: "luckyHour",    label: "Lucky Hour" },
  { value: "flash",        label: "Flash / One-off" },
  { value: "drinkSpecial", label: "Drink Special" },
  { value: "foodSpecial",  label: "Food Special" },
  { value: "bogo",         label: "BOGO" },
  { value: "other",        label: "Other" },
]
const STATUSES = ["active", "paused", "expired"]
const VIBES = ["High Energy", "Boujee", "Divey", "Rooftop", "Speakeasy", "Late Night", "Hip-Hop", "R&B", "Live Music", "Brunch", "LGBTQ+"]
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
const SC: Record<string, { bg: string; color: string }> = {
  active:  { bg: "#dcfce7", color: "#15803d" },
  paused:  { bg: "#fef9c3", color: "#a16207" },
  expired: { bg: "#f3f4f6", color: "#6b7280" },
}

// TimePicker works in 12h "HH:MM AM/PM" for display; the deal schema stores
// startTime/endTime as 24h "HH:MM" (see firestore-v2.ts DealV2 comment) so
// mobile's src/utils/deals.ts eligibility math can compare them directly.
function to24h(t: string): string {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((t || "").trim())
  if (!m) return ""
  let h = parseInt(m[1], 10) % 12
  if (m[3].toUpperCase() === "PM") h += 12
  return `${String(h).padStart(2, "0")}:${m[2]}`
}
function to12h(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || "").trim())
  if (!m) return ""
  let h = parseInt(m[1], 10)
  const ampm = h >= 12 ? "PM" : "AM"
  h = h % 12; if (h === 0) h = 12
  return `${String(h).padStart(2, "0")}:${m[2]} ${ampm}`
}

type DealItem = { id: string; title: string; venueName: string; venueId: string; dealType: string; status: string; isFeatured: boolean }
type DF = {
  title: string; venueId: string; venueName: string; dealType: string
  detail: string; description: string; image: string; vibes: string[]
  recurring: boolean; daysOfWeek: number[]; startTime: string; endTime: string; date: string
  validFrom: string; validUntil: string
  status: string; isFeatured: boolean
}
const EMPTY: DF = {
  title: "", venueId: "", venueName: "", dealType: "happyHour",
  detail: "", description: "", image: "", vibes: [],
  recurring: true, daysOfWeek: [], startTime: "", endTime: "", date: "",
  validFrom: "", validUntil: "",
  status: "active", isFeatured: false,
}

function DealsPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { user, hasDashboardAccess, hasUserDocument, loading, isSuperAdmin } = useAuthContext()
  const { venueIds } = useVenueFilter()
  const [deals, setDeals] = useState<DealItem[]>([])
  const [venueOptions, setVenueOptions] = useState<SelectOption[]>([])
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [modal, setModal] = useState<"create" | "edit" | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<DF>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
    if (hasUserDocument && !hasDashboardAccess) router.replace("/unauthorized")
  }, [loading, user, hasDashboardAccess, hasUserDocument, router])

  useEffect(() => {
    if (!user) return
    const u1 = onSnapshot(collection(db, "deals"), s => {
      let all = s.docs.map(d => ({
        id: d.id, title: d.data().title || "Untitled", venueName: d.data().venueName || "",
        venueId: d.data().venueId || "", dealType: d.data().dealType || "other",
        status: d.data().status || "active", isFeatured: d.data().isFeatured || false,
      }))
      if (venueIds !== null) all = all.filter(dl => venueIds.includes(dl.venueId))
      setDeals(all)
    })
    const u2 = onSnapshot(collection(db, "venues"), s => {
      let opts = s.docs.map(d => ({ id: d.id, label: d.data().name || "Unnamed", sub: d.data().neighborhood || d.data().category || "" })).sort((a, b) => a.label.localeCompare(b.label))
      if (venueIds !== null) opts = opts.filter(v => venueIds.includes(v.id))
      setVenueOptions(opts)
    })
    return () => { u1(); u2() }
  }, [user, venueIds])

  useEffect(() => { if (params.get("new") === "1") openCreate() }, [params])

  function openCreate() { setForm(EMPTY); setEditId(null); setModal("create"); setError("") }

  async function openEdit(id: string) {
    const full = await getDoc(doc(db, "deals", id))
    if (!full.exists()) return
    const d: any = full.data()
    const hasRecurring = Array.isArray(d.daysOfWeek) && d.daysOfWeek.length > 0
    setEditId(id)
    setForm({
      title: d.title || "", venueId: d.venueId || "", venueName: d.venueName || "",
      dealType: d.dealType || "other", detail: d.detail || "", description: d.description || "",
      image: d.image || "", vibes: Array.isArray(d.vibes) ? d.vibes : [],
      recurring: hasRecurring || !d.date,
      daysOfWeek: hasRecurring ? d.daysOfWeek : [],
      startTime: to12h(d.startTime || ""), endTime: to12h(d.endTime || ""),
      date: d.date || "",
      validFrom: d.validFrom?.toDate ? d.validFrom.toDate().toDateString() : "",
      validUntil: d.validUntil?.toDate ? d.validUntil.toDate().toDateString() : "",
      status: d.status || "active", isFeatured: d.isFeatured || false,
    })
    setModal("edit"); setError("")
  }

  async function save() {
    if (!form.title.trim()) { setError("Title is required"); return }
    if (!form.venueId) { setError("Venue is required"); return }
    setSaving(true); setError("")
    try {
      const data = {
        title: form.title.trim(), venueId: form.venueId, venueName: form.venueName,
        dealType: form.dealType, detail: form.detail.trim() || form.title.trim(),
        description: form.description.trim(), image: form.image.trim(), vibes: form.vibes,
        daysOfWeek: form.recurring ? form.daysOfWeek : [],
        startTime: form.recurring && form.startTime ? to24h(form.startTime) : "",
        endTime: form.recurring && form.endTime ? to24h(form.endTime) : "",
        date: form.recurring ? "" : form.date,
        validFrom: form.validFrom ? Timestamp.fromDate(new Date(form.validFrom)) : null,
        validUntil: form.validUntil ? Timestamp.fromDate(new Date(form.validUntil)) : null,
        status: form.status, isFeatured: form.isFeatured,
        isActive: form.status === "active",
        requiresPurchase: false,
        updatedAt: serverTimestamp(),
      }
      if (modal === "create") {
        const ref = await addDoc(collection(db, "deals"), { ...data, isTest: false, createdAt: serverTimestamp() })
        await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: "created_deal", targetId: ref.id, targetName: form.title })
      } else if (editId) {
        await updateDoc(doc(db, "deals", editId), data)
        await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: "updated_deal", targetId: editId, targetName: form.title })
      }
      setModal(null)
    } catch (e: any) { setError(e.message) } finally { setSaving(false) }
  }

  async function confirmDelete() {
    if (!confirmDeleteId) return
    const target = deals.find(d => d.id === confirmDeleteId)
    await deleteDoc(doc(db, "deals", confirmDeleteId))
    await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: "deleted_deal", targetId: confirmDeleteId, targetName: target?.title || confirmDeleteId })
    setConfirmDeleteId(null)
  }

  function toggleDay(i: number) {
    setForm(f => ({ ...f, daysOfWeek: f.daysOfWeek.includes(i) ? f.daysOfWeek.filter(x => x !== i) : [...f.daysOfWeek, i].sort() }))
  }

  const displayed = deals.filter(d => (filter === "all" || d.status === filter) && (!search || d.title.toLowerCase().includes(search.toLowerCase()) || d.venueName.toLowerCase().includes(search.toLowerCase())))
  if (loading || !user || !hasDashboardAccess) return null

  return (
    <>
      <div className="dash-page">
        <div className="dash-header">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Deals</h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>{deals.length} total deals</p>
          </div>
          {isSuperAdmin && (
            <button onClick={openCreate} style={{ padding: "10px 20px", borderRadius: 8, background: "#a8533f", color: "#fff", border: "none", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>+ Add Deal</button>
          )}
        </div>

        <div className="dash-filters">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search deals..."
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, width: 200, outline: "none" }} />
          {["all", ...STATUSES].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{ padding: "8px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: filter === s ? 600 : 400, background: filter === s ? "#111827" : "#fff", color: filter === s ? "#fff" : "#374151", border: "1px solid " + (filter === s ? "#111827" : "#e5e7eb") }}>{s === "all" ? "All" : s}</button>
          ))}
        </div>

        <div className="dash-table-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 600 }}>
            <thead><tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              {["Deal", "Venue", "Type", "Status", "Featured", "Actions"].map(h => <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 13 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {displayed.length === 0 ? <tr><td colSpan={6} style={{ padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>No deals found</td></tr>
                : displayed.map((dl, i) => {
                  const s = SC[dl.status] || { bg: "#f3f4f6", color: "#6b7280" }
                  return <tr key={dl.id} style={{ borderBottom: i < displayed.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                    <td style={{ padding: "12px 16px", fontWeight: 600, color: "#111827" }}>{dl.title}</td>
                    <td style={{ padding: "12px 16px", color: "#6b7280" }}>{dl.venueName}</td>
                    <td style={{ padding: "12px 16px", color: "#6b7280" }}>{DEAL_TYPES.find(t => t.value === dl.dealType)?.label || dl.dealType}</td>
                    <td style={{ padding: "12px 16px" }}><span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: s.bg, color: s.color }}>{dl.status}</span></td>
                    <td style={{ padding: "12px 16px", color: dl.isFeatured ? "#a8533f" : "#d1d5db" }}>{dl.isFeatured ? "★" : "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => openEdit(dl.id)} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, background: "#f3f4f6", border: "none", cursor: "pointer", color: "#374151" }}>{isSuperAdmin ? "Edit" : "View"}</button>
                        {isSuperAdmin && <button onClick={() => setConfirmDeleteId(dl.id)} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, background: "#fee2e2", border: "none", cursor: "pointer", color: "#b91c1c" }}>Delete</button>}
                      </div>
                    </td>
                  </tr>
                })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div style={OVERLAY} onClick={() => setModal(null)}>
          <div style={MODAL} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "24px 28px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{modal === "edit" ? (isSuperAdmin ? "Edit Deal" : "View Deal") : "Add Deal"}</h2>
              <button onClick={() => setModal(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
            </div>
            <fieldset disabled={!isSuperAdmin} style={{ border: "none", padding: 0, margin: 0 }}>
              <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
                {error && <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>{error}</div>}

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={LABEL}>Deal Title *</label>
                  <input style={INPUT} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Half-Off Bottles"/>
                </div>

                <SearchSelect
                  label="Venue *"
                  value={form.venueId}
                  options={venueOptions}
                  placeholder="Search venues..."
                  onChange={(id, label) => setForm(f => ({ ...f, venueId: id, venueName: label }))}
                />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={LABEL}>Deal Type</label>
                    <select style={INPUT} value={form.dealType} onChange={e => setForm(f => ({ ...f, dealType: e.target.value }))}>
                      {DEAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={LABEL}>Status</label>
                    <select style={INPUT} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={LABEL}>Offer (short — shown on the deal card)</label>
                  <input style={INPUT} value={form.detail} onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} placeholder="e.g. 50% off all bottles"/>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={LABEL}>Description / Terms</label>
                  <textarea style={{ ...INPUT, minHeight: 80, resize: "vertical" }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Full details, restrictions, fine print..."/>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={LABEL}>Hero Image URL</label>
                  <input style={INPUT} value={form.image} onChange={e => setForm(f => ({ ...f, image: e.target.value }))} placeholder="https://... (falls back to the venue hero if left blank)"/>
                </div>

                {/* Validity window — recurring weekly window OR a one-off flash date */}
                <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 16 }}>
                  <label style={LABEL}>Validity Window</label>
                  <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                      <input type="radio" checked={form.recurring} onChange={() => setForm(f => ({ ...f, recurring: true }))}/> Recurring weekly
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                      <input type="radio" checked={!form.recurring} onChange={() => setForm(f => ({ ...f, recurring: false }))}/> One-off / flash date
                    </label>
                  </div>

                  {form.recurring ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {DOW.map((d, i) => {
                          const sel = form.daysOfWeek.includes(i)
                          return <button key={d} type="button" onClick={() => toggleDay(i)} style={{ width: 38, height: 38, borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: sel ? 700 : 400, background: sel ? "#111827" : "#f3f4f6", color: sel ? "#fff" : "#374151", border: "1px solid " + (sel ? "#111827" : "#e5e7eb") }}>{d}</button>
                        })}
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginBottom: 12 }}>
                      <DatePicker label="Date" value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} placeholder="Pick a date"/>
                    </div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <TimePicker label="Start time (optional)" value={form.startTime} onChange={v => setForm(f => ({ ...f, startTime: v }))}/>
                    <TimePicker label="End time (optional)" value={form.endTime} onChange={v => setForm(f => ({ ...f, endTime: v }))}/>
                  </div>
                  <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 6 }}>Leave times blank for an all-day deal. An end time earlier than the start time is treated as crossing midnight.</p>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
                    <DatePicker label="Run start (optional)" value={form.validFrom} onChange={v => setForm(f => ({ ...f, validFrom: v }))} placeholder="No start bound"/>
                    <DatePicker label="Run end (optional)" value={form.validUntil} onChange={v => setForm(f => ({ ...f, validUntil: v }))} placeholder="No end bound"/>
                  </div>
                </div>

                <div>
                  <label style={LABEL}>Vibes</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                    {VIBES.map(v => {
                      const sel = form.vibes.includes(v)
                      return <button key={v} type="button" onClick={() => setForm(f => ({ ...f, vibes: sel ? f.vibes.filter(x => x !== v) : [...f.vibes, v] }))}
                        style={{ padding: "5px 12px", borderRadius: 20, fontSize: 13, cursor: "pointer", fontWeight: sel ? 600 : 400, background: sel ? "#111827" : "#f3f4f6", color: sel ? "#fff" : "#374151", border: "1px solid " + (sel ? "#111827" : "#e5e7eb") }}>{v}</button>
                    })}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="checkbox" id="dealFeatured" checked={form.isFeatured} onChange={e => setForm(f => ({ ...f, isFeatured: e.target.checked }))} style={{ width: 18, height: 18 }}/>
                  <label htmlFor="dealFeatured" style={{ fontSize: 14, color: "#374151", cursor: "pointer" }}>Featured deal</label>
                </div>
              </div>
            </fieldset>
            <div style={{ padding: "16px 28px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setModal(null)} style={{ padding: "10px 20px", borderRadius: 8, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 14 }}>{isSuperAdmin ? "Cancel" : "Close"}</button>
              {isSuperAdmin && (
                <button onClick={save} disabled={saving} style={{ padding: "10px 24px", borderRadius: 8, background: "#a8533f", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
                  {saving ? "Saving..." : modal === "edit" ? "Save Changes" : "Create Deal"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          message={`Delete "${deals.find(d => d.id === confirmDeleteId)?.title || "this deal"}"? This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </>
  )
}

export default function DealsPage() {
  return <Suspense fallback={null}><DealsPageInner/></Suspense>
}
