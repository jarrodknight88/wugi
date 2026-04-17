"use client"
import { useEffect, useRef, useState } from "react"
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc,
  serverTimestamp, writeBatch, getDocs,
} from "firebase/firestore"
import { db } from "@/lib/firebase"

// ── Types ────────────────────────────────────────────────────────────
export type TableGroup = {
  id: string; name: string; color: string; order: number
}
export type VenueTable = {
  id: string; groupId: string; name: string; section: string
  minCapacity: number; maxCapacity: number; minSpend: number
  description: string; active: boolean; order: number
}
type GroupForm = { name: string; color: string }
type TableForm = {
  name: string; groupId: string; minCapacity: number; maxCapacity: number
  minSpend: number; description: string; active: boolean
}

// ── Color palette — 24 rich options ──────────────────────────────────
export const GROUP_COLORS = [
  // Reds & pinks
  "#dc2626", "#be185d", "#9f1239",
  // Oranges
  "#ea580c", "#d97706",
  // Yellows & lime
  "#ca8a04", "#84cc16",
  // Greens
  "#16a34a", "#2a7a5a", "#0f766e",
  // Blues
  "#0284c7", "#1d4ed8", "#2563eb",
  // Purples & violets
  "#7c3aed", "#9333ea", "#6d28d9",
  // Pinks
  "#db2777", "#ec4899",
  // Neutrals
  "#0f172a", "#374151", "#64748b", "#e2e8f0",
  // Bright accents
  "#f59e0b", "#06b6d4",
]

const EMPTY_TABLE: TableForm = {
  name: "", groupId: "", minCapacity: 2, maxCapacity: 6,
  minSpend: 0, description: "", active: true,
}
const EMPTY_GROUP: GroupForm = { name: "", color: GROUP_COLORS[0] }

const INPUT: React.CSSProperties = {
  padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb",
  fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box",
}
const LABEL: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5,
}
const CARD: React.CSSProperties = {
  background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
}

// ── Color Swatch Picker ───────────────────────────────────────────────
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
      {GROUP_COLORS.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} style={{
          width: 26, height: 26, borderRadius: "50%", background: c, border: "none",
          cursor: "pointer", outline: value === c ? `3px solid ${c}` : "none",
          outlineOffset: 2, transform: value === c ? "scale(1.18)" : "scale(1)",
          transition: "transform 0.12s",
        }} />
      ))}
    </div>
  )
}

// ── Group Modal ───────────────────────────────────────────────────────
function GroupModal({
  initial, onSave, onClose,
}: { initial: GroupForm; onSave: (f: GroupForm) => Promise<void>; onClose: () => void }) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function submit() {
    if (!form.name.trim()) { setError("Group name required"); return }
    setSaving(true)
    try { await onSave(form); onClose() }
    catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Overlay onClose={onClose}>
      <ModalBox title={initial.name ? "Edit Group" : "Add Group"} onClose={onClose}>
        {error && <ErrBanner msg={error} />}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={LABEL}>Group Name *</label>
            <input style={INPUT} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. VIP Section" />
          </div>
          <div>
            <label style={LABEL}>Group Color</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: form.color, border: "1px solid #e5e7eb" }} />
              <span style={{ fontSize: 13, color: "#6b7280", fontFamily: "monospace" }}>{form.color}</span>
            </div>
            <ColorPicker value={form.color} onChange={c => setForm(f => ({ ...f, color: c }))} />
          </div>
        </div>
        <ModalFooter onClose={onClose} onSave={submit} saving={saving} isEdit={!!initial.name} />
      </ModalBox>
    </Overlay>
  )
}

// ── Table Modal ───────────────────────────────────────────────────────
function TableModal({
  initial, groups, onSave, onClose,
}: {
  initial: TableForm & { id?: string }
  groups: TableGroup[]
  onSave: (f: TableForm) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<TableForm>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function submit() {
    if (!form.name.trim()) { setError("Table name required"); return }
    if (!form.groupId) { setError("Select a group"); return }
    if (form.minCapacity > form.maxCapacity) { setError("Min capacity can't exceed max"); return }
    setSaving(true)
    try { await onSave(form); onClose() }
    catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Overlay onClose={onClose}>
      <ModalBox title={initial.id ? "Edit Table" : "Add Table"} onClose={onClose}>
        {error && <ErrBanner msg={error} />}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={LABEL}>Table Name *</label>
            <input style={INPUT} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. VIP Table 1" />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={LABEL}>Group *</label>
            <select style={INPUT} value={form.groupId} onChange={e => setForm(f => ({ ...f, groupId: e.target.value }))}>
              <option value="">— Select a group —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label style={LABEL}>Min Capacity</label>
            <input style={INPUT} type="number" min={1} value={form.minCapacity}
              onChange={e => setForm(f => ({ ...f, minCapacity: Number(e.target.value) }))} />
          </div>
          <div>
            <label style={LABEL}>Max Capacity</label>
            <input style={INPUT} type="number" min={1} value={form.maxCapacity}
              onChange={e => setForm(f => ({ ...f, maxCapacity: Number(e.target.value) }))} />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={LABEL}>Minimum Spend ($)</label>
            <input style={INPUT} type="number" min={0} value={form.minSpend / 100}
              onChange={e => setForm(f => ({ ...f, minSpend: Math.round(Number(e.target.value) * 100) }))} placeholder="500" />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={LABEL}>Description</label>
            <textarea style={{ ...INPUT, minHeight: 60, resize: "vertical" }} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Bottle service included, stage view..." />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" id="tActive" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} style={{ width: 16, height: 16 }} />
            <label htmlFor="tActive" style={{ fontSize: 13, color: "#374151", cursor: "pointer" }}>Active</label>
          </div>
        </div>
        <ModalFooter onClose={onClose} onSave={submit} saving={saving} isEdit={!!initial.id} />
      </ModalBox>
    </Overlay>
  )
}

// ── Shared UI helpers ─────────────────────────────────────────────────
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 500 }}>{children}</div>
    </div>
  )
}
function ModalBox({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
      <div style={{ padding: "20px 24px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{title}</h3>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
      </div>
      <div style={{ padding: "20px 24px" }}>{children}</div>
    </div>
  )
}
function ModalFooter({ onClose, onSave, saving, isEdit }: { onClose: () => void; onSave: () => void; saving: boolean; isEdit: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20, paddingTop: 16, borderTop: "1px solid #f3f4f6" }}>
      <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 8, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 14 }}>Cancel</button>
      <button onClick={onSave} disabled={saving} style={{ padding: "9px 22px", borderRadius: 8, background: "#111827", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
        {saving ? "Saving…" : isEdit ? "Save Changes" : "Add"}
      </button>
    </div>
  )
}
function ErrBanner({ msg }: { msg: string }) {
  return <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 14 }}>{msg}</div>
}

// ── Main TableGroupManager component ─────────────────────────────────
export default function TableGroupManager({ venueId, canWrite }: { venueId: string; canWrite: boolean }) {
  const [groups, setGroups] = useState<TableGroup[]>([])
  const [tables, setTables] = useState<VenueTable[]>([])
  const [groupModal, setGroupModal] = useState<{ form: GroupForm; id?: string } | null>(null)
  const [tableModal, setTableModal] = useState<{ form: TableForm & { id?: string } } | null>(null)
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null)
  const dragOverGroup = useRef<string | null>(null)
  const dragOverTable = useRef<string | null>(null)

  useEffect(() => {
    if (!venueId) return
    const u1 = onSnapshot(collection(db, "venues", venueId, "tableGroups"), snap =>
      setGroups(snap.docs.map(d => ({ id: d.id, name: d.data().name || "", color: d.data().color || GROUP_COLORS[0], order: d.data().order ?? 0 }))
        .sort((a, b) => a.order - b.order))
    )
    const u2 = onSnapshot(collection(db, "venues", venueId, "tables"), snap =>
      setTables(snap.docs.map(d => ({
        id: d.id, groupId: d.data().groupId || "", name: d.data().name || "",
        section: d.data().section || "", minCapacity: d.data().minCapacity ?? d.data().capacity ?? 2,
        maxCapacity: d.data().maxCapacity ?? d.data().capacity ?? 6,
        minSpend: d.data().minSpend || 0, description: d.data().description || "",
        active: d.data().active !== false, order: d.data().order ?? 0,
      })).sort((a, b) => a.order - b.order))
    )
    return () => { u1(); u2() }
  }, [venueId])

  // ── Group CRUD ──
  async function saveGroup(form: GroupForm, id?: string) {
    const data = { name: form.name, color: form.color, updatedAt: serverTimestamp() }
    if (id) {
      await updateDoc(doc(db, "venues", venueId, "tableGroups", id), data)
    } else {
      await addDoc(collection(db, "venues", venueId, "tableGroups"), { ...data, order: groups.length, createdAt: serverTimestamp() })
    }
  }
  async function deleteGroup(id: string) {
    if (!confirm("Delete this group and all its tables?")) return
    const batch = writeBatch(db)
    batch.delete(doc(db, "venues", venueId, "tableGroups", id))
    tables.filter(t => t.groupId === id).forEach(t => batch.delete(doc(db, "venues", venueId, "tables", t.id)))
    await batch.commit()
  }

  // ── Table CRUD ──
  async function saveTable(form: TableForm, id?: string) {
    const group = groups.find(g => g.id === form.groupId)
    const data = { ...form, section: group?.name || "", color: group?.color || "", updatedAt: serverTimestamp() }
    if (id) { await updateDoc(doc(db, "venues", venueId, "tables", id), data) }
    else { await addDoc(collection(db, "venues", venueId, "tables"), { ...data, order: tables.filter(t => t.groupId === form.groupId).length, createdAt: serverTimestamp() }) }
  }
  async function duplicateTable(t: VenueTable) {
    const newName = prompt("Name for the duplicated table:", `${t.name} (copy)`)
    if (!newName) return
    await addDoc(collection(db, "venues", venueId, "tables"), {
      name: newName, groupId: t.groupId, section: t.section, minCapacity: t.minCapacity,
      maxCapacity: t.maxCapacity, minSpend: t.minSpend, description: t.description,
      active: t.active, order: tables.filter(x => x.groupId === t.groupId).length,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })
  }
  async function deleteTable(id: string) {
    if (!confirm("Delete this table?")) return
    await deleteDoc(doc(db, "venues", venueId, "tables", id))
  }

  // ── Drag-to-reorder groups ──
  async function reorderGroups(dragId: string, overId: string) {
    if (dragId === overId) return
    const sorted = [...groups]
    const from = sorted.findIndex(g => g.id === dragId)
    const to   = sorted.findIndex(g => g.id === overId)
    sorted.splice(to, 0, sorted.splice(from, 1)[0])
    const batch = writeBatch(db)
    sorted.forEach((g, i) => batch.update(doc(db, "venues", venueId, "tableGroups", g.id), { order: i }))
    await batch.commit()
  }
  async function reorderTables(dragId: string, overId: string, groupId: string) {
    if (dragId === overId) return
    const sorted = [...tables.filter(t => t.groupId === groupId)]
    const from = sorted.findIndex(t => t.id === dragId)
    const to   = sorted.findIndex(t => t.id === overId)
    sorted.splice(to, 0, sorted.splice(from, 1)[0])
    const batch = writeBatch(db)
    sorted.forEach((t, i) => batch.update(doc(db, "venues", venueId, "tables", t.id), { order: i }))
    await batch.commit()
  }

  // ── Render ──
  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>Table Groups & Tables</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>{groups.length} groups · {tables.length} tables</p>
        </div>
        {canWrite && (
          <button onClick={() => setGroupModal({ form: EMPTY_GROUP })}
            style={{ padding: "9px 18px", borderRadius: 8, background: "#111827", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            + Add Group
          </button>
        )}
      </div>

      {/* Empty state */}
      {groups.length === 0 && (
        <div style={{ ...CARD, padding: 48, textAlign: "center" as const }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🪑</div>
          <p style={{ fontSize: 15, fontWeight: 600, color: "#374151", margin: "0 0 6px" }}>No table groups yet</p>
          <p style={{ fontSize: 14, color: "#9ca3af", margin: 0 }}>Create a group (e.g. VIP Section, Bar Top) then add tables to it.</p>
        </div>
      )}

      {/* Groups */}
      {groups.map(group => {
        const groupTables = tables.filter(t => t.groupId === group.id)
        return (
          <div key={group.id} style={{ marginBottom: 24 }}
            draggable onDragStart={() => setDraggingGroupId(group.id)}
            onDragOver={e => { e.preventDefault(); dragOverGroup.current = group.id }}
            onDrop={() => { if (draggingGroupId) reorderGroups(draggingGroupId, group.id); setDraggingGroupId(null) }}>

            {/* Group header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 14, height: 14, borderRadius: "50%", background: group.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#374151", letterSpacing: 0.5, textTransform: "uppercase" as const }}>{group.name}</span>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>({groupTables.length} tables)</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {canWrite && <>
                  <button onClick={() => setTableModal({ form: { ...EMPTY_TABLE, groupId: group.id } })}
                    style={{ padding: "4px 12px", borderRadius: 6, background: group.color, color: "#fff", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                    + Table
                  </button>
                  <button onClick={() => setGroupModal({ form: { name: group.name, color: group.color }, id: group.id })}
                    style={{ padding: "4px 10px", borderRadius: 6, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 12, color: "#374151" }}>Edit</button>
                  <button onClick={() => deleteGroup(group.id)}
                    style={{ padding: "4px 10px", borderRadius: 6, background: "#fee2e2", border: "none", cursor: "pointer", fontSize: 12, color: "#b91c1c" }}>✕</button>
                </>}
              </div>
            </div>

            {/* Tables grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
              {groupTables.map(t => (
                <div key={t.id} style={{ ...CARD, padding: 14, opacity: t.active ? 1 : 0.55, borderLeft: `4px solid ${group.color}`, cursor: "grab" }}
                  draggable onDragStart={() => setDraggingTableId(t.id)}
                  onDragOver={e => { e.preventDefault(); dragOverTable.current = t.id }}
                  onDrop={() => { if (draggingTableId) reorderTables(draggingTableId, t.id, group.id); setDraggingTableId(null) }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#111827" }}>{t.name}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>
                        {t.minCapacity === t.maxCapacity ? `${t.minCapacity} guests` : `${t.minCapacity}–${t.maxCapacity} guests`}
                      </p>
                    </div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: group.color }}>${(t.minSpend / 100).toFixed(0)}<span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 400 }}> min</span></p>
                  </div>
                  {t.description && <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 8px", lineHeight: 1.4 }}>{t.description}</p>}
                  {canWrite && (
                    <div style={{ display: "flex", gap: 5 }}>
                      <button onClick={() => setTableModal({ form: { name: t.name, groupId: t.groupId, minCapacity: t.minCapacity, maxCapacity: t.maxCapacity, minSpend: t.minSpend, description: t.description, active: t.active, id: t.id } as any })}
                        style={{ flex: 1, padding: "5px 0", borderRadius: 5, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 11, color: "#374151" }}>Edit</button>
                      <button onClick={() => duplicateTable(t)}
                        style={{ padding: "5px 8px", borderRadius: 5, background: "#eff6ff", border: "none", cursor: "pointer", fontSize: 11, color: "#2563eb" }}>⧉</button>
                      <button onClick={() => deleteTable(t.id)}
                        style={{ padding: "5px 8px", borderRadius: 5, background: "#fee2e2", border: "none", cursor: "pointer", fontSize: 11, color: "#b91c1c" }}>✕</button>
                    </div>
                  )}
                </div>
              ))}
              {groupTables.length === 0 && (
                <div style={{ ...CARD, padding: 20, textAlign: "center" as const, color: "#9ca3af", fontSize: 13, borderLeft: `4px solid ${group.color}` }}>
                  No tables yet — click "+ Table" to add one.
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* ── Ungrouped tables ── */}
      {(() => {
        const groupIds = new Set(groups.map(g => g.id))
        const ungrouped = tables.filter(t => !t.groupId || !groupIds.has(t.groupId))
        if (ungrouped.length === 0) return null
        return (
          <div style={{ marginBottom: 24 }}>
            {/* Warning banner */}
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16 }}>⚠️</span>
              <p style={{ margin: 0, fontSize: 13, color: "#92400e" }}>
                <strong>{ungrouped.length} table{ungrouped.length > 1 ? "s" : ""} not assigned to a group.</strong>{" "}
                Use the "Assign" button on each card to move them into a group.
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#d1d5db", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#6b7280", letterSpacing: 0.5, textTransform: "uppercase" as const }}>Ungrouped</span>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>({ungrouped.length} tables)</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
              {ungrouped.map(t => (
                <div key={t.id} style={{ ...CARD, padding: 14, opacity: t.active ? 1 : 0.55, borderLeft: "4px solid #d1d5db" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#111827" }}>{t.name}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>
                        {t.minCapacity === t.maxCapacity ? `${t.minCapacity} guests` : `${t.minCapacity}–${t.maxCapacity} guests`}
                      </p>
                    </div>
                    {t.minSpend > 0 && (
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#6b7280" }}>${(t.minSpend / 100).toFixed(0)}<span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 400 }}> min</span></p>
                    )}
                  </div>
                  {t.description && <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 8px", lineHeight: 1.4 }}>{t.description}</p>}
                  {canWrite && groups.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <select
                        style={{ ...INPUT, fontSize: 12, padding: "5px 8px" }}
                        defaultValue=""
                        onChange={async e => {
                          const groupId = e.target.value
                          if (!groupId) return
                          const group = groups.find(g => g.id === groupId)
                          await updateDoc(doc(db, "venues", venueId, "tables", t.id), {
                            groupId, section: group?.name || "", color: group?.color || "",
                            updatedAt: serverTimestamp(),
                          })
                        }}
                      >
                        <option value="">— Assign to group —</option>
                        {groups.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {canWrite && (
                    <div style={{ display: "flex", gap: 5 }}>
                      <button onClick={() => setTableModal({ form: { name: t.name, groupId: t.groupId, minCapacity: t.minCapacity, maxCapacity: t.maxCapacity, minSpend: t.minSpend, description: t.description, active: t.active, id: t.id } as any })}
                        style={{ flex: 1, padding: "5px 0", borderRadius: 5, background: "#f3f4f6", border: "none", cursor: "pointer", fontSize: 11, color: "#374151" }}>Edit</button>
                      <button onClick={() => duplicateTable(t)}
                        style={{ padding: "5px 8px", borderRadius: 5, background: "#eff6ff", border: "none", cursor: "pointer", fontSize: 11, color: "#2563eb" }}>⧉</button>
                      <button onClick={() => deleteTable(t.id)}
                        style={{ padding: "5px 8px", borderRadius: 5, background: "#fee2e2", border: "none", cursor: "pointer", fontSize: 11, color: "#b91c1c" }}>✕</button>
                    </div>
                  )}
                  {canWrite && groups.length === 0 && (
                    <p style={{ fontSize: 11, color: "#9ca3af", margin: "6px 0 0" }}>Create a group above to assign this table.</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Modals */}
      {groupModal && (
        <GroupModal initial={groupModal.form}
          onSave={f => saveGroup(f, groupModal.id)}
          onClose={() => setGroupModal(null)} />
      )}
      {tableModal && (
        <TableModal initial={tableModal.form} groups={groups}
          onSave={f => saveTable(f, (tableModal.form as any).id)}
          onClose={() => setTableModal(null)} />
      )}
    </>
  )
}
