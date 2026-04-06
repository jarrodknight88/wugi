// ─────────────────────────────────────────────────────────────────────
// TimePicker — scroll or click to pick hour / minute / AM/PM
// Returns time as "10:00 PM" string
// ─────────────────────────────────────────────────────────────────────
"use client"
import { useState, useRef, useEffect } from "react"

type Props = { value: string; onChange: (v: string) => void; label?: string }

function parse(val: string): { h: number; m: number; ampm: "AM" | "PM" } {
  const match = val.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (match) return { h: parseInt(match[1]), m: parseInt(match[2]), ampm: match[3].toUpperCase() as "AM" | "PM" }
  return { h: 10, m: 0, ampm: "PM" }
}

const POPUP: React.CSSProperties = {
  position: "absolute", zIndex: 200, background: "#fff", borderRadius: 12,
  border: "1px solid #e5e7eb", boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
  padding: 16, top: "calc(100% + 6px)", right: 0, left: "auto", minWidth: 220,
}
const COL: React.CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }
const BTN = (active: boolean): React.CSSProperties => ({
  width: "100%", padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 14,
  background: active ? "#2a7a5a" : "#f9fafb", color: active ? "#fff" : "#374151",
  fontWeight: active ? 700 : 400,
})
const ARR: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#6b7280",
  lineHeight: 1, padding: "2px 8px",
}
const INPUT_S: React.CSSProperties = {
  padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14,
  outline: "none", width: "100%", boxSizing: "border-box", cursor: "pointer",
  background: "#fff", textAlign: "left", display: "flex", alignItems: "center", gap: 8,
}

export default function TimePicker({ value, onChange, label }: Props) {
  const [open, setOpen] = useState(false)
  const [{ h, m, ampm }, setState] = useState(() => parse(value || "10:00 PM"))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function close(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])

  useEffect(() => { setState(parse(value || "10:00 PM")) }, [value])

  function emit(newH: number, newM: number, newAmpm: "AM" | "PM") {
    const hStr = String(newH).padStart(2, "0")
    const mStr = String(newM).padStart(2, "0")
    onChange(`${hStr}:${mStr} ${newAmpm}`)
  }

  function incH() { const n = h >= 12 ? 1 : h + 1; setState(s => ({ ...s, h: n })); emit(n, m, ampm) }
  function decH() { const n = h <= 1 ? 12 : h - 1; setState(s => ({ ...s, h: n })); emit(n, m, ampm) }
  function incM() { const n = m >= 55 ? 0 : m + 5; setState(s => ({ ...s, m: n })); emit(h, n, ampm) }
  function decM() { const n = m <= 0 ? 55 : m - 5; setState(s => ({ ...s, m: n })); emit(h, n, ampm) }
  function toggleAmpm() { const n = ampm === "AM" ? "PM" : "AM"; setState(s => ({ ...s, ampm: n })); emit(h, m, n) }

  const display = value || `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")} ${ampm}`

  const QUICK = ["8:00 PM","9:00 PM","10:00 PM","11:00 PM","12:00 AM","2:00 AM"]

  return (
    <div style={{ position: "relative" }} ref={ref}>
      {label && <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>{label}</label>}
      <button type="button" onClick={() => setOpen(o => !o)} style={INPUT_S as any}>
        <span style={{ fontSize: 15 }}>🕐</span>
        <span style={{ color: value ? "#111827" : "#9ca3af" }}>{display}</span>
      </button>
      {open && (
        <div style={POPUP}>
          {/* Spinner row */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
            {/* Hour */}
            <div style={COL}>
              <button type="button" onClick={incH} style={ARR}>▲</button>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#111827", minWidth: 48, textAlign: "center" }}>{String(h).padStart(2,"0")}</div>
              <button type="button" onClick={decH} style={ARR}>▼</button>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#9ca3af", marginBottom: 2 }}>:</div>
            {/* Minute */}
            <div style={COL}>
              <button type="button" onClick={incM} style={ARR}>▲</button>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#111827", minWidth: 48, textAlign: "center" }}>{String(m).padStart(2,"0")}</div>
              <button type="button" onClick={decM} style={ARR}>▼</button>
            </div>
            {/* AM/PM */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <button type="button" onClick={() => { const n="AM"; setState(s=>({...s,ampm:n})); emit(h,m,n) }} style={BTN(ampm==="AM")}>AM</button>
              <button type="button" onClick={() => { const n="PM"; setState(s=>({...s,ampm:n})); emit(h,m,n) }} style={BTN(ampm==="PM")}>PM</button>
            </div>
          </div>
          {/* Quick picks */}
          <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", marginBottom: 6 }}>QUICK SELECT</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {QUICK.map(t => (
                <button key={t} type="button" onClick={() => { onChange(t); setState(parse(t)); setOpen(false) }}
                  style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, border: "1px solid #e5e7eb",
                    cursor: "pointer", background: value === t ? "#111827" : "#f9fafb",
                    color: value === t ? "#fff" : "#374151", fontWeight: value === t ? 600 : 400 }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
