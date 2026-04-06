// ─────────────────────────────────────────────────────────────────────
// SearchSelect — type to filter, click to select
// Used for venue/event pickers that reference Firestore data
// ─────────────────────────────────────────────────────────────────────
"use client"
import { useState, useRef, useEffect, useMemo } from "react"

export type SelectOption = { id: string; label: string; sub?: string }

type Props = {
  value: string          // currently selected id
  options: SelectOption[]
  onChange: (id: string, label: string) => void
  placeholder?: string
  label?: string
  disabled?: boolean
}

const POPUP: React.CSSProperties = {
  position: "absolute", zIndex: 200, background: "#fff", borderRadius: 12,
  border: "1px solid #e5e7eb", boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
  top: "calc(100% + 4px)", left: 0, right: 0, maxHeight: 280, overflowY: "auto",
}

export default function SearchSelect({ value, options, onChange, placeholder = "Search...", label, disabled }: Props) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState("")
  const ref  = useRef<HTMLDivElement>(null)
  const inpRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.id === value)

  useEffect(() => {
    function close(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery("") } }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])

  function openDropdown() {
    if (disabled) return
    setOpen(true)
    setQuery("")
    setTimeout(() => inpRef.current?.focus(), 50)
  }

  function select(opt: SelectOption) {
    onChange(opt.id, opt.label)
    setOpen(false)
    setQuery("")
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange("", "")
  }

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return options.slice(0, 50)
    return options.filter(o => o.label.toLowerCase().includes(q) || (o.sub || "").toLowerCase().includes(q)).slice(0, 50)
  }, [query, options])

  const INPUT_STYLE: React.CSSProperties = {
    padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14,
    outline: "none", width: "100%", boxSizing: "border-box", cursor: disabled ? "not-allowed" : "pointer",
    background: disabled ? "#f9fafb" : "#fff", display: "flex", alignItems: "center",
    justifyContent: "space-between", gap: 8, opacity: disabled ? 0.6 : 1,
  }

  return (
    <div style={{ position: "relative" }} ref={ref}>
      {label && <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>{label}</label>}

      {/* Trigger */}
      <div onClick={openDropdown} style={INPUT_STYLE}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14 }}>🔍</span>
          {selected ? (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: "#111827", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.label}</div>
              {selected.sub && <div style={{ fontSize: 12, color: "#9ca3af" }}>{selected.sub}</div>}
            </div>
          ) : (
            <span style={{ color: "#9ca3af", fontSize: 14 }}>{placeholder}</span>
          )}
        </div>
        {selected ? (
          <button type="button" onClick={clear} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 18, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>×</button>
        ) : (
          <span style={{ color: "#9ca3af", fontSize: 14, flexShrink: 0 }}>▾</span>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div style={POPUP}>
          {/* Search input */}
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", position: "sticky", top: 0, background: "#fff" }}>
            <input ref={inpRef} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Type to search..."
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #e5e7eb",
                fontSize: 14, outline: "none", boxSizing: "border-box" }}/>
          </div>
          {/* Results */}
          {filtered.length === 0 ? (
            <div style={{ padding: "20px 16px", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>No results</div>
          ) : filtered.map(opt => (
            <div key={opt.id} onClick={() => select(opt)}
              style={{ padding: "10px 16px", cursor: "pointer", borderBottom: "1px solid #f9fafb",
                background: opt.id === value ? "#f0fdf4" : "transparent" }}
              onMouseEnter={e => (e.currentTarget.style.background = opt.id === value ? "#f0fdf4" : "#f9fafb")}
              onMouseLeave={e => (e.currentTarget.style.background = opt.id === value ? "#f0fdf4" : "transparent")}>
              <div style={{ fontWeight: opt.id === value ? 600 : 400, color: "#111827", fontSize: 14 }}>{opt.label}</div>
              {opt.sub && <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 1 }}>{opt.sub}</div>}
            </div>
          ))}
          {options.length > 50 && filtered.length === 50 && (
            <div style={{ padding: "8px 16px", fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
              Showing first 50 — type to narrow results
            </div>
          )}
        </div>
      )}
    </div>
  )
}
