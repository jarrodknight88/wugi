// ─────────────────────────────────────────────────────────────────────
// Wugi — event date/time display formatting.
//
// `EventData.date`/`.time` already arrive as pre-formatted display strings
// off the Firestore doc (e.g. "TUE JUN 9", "9:00 PM") — see
// functions/src/series/generateSeriesEvents.ts `displayFromISO`. These
// helpers reformat those strings for the design system's compact pill
// style ("FRI AUG 01", "9 PM") without touching the underlying ET
// semantics. Unrecognized shapes pass through unchanged rather than
// throwing, since this is a display-only reformat, not a parser of record.
// ─────────────────────────────────────────────────────────────────────

const DATE_RE = /^([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d{1,2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

// "TUE JUN 9" → "TUE JUN 09". No year in either form.
export function formatEventDateLabel(raw?: string | null): string {
  if (!raw) return raw ?? '';
  const m = raw.trim().match(DATE_RE);
  if (!m) return raw;
  const [, dow, mon, day] = m;
  return `${dow.toUpperCase()} ${mon.toUpperCase()} ${day.padStart(2, '0')}`;
}

// "9:00 PM" → "9 PM"; "10:30 PM" stays "10:30 PM" (minutes kept when non-zero).
export function formatEventTimeLabel(raw?: string | null): string {
  if (!raw) return raw ?? '';
  const m = raw.trim().match(TIME_RE);
  if (!m) return raw;
  const [, hourStr, minuteStr, meridiem] = m;
  const hour = String(parseInt(hourStr, 10));
  const upperMeridiem = meridiem.toUpperCase();
  return minuteStr === '00' ? `${hour} ${upperMeridiem}` : `${hour}:${minuteStr} ${upperMeridiem}`;
}
