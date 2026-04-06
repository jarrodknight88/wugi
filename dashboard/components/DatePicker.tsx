// ─────────────────────────────────────────────────────────────────────
// DatePicker — click a field, get a calendar, pick a date
// Returns date as "MMM DD YYYY" string (e.g. "APR 12 2026")
// ─────────────────────────────────────────────────────────────────────
"use client"
import { useState, useRef, useEffect } from "react"

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
const DAYS   = ["Su","Mo","Tu","We","Th","Fr","Sa"]

const S = {
  input: { padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14,
    outline: "none", width: "100%", boxSizing: "border-box" as const, cursor: "pointer",
    background: "#fff", textAlign: "left" as const },
  popup: { position: "absolute" as const, zIndex: 200, background: "#fff", borderRadius: 12,
    border: "1px solid #e5e7eb", boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
    padding: 16, width: 280, top: "calc(100% + 6px)", left: 0 },
  dayCell: (active: boolean, today: boolean, otherMonth: boolean) => ({
    width: 34, height: 34, borderRadius: 8, display: "flex", alignItems: "center",
    justifyContent: "center", fontSize: 13, cursor: "pointer",
    background: active ? "#2a7a5a" : today ? "#f0fdf4" : "transparent",
    color: active ? "#fff" : otherMonth ? "#d1d5db" : today ? "#2a7a5a" : "#374151",
    fontWeight: active || today ? 600 : 400,
  }),
}

type Props = { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }

export default function DatePicker({ value, onChange, placeholder = "Select date", label }: Props) {
  const today = new Date()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState({ month: today.getMonth(), year: today.getFullYear() })
  const ref = useRef<HTMLDivElement>(null)

  // Parse existing value back to Date for highlighting
  const selected = value ? new Date(value) : null

  useEffect(() => {
    function close(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])

  function daysInMonth(m: number, y: number) { return new Date(y, m + 1, 0).getDate() }
  function firstDay(m: number, y: number) { return new Date(y, m, 1).getDay() }

  function pick(day: number, month = view.month, year = view.year) {
    const d = new Date(year, month, day)
    const str = d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }).toUpperCase()
    onChange(str)
    setOpen(false)
  }

  function prevMonth() {
    setView(v => v.month === 0 ? { month: 11, year: v.year - 1 } : { month: v.month - 1, year: v.year })
  }
  function nextMonth() {
    setView(v => v.month === 11 ? { month: 0, year: v.year + 1 } : { month: v.month + 1, year: v.year })
  }

  const dims = daysInMonth(view.month, view.year)
  const fd   = firstDay(view.month, view.year)
  const prevDims = daysInMonth(view.month === 0 ? 11 : view.month - 1, view.month === 0 ? view.year - 1 : view.year)

  // Build 6×7 grid
  const cells: { day: number; month: number; year: number }[] = []
  for (let i = fd - 1; i >= 0; i--) {
    const m = view.month === 0 ? 11 : view.month - 1
    const y = view.month === 0 ? view.year - 1 : view.year
    cells.push({ day: prevDims - i, month: m, year: y })
  }
  for (let d = 1; d <= dims; d++) cells.push({ day: d, month: view.month, year: view.year })
  while (cells.length < 42) {
    const m = view.month === 11 ? 0 : view.month + 1
    const y = view.month === 11 ? view.year + 1 : view.year
    cells.push({ day: cells.length - dims - fd + 1, month: m, year: y })
  }

  return (
    <div style={{ position: "relative" }} ref={ref}>
      {label && <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>{label}</label>}
      <button type="button" onClick={() => setOpen(o => !o)} style={{ ...S.input, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15 }}>📅</span>
        <span style={{ color: value ? "#111827" : "#9ca3af" }}>{value || placeholder}</span>
      </button>
      {open && (
        <div style={S.popup}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <button type="button" onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#6b7280", padding: "2px 6px" }}>‹</button>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>{MONTHS[view.month]} {view.year}</span>
            <button type="button" onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#6b7280", padding: "2px 6px" }}>›</button>
          </div>
          {/* Day headers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
            {DAYS.map(d => <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "#9ca3af", padding: "2px 0" }}>{d}</div>)}
          </div>
          {/* Date cells */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {cells.map((c, i) => {
              const isToday = c.day === today.getDate() && c.month === today.getMonth() && c.year === today.getFullYear()
              const isSelected = selected && c.day === selected.getDate() && c.month === selected.getMonth() && c.year === selected.getFullYear()
              const isOther = c.month !== view.month
              return (
                <button key={i} type="button" onClick={() => pick(c.day, c.month, c.year)}
                  style={S.dayCell(!!isSelected, isToday, isOther)}>
                  {c.day}
                </button>
              )
            })}
          </div>
          {/* Today shortcut */}
          <div style={{ borderTop: "1px solid #f3f4f6", marginTop: 10, paddingTop: 10, textAlign: "center" }}>
            <button type="button" onClick={() => pick(today.getDate(), today.getMonth(), today.getFullYear())}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2a7a5a", fontWeight: 600 }}>
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
