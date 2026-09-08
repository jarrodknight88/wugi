// ─────────────────────────────────────────────────────────────────────
// Wugi — month-grid builder for the editorial calendar
//
// Standalone from components/DatePicker.tsx (which builds a similar 6×7
// grid for single-date selection) — kept separate so this feature doesn't
// risk regressing the event/deal creation forms by refactoring shared code.
// ─────────────────────────────────────────────────────────────────────
import { toISODate } from "./placement"

export type CalendarCell = { dateISO: string; day: number; inCurrentMonth: boolean }

/** Always 42 cells (6 weeks) so the grid height never jumps between months. */
export function buildMonthGrid(year: number, month: number): CalendarCell[] {
  const daysInMonth = (m: number, y: number) => new Date(y, m + 1, 0).getDate()
  const firstDay = (m: number, y: number) => new Date(y, m, 1).getDay()

  const dims = daysInMonth(month, year)
  const fd = firstDay(month, year)
  const prevMonth = month === 0 ? 11 : month - 1
  const prevYear = month === 0 ? year - 1 : year
  const prevDims = daysInMonth(prevMonth, prevYear)

  const cells: CalendarCell[] = []
  for (let i = fd - 1; i >= 0; i--) {
    const day = prevDims - i
    cells.push({ dateISO: toISODate(new Date(prevYear, prevMonth, day)), day, inCurrentMonth: false })
  }
  for (let day = 1; day <= dims; day++) {
    cells.push({ dateISO: toISODate(new Date(year, month, day)), day, inCurrentMonth: true })
  }
  const nextMonth = month === 11 ? 0 : month + 1
  const nextYear = month === 11 ? year + 1 : year
  let nextDay = 1
  while (cells.length < 42) {
    cells.push({ dateISO: toISODate(new Date(nextYear, nextMonth, nextDay)), day: nextDay, inCurrentMonth: false })
    nextDay++
  }
  return cells
}
