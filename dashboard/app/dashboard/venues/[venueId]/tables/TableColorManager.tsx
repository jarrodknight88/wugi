'use client'

import { useState, useEffect, useCallback } from 'react'
import { db } from '@/lib/firebase'
import {
  collection, doc, getDocs, setDoc, deleteDoc,
  query, orderBy, Timestamp
} from 'firebase/firestore'

// ── Types ────────────────────────────────────────────────────────────
interface TableColor {
  id:          string
  tableNumber: number
  label:       string
  section:     string
  color:       string
  capacity:    number
  updatedAt?:  Timestamp
}

// ── Preset color palette ─────────────────────────────────────────────
const PALETTE = [
  { hex: '#7c3aed', name: 'Purple'    },
  { hex: '#1d4ed8', name: 'Blue'      },
  { hex: '#0f766e', name: 'Teal'      },
  { hex: '#2a7a5a', name: 'Green'     },
  { hex: '#b45309', name: 'Amber'     },
  { hex: '#c2410c', name: 'Orange'    },
  { hex: '#be123c', name: 'Rose'      },
  { hex: '#86198f', name: 'Fuchsia'   },
  { hex: '#0e7490', name: 'Cyan'      },
  { hex: '#374151', name: 'Slate'     },
  { hex: '#1e293b', name: 'Navy'      },
  { hex: '#111827', name: 'Black'     },
]

// ── ColorPicker ──────────────────────────────────────────────────────
function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PALETTE.map(p => (
        <button
          key={p.hex}
          title={p.name}
          onClick={() => onChange(p.hex)}
          className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
          style={{
            backgroundColor: p.hex,
            borderColor: value === p.hex ? '#fff' : 'transparent',
            boxShadow: value === p.hex ? `0 0 0 2px ${p.hex}` : 'none',
          }}
        />
      ))}
      {/* Custom hex input */}
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-7 h-7 rounded-full cursor-pointer border-0 p-0"
        title="Custom color"
      />
    </div>
  )
}

// ── TableRow ─────────────────────────────────────────────────────────
function TableRow({
  table, onSave, onDelete
}: {
  table: TableColor
  onSave: (t: TableColor) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState(table)
  const [saving, setSaving]     = useState(false)

  async function handleSave() {
    setSaving(true)
    await onSave(draft)
    setSaving(false)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="w-8 h-8 rounded-lg flex-shrink-0" style={{ backgroundColor: table.color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-900 dark:text-white text-sm">{table.label}</span>
            {table.section && (
              <span className="text-xs text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">{table.section}</span>
            )}
          </div>
          <div className="text-xs text-zinc-400 mt-0.5">Table #{table.tableNumber} · Capacity: {table.capacity}</div>
        </div>
        <button onClick={() => setEditing(true)} className="text-xs text-blue-500 hover:underline">Edit</button>
        <button onClick={() => onDelete(table.id)} className="text-xs text-red-400 hover:underline">Delete</button>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 bg-white dark:bg-zinc-900 rounded-xl border-2 border-blue-500 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">Label</label>
          <input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
            className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">Section</label>
          <input value={draft.section} onChange={e => setDraft(d => ({ ...d, section: e.target.value }))}
            placeholder="e.g. Main Floor, VIP Lounge"
            className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">Table #</label>
          <input type="number" value={draft.tableNumber} onChange={e => setDraft(d => ({ ...d, tableNumber: Number(e.target.value) }))}
            className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">Capacity</label>
          <input type="number" value={draft.capacity} onChange={e => setDraft(d => ({ ...d, capacity: Number(e.target.value) }))}
            className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-500 mb-2">Pass Color</label>
        <ColorPicker value={draft.color} onChange={hex => setDraft(d => ({ ...d, color: hex }))} />
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => { setDraft(table); setEditing(false) }}
          className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-sm font-medium rounded-lg">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main TableColorManager ────────────────────────────────────────────
export default function TableColorManager({ venueId, venueName }: { venueId: string; venueName: string }) {
  const [tables, setTables]     = useState<TableColor[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [section, setSection]   = useState('All')
  const [showAdd, setShowAdd]   = useState(false)
  const [newTable, setNewTable] = useState<Partial<TableColor>>({
    tableNumber: 1, label: '', section: '', color: '#7c3aed', capacity: 6
  })

  const colRef = useCallback(
    () => collection(db, 'venues', venueId, 'tableColors'),
    [venueId]
  )

  useEffect(() => {
    getDocs(query(colRef(), orderBy('tableNumber', 'asc'))).then(snap => {
      setTables(snap.docs.map(d => ({ id: d.id, ...d.data() } as TableColor)))
      setLoading(false)
    })
  }, [colRef])

  async function handleSave(t: TableColor) {
    const ref = doc(db, 'venues', venueId, 'tableColors', t.id)
    const data = { tableNumber: t.tableNumber, label: t.label, section: t.section, color: t.color, capacity: t.capacity, updatedAt: Timestamp.now() }
    await setDoc(ref, data, { merge: true })
    setTables(prev => prev.map(p => p.id === t.id ? { ...p, ...data } : p))
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this table?')) return
    await deleteDoc(doc(db, 'venues', venueId, 'tableColors', id))
    setTables(prev => prev.filter(p => p.id !== id))
  }

  async function handleAdd() {
    if (!newTable.label || !newTable.tableNumber) return
    const id  = `table_${newTable.tableNumber}`
    const ref = doc(db, 'venues', venueId, 'tableColors', id)
    const data = { tableNumber: newTable.tableNumber!, label: newTable.label!, section: newTable.section || '', color: newTable.color!, capacity: newTable.capacity || 6, updatedAt: Timestamp.now() }
    await setDoc(ref, data)
    setTables(prev => [...prev, { id, ...data }].sort((a, b) => a.tableNumber - b.tableNumber))
    setNewTable({ tableNumber: (newTable.tableNumber || 1) + 1, label: '', section: newTable.section, color: newTable.color, capacity: newTable.capacity })
    setShowAdd(false)
  }

  const sections   = ['All', ...Array.from(new Set(tables.map(t => t.section).filter(Boolean)))]
  const filtered   = tables.filter(t => {
    const matchSearch  = !search || t.label.toLowerCase().includes(search.toLowerCase()) || String(t.tableNumber).includes(search)
    const matchSection = section === 'All' || t.section === section
    return matchSearch && matchSection
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Table Colors</h2>
          <p className="text-sm text-zinc-500 mt-0.5">{venueName} · {tables.length} tables</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl">
          + Add Table
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tables…"
          className="flex-1 min-w-48 text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white" />
        <select value={section} onChange={e => setSection(e.target.value)}
          className="text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white">
          {sections.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 space-y-3">
          <h3 className="font-semibold text-sm text-zinc-900 dark:text-white">New Table</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Label</label>
              <input value={newTable.label} onChange={e => setNewTable(d => ({ ...d, label: e.target.value }))} placeholder="VIP Table 1"
                className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Section</label>
              <input value={newTable.section} onChange={e => setNewTable(d => ({ ...d, section: e.target.value }))} placeholder="Main Floor"
                className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Table #</label>
              <input type="number" value={newTable.tableNumber} onChange={e => setNewTable(d => ({ ...d, tableNumber: Number(e.target.value) }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Capacity</label>
              <input type="number" value={newTable.capacity} onChange={e => setNewTable(d => ({ ...d, capacity: Number(e.target.value) }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-2">Pass Color</label>
            <ColorPicker value={newTable.color || '#7c3aed'} onChange={hex => setNewTable(d => ({ ...d, color: hex }))} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg">Add Table</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-sm font-semibold rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {/* Table list */}
      {loading ? (
        <div className="text-center py-12 text-zinc-400">Loading tables…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-zinc-400">No tables yet. Add your first table above.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(t => (
            <TableRow key={t.id} table={t} onSave={handleSave} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
