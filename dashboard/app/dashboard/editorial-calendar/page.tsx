"use client"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
export const dynamic = 'force-dynamic'
import { collection, onSnapshot } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"
import { useVenueFilter } from "@/hooks/useVenueFilter"
import { buildMonthGrid } from "@/lib/calendarGrid"
import {
  computePlacements, computeDealOccurrences, bucketByDay, isDayUnderfilled,
  parseDashboardDate, toISODate, SEGMENTS,
  type PlacementEvent, type PlacementVenue, type DealInput, type CalendarItem, type PlacementTier,
} from "@/lib/placement"

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"]
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]

const TIER_STYLE: Record<PlacementTier, { bg: string; color: string; label: string }> = {
  "homepage-featured": { bg: "#fef3c7", color: "#92400e", label: "Homepage Featured" },
  "in-app-featured":   { bg: "#dbeafe", color: "#1e40af", label: "In-App Featured" },
  "standard-listing":  { bg: "#e5e7eb", color: "#374151", label: "Standard Listing" },
  "deal":              { bg: "#dcfce7", color: "#15803d", label: "Deal" },
}
const TIER_ORDER: PlacementTier[] = ["homepage-featured", "in-app-featured", "standard-listing", "deal"]

export default function EditorialCalendarPage() {
  const router = useRouter()
  const { user, hasDashboardAccess, hasUserDocument, loading } = useAuthContext()
  const { venueIds, eventIds } = useVenueFilter()

  const [rawEvents, setRawEvents] = useState<PlacementEvent[]>([])
  const [rawVenues, setRawVenues] = useState<PlacementVenue[]>([])
  const [rawDeals, setRawDeals] = useState<DealInput[]>([])
  const [view, setView] = useState<"calendar" | "list">("calendar")
  const [segmentId, setSegmentId] = useState(SEGMENTS.find(s => s.isDefault)?.id ?? SEGMENTS[0].id)
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
    if (hasUserDocument && !hasDashboardAccess) router.replace("/unauthorized")
  }, [loading, user, hasDashboardAccess, hasUserDocument, router])

  useEffect(() => {
    if (!user) return
    const u1 = onSnapshot(collection(db, "events"), s => {
      let all: PlacementEvent[] = s.docs.map(d => {
        const data = d.data() as any
        return {
          id: d.id,
          title: data.title || "Untitled",
          venueId: data.venueId || "",
          venueName: data.venue || "",
          dateISO: parseDashboardDate(data.date) || "",
          status: data.status || "pending",
          isActive: data.isActive,
          hasTickets: !!data.hasTickets,
          isFeatured: !!data.isFeatured,
          eventFeatured: !!data.eventFeatured,
        }
      }).filter(e => e.dateISO) // no parseable date = nothing to place on a calendar
      if (venueIds !== null) all = all.filter(e => venueIds.includes(e.venueId))
      if (eventIds !== null) all = all.filter(e => eventIds.includes(e.id))
      setRawEvents(all)
    })
    const u2 = onSnapshot(collection(db, "venues"), s => {
      let all: PlacementVenue[] = s.docs.map(d => ({ id: d.id, tier: (d.data() as any).tier }))
      if (venueIds !== null) all = all.filter(v => venueIds.includes(v.id))
      setRawVenues(all)
    })
    const u3 = onSnapshot(collection(db, "deals"), s => {
      let all: DealInput[] = s.docs.map(d => {
        const data = d.data() as any
        return {
          id: d.id,
          title: data.title || "Untitled",
          venueId: data.venueId || "",
          venueName: data.venueName || "",
          dealType: data.dealType,
          status: data.status,
          isActive: data.isActive,
          daysOfWeek: Array.isArray(data.daysOfWeek) && data.daysOfWeek.length ? data.daysOfWeek : undefined,
          date: data.date || undefined,
          validFrom: typeof data.validFrom?.toDate === "function" ? toISODate(data.validFrom.toDate()) : null,
          validUntil: typeof data.validUntil?.toDate === "function" ? toISODate(data.validUntil.toDate()) : null,
        }
      })
      if (venueIds !== null) all = all.filter(dl => venueIds.includes(dl.venueId))
      setRawDeals(all)
    })
    return () => { u1(); u2(); u3() }
  }, [user, venueIds, eventIds])

  const today = toISODate(new Date())

  // Placement (homepage/in-app/standard) is computed once across ALL known
  // events — the rolling window is anchored to `today`, not to whatever
  // month the calendar happens to be showing.
  const placedEvents = useMemo(
    () => computePlacements(rawEvents, rawVenues, { today, segmentId }),
    [rawEvents, rawVenues, today, segmentId]
  )

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor])
  const rangeStart = grid[0].dateISO
  const rangeEnd = grid[grid.length - 1].dateISO

  const placedDeals = useMemo(
    () => computeDealOccurrences(rawDeals, rangeStart, rangeEnd),
    [rawDeals, rangeStart, rangeEnd]
  )

  // Calendar and list share this exact same slice — same underlying data,
  // just two renderings of it.
  const itemsInView = useMemo<CalendarItem[]>(() => {
    const eventsInRange = placedEvents.filter(e => e.dateISO >= rangeStart && e.dateISO <= rangeEnd)
    return [...eventsInRange, ...placedDeals]
  }, [placedEvents, placedDeals, rangeStart, rangeEnd])

  const buckets = useMemo(() => bucketByDay(itemsInView), [itemsInView])

  const listDays = useMemo(
    () => Array.from(buckets.keys()).sort(),
    [buckets]
  )

  function prevMonth() { setCursor(c => c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }) }
  function nextMonth() { setCursor(c => c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }) }
  function goToday() { const d = new Date(); setCursor({ year: d.getFullYear(), month: d.getMonth() }) }

  if (loading || !user || !hasDashboardAccess) return null

  return (
    <div className="dash-page">
      <div className="dash-header">
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Editorial Calendar</h1>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4, maxWidth: 640 }}>
            Computed placement across a rolling 7-day homepage window, read-only in this phase.
            Shows what&apos;s eligible to be shown and where — not what any one user saw.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setView("calendar")} style={toggleBtn(view === "calendar")}>Calendar</button>
          <button onClick={() => setView("list")} style={toggleBtn(view === "list")}>List</button>
        </div>
      </div>

      <div className="dash-filters">
        <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Segment</label>
        <select value={segmentId} onChange={e => setSegmentId(e.target.value)} style={selectStyle}>
          {SEGMENTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {view === "calendar" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
            <button onClick={prevMonth} style={navBtn}>‹</button>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#111827", minWidth: 140, textAlign: "center" }}>
              {MONTHS[cursor.month]} {cursor.year}
            </span>
            <button onClick={nextMonth} style={navBtn}>›</button>
            <button onClick={goToday} style={{ ...navBtn, width: "auto", padding: "0 12px", fontSize: 13 }}>Today</button>
          </div>
        )}
      </div>

      <Legend />

      {view === "calendar"
        ? <CalendarGrid grid={grid} buckets={buckets} today={today} currentMonth={cursor.month} />
        : <ListView days={listDays} buckets={buckets} today={today} />}
    </div>
  )
}

function Legend() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 20, alignItems: "center" }}>
      {TIER_ORDER.map(tier => (
        <div key={tier} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151" }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: TIER_STYLE[tier].bg, border: `1px solid ${TIER_STYLE[tier].color}` }} />
          {TIER_STYLE[tier].label}
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#b91c1c" }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, border: "1px dashed #b91c1c" }} />
        Under-filled day
      </div>
    </div>
  )
}

function CalendarGrid({ grid, buckets, today, currentMonth }: {
  grid: { dateISO: string; day: number; inCurrentMonth: boolean }[]
  buckets: Map<string, CalendarItem[]>
  today: string
  currentMonth: number
}) {
  return (
    <div className="dash-table-wrap" style={{ padding: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
        {DOW.map(d => (
          <div key={d} style={{ textAlign: "center", fontSize: 12, fontWeight: 600, color: "#9ca3af", padding: "4px 0" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {grid.map(cell => {
          const items = buckets.get(cell.dateISO) || []
          const underfilled = isDayUnderfilled(items)
          const isToday = cell.dateISO === today
          return (
            <div key={cell.dateISO} style={{
              minHeight: 88, borderRadius: 8, padding: 6,
              background: cell.inCurrentMonth ? "#fff" : "#fafafa",
              border: underfilled && cell.inCurrentMonth ? "1px dashed #b91c1c" : "1px solid #e5e7eb",
              opacity: cell.inCurrentMonth ? 1 : 0.5,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? "#2a7a5a" : "#374151" }}>{cell.day}</span>
                {items.length > 0 && <span style={{ fontSize: 11, color: "#6b7280" }}>{items.length}</span>}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 6 }}>
                {items.slice(0, 8).map(item => (
                  <span key={item.id} title={`${item.title} (${TIER_STYLE[item.tier].label})`}
                    style={{ width: 8, height: 8, borderRadius: 2, background: TIER_STYLE[item.tier].bg, border: `1px solid ${TIER_STYLE[item.tier].color}` }} />
                ))}
                {items.length > 8 && <span style={{ fontSize: 10, color: "#9ca3af" }}>+{items.length - 8}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ListView({ days, buckets, today }: { days: string[]; buckets: Map<string, CalendarItem[]>; today: string }) {
  if (days.length === 0) {
    return <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>Nothing eligible in this range.</div>
  }
  return (
    <div className="dash-table-wrap">
      {days.map(day => {
        const items = buckets.get(day) || []
        const underfilled = isDayUnderfilled(items)
        const label = new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
        return (
          <div key={day} style={{ borderBottom: "1px solid #f3f4f6", padding: "12px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <strong style={{ fontSize: 14, color: day === today ? "#2a7a5a" : "#111827" }}>{label}{day === today ? " · Tonight" : ""}</strong>
              <span style={{ fontSize: 12, color: "#6b7280" }}>{items.length} eligible</span>
              {underfilled && <span style={{ fontSize: 11, color: "#b91c1c", border: "1px dashed #b91c1c", borderRadius: 6, padding: "1px 6px" }}>Under-filled</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {items.map(item => (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                    background: TIER_STYLE[item.tier].bg, color: TIER_STYLE[item.tier].color,
                  }}>
                    {TIER_STYLE[item.tier].label}
                  </span>
                  <span style={{ color: "#111827" }}>{item.title}</span>
                  <span style={{ color: "#9ca3af" }}>· {item.venueName}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const navBtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 16, color: "#374151" }
const selectStyle: React.CSSProperties = { padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }
function toggleBtn(active: boolean): React.CSSProperties {
  return {
    padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, fontWeight: 600,
    background: active ? "#111827" : "#fff", color: active ? "#fff" : "#374151", cursor: "pointer",
  }
}
