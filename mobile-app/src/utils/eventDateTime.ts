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

// ─────────────────────────────────────────────────────────────────────
// formatEventDateShort — the UAT-A2 date standard: "Fri Nov 21" (weekday
// abbrev + month abbrev + day, title case, NO year). `includeYear` is for
// archival gallery/photo contexts only.
//
// Accepts a real Date/timestamp or an ISO "YYYY-MM-DD" string — both format
// through Intl with timeZone America/New_York, so the result is correct
// regardless of the device's local timezone. Also accepts Wugi's existing
// pre-formatted display strings ("TUE JUN 9", see file header) for call
// sites that only have that string on hand — those carry no absolute
// instant to convert, so they're simply re-cased in place (never carry a
// year, so `includeYear` has no effect on this path).
// ─────────────────────────────────────────────────────────────────────
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function formatInEastern(date: Date, includeYear?: boolean): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
  };
  if (includeYear) options.year = 'numeric';
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

export function formatEventDateShort(
  value?: string | Date | null,
  opts?: { includeYear?: boolean }
): string {
  if (!value) return '';

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? '' : formatInEastern(value, opts?.includeYear);
  }

  const trimmed = value.trim();
  const isoMatch = trimmed.match(ISO_DATE_RE);
  if (isoMatch) {
    // Noon UTC always falls on the same America/New_York calendar day
    // (ET trails UTC year-round), so this is DST-safe without a TZ lib —
    // mirrors dayOfWeekET() in firestoreService.ts.
    const d = new Date(`${trimmed.slice(0, 10)}T12:00:00Z`);
    if (!isNaN(d.getTime())) return formatInEastern(d, opts?.includeYear);
  }

  const displayMatch = trimmed.match(DATE_RE);
  if (!displayMatch) return trimmed;
  const [, dow, mon, day] = displayMatch;
  return `${titleCase(dow)} ${titleCase(mon)} ${parseInt(day, 10)}`;
}
