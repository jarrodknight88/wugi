// ─────────────────────────────────────────────────────────────────────
// SearchSelect — type to filter, click to select
// Supports single select (default) and multi-select mode
// ─────────────────────────────────────────────────────────────────────
"use client"
import { useState, useRef, useEffect, useMemo } from "react"

export type SelectOption = { id: string; label: string; sub?: string }

type BaseProps = {
  options:     SelectOption[]
  placeholder?: string
  label?:      string
  disabled?:   boolean
}

type SingleProps = BaseProps & {
  multi?:    false
  value:     string
  onChange:  (id: string, label: string) => void
}

type MultiProps = BaseProps & {
  multi:     true
  value:     string[]
  onChange:  (ids: string[]) => void
}

type Props = SingleProps | MultiProps

const POPUP: React.CSSProperties = {
  position: "absolute", zIndex: 200, background: "#fff", borderRadius: 12,
  border: "1px solid #e5e7eb", boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
  top: "calc(100% + 4px)", left: 0, right: 0, maxHeight: 280, overflowY: "auto",
}

export default function SearchSelect(props: Props) {
  const { options, placeholder = "Search...", label, disabled } = props
  const isMulti = props.multi === true

  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState("")
  const ref    = useRef<HTMLDivElement>(null)
  const inpRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setQuery("")
      }
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])

  function openDropdown() {
    if (disabled) return
    setOpen(true); setQuery("")
    setTimeout(() => inpRef.current?.focus(), 50)
  }

  // Single-select helpers
  const selectedSingle = !isMulti
    ? options.find(o => o.id === (props as SingleProps).value)
    : null

  // Multi-select helpers
  const selectedIds: string[] = isMulti ? (props as MultiProps).value : []
  const selectedMulti = isMulti ? options.filter(o => selectedIds.includes(o.id)) : []

  function handleSelect(opt: SelectOption) {
    if (isMulti) {
      const mp = props as MultiProps
      const next = selectedIds.includes(opt.id)
        ? selectedIds.filter(id => id !== opt.id)
        : [...selectedIds, opt.id]
      mp.onChange(next)
    } else {
      const sp = props as SingleProps
      sp.onChange(opt.id, opt.label)
      setOpen(false); setQuery("")
    }
  }

  function clearSingle(e: React.MouseEvent) {
    e.stopPropagation()
    if (!isMulti) (props as SingleProps).onChange("", "")
  }

  function removeMulti(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (isMulti) (props as MultiProps).onChange(selectedIds.filter(x => x !== id))
  }

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return options.slice(0, 50)
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || (o.sub || "").toLowerCase().includes(q)
    ).slice(0, 50)
  }, [query, options])

  const TRIGGER: React.CSSProperties = {
    padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14,
    outline: "none", width: "100%", boxSizing: "border-box",
    cursor: disabled ? "not-allowed" : "pointer",
    background: disabled ? "#f9fafb" : "#fff",
    display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6,
    minHeight: 42, opacity: disabled ? 0.6 : 1,
  }

  return (
    <div style={{ position: "relative" }} ref={ref}>
      {label && (
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
          {label}
        </label>
      )}

      {/* Trigger */}
      <div onClick={openDropdown} style={TRIGGER}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>🔍</span>

        {isMulti ? (
          selectedMulti.length === 0 ? (
            <span style={{ color: "#9ca3af", fontSize: 14 }}>{placeholder}</span>
          ) : (
            selectedMulti.map(opt => (
              <span key={opt.id} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 8px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                background: "#111827", color: "#fff",
              }}>
                {opt.label}
                <button type="button" onClick={e => removeMulti(opt.id, e)} style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#9ca3af", fontSize: 14, lineHeight: 1, padding: 0,
                }}>×</button>
              </span>
            ))
          )
        ) : (
          selectedSingle ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: "#111827", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedSingle.label}
              </div>
              {selectedSingle.sub && (
                <div style={{ fontSize: 12, color: "#9ca3af" }}>{selectedSingle.sub}</div>
              )}
            </div>
          ) : (
            <span style={{ color: "#9ca3af", fontSize: 14 }}>{placeholder}</span>
          )
        )}

        <div style={{ marginLeft: "auto", flexShrink: 0 }}>
          {!isMulti && selectedSingle ? (
            <button type="button" onClick={clearSingle} style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#9ca3af", fontSize: 18, lineHeight: 1, padding: "0 2px",
            }}>×</button>
          ) : (
            <span style={{ color: "#9ca3af", fontSize: 14 }}>▾</span>
          )}
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={POPUP}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", position: "sticky", top: 0, background: "#fff" }}>
            <input
              ref={inpRef} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Type to search..."
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          {filtered.length === 0 ? (
            <div style={{ padding: "20px 16px", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>No results</div>
          ) : filtered.map(opt => {
            const isSelected = isMulti ? selectedIds.includes(opt.id) : opt.id === (props as SingleProps).value
            return (
              <div
                key={opt.id}
                onClick={() => handleSelect(opt)}
                style={{
                  padding: "10px 16px", cursor: "pointer",
                  borderBottom: "1px solid #f9fafb",
                  background: isSelected ? "#f0fdf4" : "transparent",
                  display: "flex", alignItems: "center", gap: 10,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = isSelected ? "#f0fdf4" : "#f9fafb")}
                onMouseLeave={e => (e.currentTarget.style.background = isSelected ? "#f0fdf4" : "transparent")}
              >
                {isMulti && (
                  <div style={{
                    width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                    border: `2px solid ${isSelected ? "#111827" : "#d1d5db"}`,
                    background: isSelected ? "#111827" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {isSelected && <span style={{ color: "#fff", fontSize: 11, lineHeight: 1 }}>✓</span>}
                  </div>
                )}
                <div>
                  <div style={{ fontWeight: isSelected ? 600 : 400, color: "#111827", fontSize: 14 }}>{opt.label}</div>
                  {opt.sub && <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 1 }}>{opt.sub}</div>}
                </div>
              </div>
            )
          })}
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
