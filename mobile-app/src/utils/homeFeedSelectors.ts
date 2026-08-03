// ─────────────────────────────────────────────────────────────────────
// Wugi — Home feed selectors: "Picks for you" + "This weekend" (UAT-W3-2).
//
// Both rails on HomeScreen draw from the same fetched event pool. Once an
// event has been surfaced in "Picks for you" it is hard-excluded from
// "This weekend" so the two rails never show duplicate cards. Dedup is
// session-scoped: a module-scope Set survives re-renders and refreshes
// but resets on app cold start — in-memory is sufficient per the task,
// no AsyncStorage/persistence needed.
// ─────────────────────────────────────────────────────────────────────
import type { EventData } from '../types';

const seenInPicksForYou = new Set<string>();

// Exposed for tests only — clears the module-scope seen-set between cases.
export function __resetHomeFeedSeenSetForTests(): void {
  seenInPicksForYou.clear();
}

// "Picks for you" — first N of the (already vibe-filtered server-side)
// event pool. Records every id it returns into the shared seen-set so
// selectThisWeekend() can exclude them.
export function selectPicksForYou(eventList: EventData[], limit = 8): EventData[] {
  const picks = eventList.slice(0, limit);
  picks.forEach(e => seenInPicksForYou.add(e.id));
  return picks;
}

// ── This weekend window: Thu–Sun of the current week, ET ──────────────
// "Current week" is anchored to today rather than a fixed Mon/Sun week
// start: the window is always the Thu→Sun span containing (or immediately
// following) today in America/New_York, so it reads naturally any day of
// the week — e.g. on a Saturday, "this weekend" still includes the
// Thursday/Friday already passed plus tomorrow (Sunday).
const ET_ISO_WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function getThisWeekendRangeET(now: Date = new Date()): { startISO: string; endISO: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map(x => [x.type, x.value]));
  const isoWeekday = ET_ISO_WEEKDAY[p.weekday];
  // Date.UTC of the ET calendar-day components, then whole-day arithmetic —
  // DST-safe without a tz lib, same approach as minEligibleDateISOEastern()
  // in firestoreService.ts.
  const todayUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  const thursdayUTC = todayUTC + (4 - isoWeekday) * 86400000;
  const sundayUTC = thursdayUTC + 3 * 86400000;
  return {
    startISO: new Date(thursdayUTC).toISOString().slice(0, 10),
    endISO: new Date(sundayUTC).toISOString().slice(0, 10),
  };
}

// "This weekend" — events whose dateISO falls Thu–Sun (ET) of the current
// week, hard-excluding anything already shown in "Picks for you" this
// session. Undated events (no dateISO) are excluded — a dated-window rail
// can't place them. Caller hides the section entirely when this returns [].
export function selectThisWeekend(eventList: EventData[], now: Date = new Date(), limit = 6): EventData[] {
  const { startISO, endISO } = getThisWeekendRangeET(now);
  return eventList
    .filter(e => !!e.dateISO && e.dateISO >= startISO && e.dateISO <= endISO)
    .filter(e => !seenInPicksForYou.has(e.id))
    .slice(0, limit);
}
