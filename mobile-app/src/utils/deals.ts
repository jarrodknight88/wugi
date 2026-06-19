// ─────────────────────────────────────────────────────────────────────
// Wugi — deals.ts
//
// Client-side deal helpers: human labels, recurrence-lite "active now"
// evaluation, eligibility, and ordering. Computing eligibility here (rather
// than in a Firestore where()) sidesteps the canonical-status footgun — a
// deal with a missing/legacy status field is never silently dropped from a
// feed; it just isn't filtered out.
// ─────────────────────────────────────────────────────────────────────
import type { FSDeal } from '../types';

// dealType → short uppercase label for tags / search. Falls back to DEAL.
// NOTE: the canonical Home DealCard badge is intentionally always "DEAL";
// this richer label is used on the For You swipe card and in search.
const DEAL_TYPE_LABELS: Record<string, string> = {
  happyHour:    'HAPPY HOUR',
  luckyHour:    'LUCKY HOUR',
  flash:        'FLASH DEAL',
  drinkSpecial: 'DRINK SPECIAL',
  foodSpecial:  'FOOD SPECIAL',
  bogo:         'BOGO',
  other:        'DEAL',
};

export function dealTypeLabel(dealType?: string | null): string {
  if (!dealType) return 'DEAL';
  return DEAL_TYPE_LABELS[dealType] || 'DEAL';
}

// ── Time helpers ──────────────────────────────────────────────────────

/** "HH:MM" (24h) → minutes since midnight, or null if unparseable. */
function toMinutes(t?: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Firestore Timestamp | Date | millis → millis, or null. */
function toMillis(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.toDate === 'function') return v.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  return null;
}

/**
 * Parse a yearless display date ("SAT JUN 21") to a Date (this year). Local
 * helper — kept separate from the passes date parser so deals never couple
 * to the passes work. Returns null when missing/unparseable.
 */
function parseDisplayDate(dateStr?: string | null, now: Date = new Date()): Date | null {
  if (!dateStr) return null;
  const withoutWeekday = String(dateStr).replace(/^[A-Z]{2,3}\s+/i, '').trim();
  if (!withoutWeekday) return null;
  const parsed = new Date(`${withoutWeekday} ${now.getFullYear()}`);
  if (isNaN(parsed.getTime())) return null;
  return parsed;
}

/** Is `now` inside [start, end] minutes-of-day, honoring midnight wrap? */
function inTimeWindow(start: number | null, end: number | null, nowMin: number): boolean {
  if (start == null && end == null) return true;       // no time bounds = all day
  if (start == null) return nowMin <= (end as number);
  if (end == null) return nowMin >= start;
  if (end >= start) return nowMin >= start && nowMin <= end;
  // Wraps past midnight (e.g. 21:00 → 02:00) — nightlife window.
  return nowMin >= start || nowMin <= end;
}

// ── Eligibility + active-now ──────────────────────────────────────────

/**
 * Eligible = should appear in browsable deal sections at all: not paused/
 * expired, within any validFrom/validUntil run window, and (for one-off
 * flash deals) the single date hasn't fully passed. Deals with no timing
 * fields are always eligible (legacy/mock deals keep showing).
 */
export function isDealEligible(deal: FSDeal, now: Date = new Date()): boolean {
  if (deal.status && deal.status !== 'active') return false;
  if (deal.isActive === false) return false;

  const ms = now.getTime();
  const from = toMillis(deal.validFrom);
  if (from != null && ms < from) return false;
  const until = toMillis(deal.validUntil);
  if (until != null && ms > until) return false;

  // One-off / flash deal: drop once its day has fully ended.
  const isOneOff = !!deal.date && !(deal.daysOfWeek && deal.daysOfWeek.length > 0);
  if (isOneOff) {
    const d = parseDisplayDate(deal.date, now);
    if (d) {
      const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime();
      if (endOfDay < ms) return false;
    }
  }
  return true;
}

/**
 * Active now = eligible AND currently inside its schedule window.
 *   Recurring: today's weekday ∈ daysOfWeek and time within [start, end]
 *     (the window may cross midnight for late-night deals).
 *   One-off: today is the deal's date and within the time window.
 *   No timing fields: treated as active now (always-on deal).
 */
export function isDealActiveNow(deal: FSDeal, now: Date = new Date()): boolean {
  if (!isDealEligible(deal, now)) return false;

  const start = toMinutes(deal.startTime);
  const end = toMinutes(deal.endTime);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const hasRecurring = !!(deal.daysOfWeek && deal.daysOfWeek.length > 0);

  if (hasRecurring) {
    const today = now.getDay();
    const startsToday = deal.daysOfWeek!.includes(today);
    // For a window that wraps past midnight, also honor the previous day's
    // late window spilling into the early hours of today.
    const wrapsFromYesterday =
      start != null && end != null && end < start &&
      deal.daysOfWeek!.includes((today + 6) % 7) && nowMin <= end;
    if (!startsToday && !wrapsFromYesterday) return false;
    if (wrapsFromYesterday) return true;
    return inTimeWindow(start, end, nowMin);
  }

  if (deal.date) {
    const d = parseDisplayDate(deal.date, now);
    if (!d) return false;
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (!isToday) return false;
    return inTimeWindow(start, end, nowMin);
  }

  // No schedule → always-on.
  return true;
}

/**
 * Eligible deals ordered for display: active-now first, then featured,
 * preserving the incoming order within each tier (stable).
 */
export function orderDealsForDisplay(deals: FSDeal[], now: Date = new Date()): FSDeal[] {
  return deals
    .filter(d => isDealEligible(d, now))
    .map((deal, i) => ({ deal, i }))
    .sort((a, b) => {
      const an = isDealActiveNow(a.deal, now) ? 0 : 1;
      const bn = isDealActiveNow(b.deal, now) ? 0 : 1;
      if (an !== bn) return an - bn;
      const af = a.deal.isFeatured ? 0 : 1;
      const bf = b.deal.isFeatured ? 0 : 1;
      if (af !== bf) return af - bf;
      return a.i - b.i;
    })
    .map(x => x.deal);
}

/** Short offer line for a deal — prefers the legacy `detail`, then description. */
export function dealOffer(deal: FSDeal): string {
  return deal.detail || deal.description || '';
}
