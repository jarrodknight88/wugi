// ─────────────────────────────────────────────────────────────────────
// Wugi — Event transform core (TypeScript port)
//
// Single source of truth for the pure transform logic originally written
// for scripts/transform-events.js (PR #123 — SerpAPI google_events ->
// scripts/data/events-review.json): text normalization, capturedAt-
// anchored year inference, date/night-of parsing, and venue matching.
//
// scripts/transform-events.js now requires the compiled output of this
// file (lib/intel/eventTransformCore.js) instead of defining these
// functions locally — see that script for the require() + the same
// build-output pattern already used by scripts/test-apify-normalize.js.
//
// This file also adds two venue-matching entry points the SerpAPI
// pipeline never needed, for the venueIntel (Instagram) source consumed
// by onVenueIntelApproved / eventTransformRouting.ts:
//   - matchVenueByHandle — venue accounts ARE the venue (sourceAccount is
//     literally the venue's Instagram handle), matched via venues.instagram.
//   - matchVenueInCaption — promoter/DJ/photographer accounts post ABOUT a
//     venue, so the venue name has to be found inside free caption text
//     rather than matched against one structured field.
// Both reuse normalizeText/significantWords and the same
// exact-then-word-subset matching discipline as matchVenue (never guess
// across multiple candidates — always 'ambiguous', never auto-picked).
//
// Everything here is a pure function: no Firestore reads, no I/O. Callers
// (the CLI script, the Cloud Function trigger, the backfill script) own
// all I/O.
// ─────────────────────────────────────────────────────────────────────
'use strict';

export const TIMEZONE = 'America/New_York';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ── Small utils ──────────────────────────────────────────────────────
export function normalizeText(s: unknown): string {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'at']);
export function significantWords(normalized: string): string[] {
  return normalized.split(' ').filter((w) => w && !STOPWORDS.has(w));
}

// ── Year inference ───────────────────────────────────────────────────
// SerpAPI date.start_date is yearless ("Aug 1", "Jul 30"). Instagram
// captions are similarly yearless in practice. Anchor on capturedAt (or
// the post's postedAt); if the same-year candidate lands more than ~30
// days BEFORE the anchor, it must mean next year (Dec capture, "Jan 4").
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const START_DATE_RE = /^([A-Za-z]{3,9})\s+(\d{1,2})\b/;
// Same month/day shape, scanned anywhere in free text (not anchored to
// the start of the string) and tolerant of ordinal suffixes ("Aug 1st").
const DATE_IN_TEXT_RE = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g;

function resolveYearISO(month: number, day: number, anchor: string | Date | number): string | null {
  const anchorDate = anchor instanceof Date ? anchor : new Date(anchor);
  if (Number.isNaN(anchorDate.getTime())) return null;
  const anchorYear = anchorDate.getUTCFullYear();

  let candidate = new Date(Date.UTC(anchorYear, month, day));
  if (candidate.getUTCMonth() !== month) return null; // invalid day-for-month (e.g. Feb 30)

  if (anchorDate.getTime() - candidate.getTime() > THIRTY_DAYS_MS) {
    candidate = new Date(Date.UTC(anchorYear + 1, month, day));
    if (candidate.getUTCMonth() !== month) return null;
  }
  return candidate.toISOString().slice(0, 10);
}

/** Ported verbatim from transform-events.js: parses a structured "Mon D" date string. */
export function parseDateISO(startDateStr: unknown, capturedAt: string | Date | number): string | null {
  if (!startDateStr || typeof startDateStr !== 'string') return null;
  const m = startDateStr.trim().match(START_DATE_RE);
  if (!m) return null;
  const monKey = m[1].slice(0, 3).toLowerCase();
  const day = parseInt(m[2], 10);
  if (!(monKey in MONTHS) || !Number.isInteger(day) || day < 1 || day > 31) return null;
  return resolveYearISO(MONTHS[monKey], day, capturedAt);
}

/**
 * Scans free text (an Instagram caption) for the first valid "Mon D"
 * mention and resolves it the same way parseDateISO does. Used by the
 * venueIntel routing classifier, which has no structured date field to
 * anchor on the way the SerpAPI pipeline does.
 *
 * Explicit dates always win: only when none is found does this fall back
 * to relative-vocabulary parsing (tonight/tomorrow/weekday names) below.
 */
export function extractDateFromText(text: unknown, anchor: string | Date | number): string | null {
  if (!text || typeof text !== 'string') return null;
  DATE_IN_TEXT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DATE_IN_TEXT_RE.exec(text)) !== null) {
    const monKey = m[1].slice(0, 3).toLowerCase();
    const day = parseInt(m[2], 10);
    if (!(monKey in MONTHS) || !Number.isInteger(day) || day < 1 || day > 31) continue;
    const iso = resolveYearISO(MONTHS[monKey], day, anchor);
    if (iso) return iso;
  }
  return extractRelativeDateFromText(text, anchor);
}

// ── Relative date vocabulary ─────────────────────────────────────────
// Nightlife captions say "TONIGHT" or "this Friday", not "Aug 1" — these
// resolve relative to the post's own anchor (postedAt) in America/New_York.
// Deliberately NOT parsed: "this weekend" / "soon" / "next week" — too
// ambiguous to resolve to a single calendar date.
const RELATIVE_TODAY_RE = /\b(?:tonight|tonite|2nite|today)\b/i;
const RELATIVE_TOMORROW_RE = /\b(?:tomorrow|tmrw|tmr)\b/i;
const WEEKDAY_PATTERNS: Array<{ re: RegExp; dow: number }> = [
  { re: /\b(?:sunday|sun)\b/i, dow: 0 },
  { re: /\b(?:monday|mon)\b/i, dow: 1 },
  { re: /\b(?:tuesday|tue|tues)\b/i, dow: 2 },
  { re: /\b(?:wednesday|wed)\b/i, dow: 3 },
  { re: /\b(?:thursday|thu|thur|thurs)\b/i, dow: 4 },
  { re: /\b(?:friday|fri)\b/i, dow: 5 },
  { re: /\b(?:saturday|sat)\b/i, dow: 6 },
];

/** The calendar date (YYYY-MM-DD) a Date instant falls on in the given IANA timezone. */
export function dateISOInTimeZone(date: Date, tz: string = TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    date
  );
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Earliest (leftmost) weekday-name/abbreviation mention in text, or null. */
function findEarliestWeekdayMatch(text: string): number | null {
  let bestIndex = Infinity;
  let bestDow: number | null = null;
  for (const { re, dow } of WEEKDAY_PATTERNS) {
    const m = text.match(re);
    if (m && m.index !== undefined && m.index < bestIndex) {
      bestIndex = m.index;
      bestDow = dow;
    }
  }
  return bestDow;
}

/**
 * Resolves "tonight"/"tomorrow"/weekday-name vocabulary in free text,
 * anchored to the post's own timestamp and resolved in America/New_York.
 * A bare or prefixed weekday name ("friday", "this friday", "friday
 * night", "fri") resolves to its NEXT occurrence relative to the anchor
 * date — the anchor's own weekday counts as that same day.
 */
export function extractRelativeDateFromText(text: unknown, anchor: string | Date | number): string | null {
  if (!text || typeof text !== 'string') return null;
  const anchorDate = anchor instanceof Date ? anchor : new Date(anchor);
  if (Number.isNaN(anchorDate.getTime())) return null;
  const anchorISO = dateISOInTimeZone(anchorDate, TIMEZONE);

  if (RELATIVE_TODAY_RE.test(text)) return anchorISO;
  if (RELATIVE_TOMORROW_RE.test(text)) return addDaysISO(anchorISO, 1);

  const targetDow = findEarliestWeekdayMatch(text);
  if (targetDow === null) return null;
  const anchorDow = dayOfWeekET(anchorISO);
  const diff = (targetDow - anchorDow + 7) % 7;
  return addDaysISO(anchorISO, diff);
}

// date.when e.g. "Sat, 11 AM – 9 PM" — best-effort start/end time extraction.
// Missing/unparseable times are fine; only a missing DATE causes rejection.
const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])/g;
export function parseTimes(whenStr: unknown): { startTime?: string; endTime?: string } {
  if (!whenStr || typeof whenStr !== 'string') return {};
  const matches = [...whenStr.matchAll(TIME_RE)];
  if (!matches.length) return {};
  const to24h = (match: RegExpMatchArray) => {
    let h = parseInt(match[1], 10);
    const min = match[2] ? parseInt(match[2], 10) : 0;
    const meridiem = match[3].toLowerCase();
    if (meridiem === 'am') { if (h === 12) h = 0; } else if (h !== 12) { h += 12; }
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  };
  const startTime = to24h(matches[0]);
  const endTime = matches.length > 1 ? to24h(matches[1]) : undefined;
  return { startTime, endTime };
}

// nightOf: the night an event belongs to, 6AM cutoff. An event whose start
// time is after midnight but before 6AM is still "last night" to a user —
// without this, a midnight-crossing Friday event vanishes from Friday's feed.
export function computeNightOf(dateISO: string, startTime?: string | null): string {
  if (!startTime) return dateISO;
  const hour = parseInt(startTime.slice(0, 2), 10);
  if (!Number.isInteger(hour) || hour >= 6) return dateISO;
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Day of week (0=Sun..6=Sat) for a "Mon D" calendar date, DST/timezone-safe via midday UTC. */
export function dayOfWeekET(dateISO: string): number {
  return new Date(`${dateISO}T12:00:00Z`).getUTCDay();
}

// ── Relevance gate ──────────────────────────────────────────────────
const PLACE_NAME_RE = /^[A-Za-z][A-Za-z\s.'-]*,\s*[A-Z]{2}$/; // "Atlanta, GA", "Decatur, GA"
const KNOWN_PLACE_NAMES = new Set([
  'atlanta', 'decatur', 'buckhead', 'midtown', 'downtown', 'sandy springs',
  'marietta', 'roswell', 'alpharetta', 'smyrna', 'brookhaven', 'avondale estates',
]);

export function looksLikePlaceName(title: unknown): boolean {
  const trimmed = String(title || '').trim();
  if (PLACE_NAME_RE.test(trimmed)) return true;
  return KNOWN_PLACE_NAMES.has(trimmed.toLowerCase());
}

// Case-insensitive, word-bounded so "class" doesn't hit "classic", "run"
// doesn't hit "running", etc.
const NON_NIGHTLIFE_PATTERNS = [
  /restaurant\s*week/i,
  /\bbrunch\b/i,
  /farmers?\s*market/i,
  /\byoga\b/i,
  /\bworkshop\b/i,
  /\bclass(es)?\b/i,
  /\bkids?\b/i,
  /\bfamily\b/i,
  /\b5k\b/i,
  /\b10k\b/i,
  /\bfun run\b/i,
  /\bcareer\s*fair\b/i,
  /\bjob\s*fair\b/i,
  /\bconference\b/i,
  /\bnetworking\b/i,
  /corporate\s*dinner/i,
  /regional\s*dinner/i,
  /\bdog(gie)?\b/i,
  /\bpuppy\b/i,
  /\bpaws\b/i,
  /\bpet(s)?\b/i,
];

export function nonNightlifeReason(title: unknown): boolean {
  const text = String(title || '');
  return NON_NIGHTLIFE_PATTERNS.some((re) => re.test(text));
}

// ── Venue matching ───────────────────────────────────────────────────
export interface Venue {
  id: string;
  name: string;
  aliases?: string[];
  instagram?: string | null;
}

export interface VenueIndex {
  byName: Map<string, Venue[]>;
  byInstagramHandle: Map<string, Venue[]>;
  all: Venue[];
}

export type VenueMatchResult =
  | { status: 'matched'; venue: Venue; via: 'exact' | 'contains' | 'handle' | 'manual' | 'mention' }
  | { status: 'ambiguous'; candidates: Venue[] }
  | { status: 'unmatched' };

export function normalizeInstagramHandle(handle: unknown): string {
  if (typeof handle !== 'string') return '';
  return handle.trim().replace(/^@/, '').replace(/\/+$/, '').toLowerCase();
}

export function buildVenueIndex(venues: Venue[]): VenueIndex {
  const byName = new Map<string, Venue[]>();
  const byInstagramHandle = new Map<string, Venue[]>();
  for (const v of venues) {
    const names = [v.name, ...(v.aliases || [])].filter(Boolean);
    for (const n of names) {
      const key = normalizeText(n);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(v);
    }
    const handleKey = normalizeInstagramHandle(v.instagram);
    if (handleKey) {
      if (!byInstagramHandle.has(handleKey)) byInstagramHandle.set(handleKey, []);
      byInstagramHandle.get(handleKey)!.push(v);
    }
  }
  return { byName, byInstagramHandle, all: venues };
}

function dedupeById(venues: Venue[]): Venue[] {
  return Array.from(new Map(venues.map((v) => [v.id, v])).values());
}

/** Ported verbatim from transform-events.js: matches a structured event-venue-name field. */
export function matchVenue(eventVenueName: unknown, index: VenueIndex): VenueMatchResult {
  const key = normalizeText(eventVenueName);
  if (!key) return { status: 'unmatched' };

  const exact = index.byName.get(key);
  if (exact) {
    const uniq = dedupeById(exact);
    if (uniq.length === 1) return { status: 'matched', venue: uniq[0], via: 'exact' };
    return { status: 'ambiguous', candidates: uniq };
  }

  // Alias/contains fallback: word-subset match, ignoring stopwords, only
  // auto-accepted when exactly one candidate survives — ambiguous otherwise.
  const eventWords = significantWords(key);
  if (eventWords.length < 2) return { status: 'unmatched' }; // too generic to fuzzy-match safely

  const candidates = index.all.filter((v) => {
    const names = [v.name, ...(v.aliases || [])].filter(Boolean);
    return names.some((n) => {
      const venueWords = significantWords(normalizeText(n));
      if (venueWords.length < 2) return false;
      const isSubset = (a: string[], b: string[]) => a.every((w) => b.includes(w));
      return isSubset(eventWords, venueWords) || isSubset(venueWords, eventWords);
    });
  });
  const uniqCandidates = dedupeById(candidates);
  if (uniqCandidates.length === 1) return { status: 'matched', venue: uniqCandidates[0], via: 'contains' };
  if (uniqCandidates.length > 1) return { status: 'ambiguous', candidates: uniqCandidates };
  return { status: 'unmatched' };
}

/**
 * venueIntel-only: for accountType 'venue', sourceAccount IS the venue's
 * own Instagram handle — matched directly against venues.instagram rather
 * than by name/text.
 */
export function matchVenueByHandle(handle: unknown, index: VenueIndex): VenueMatchResult {
  const key = normalizeInstagramHandle(handle);
  if (!key) return { status: 'unmatched' };
  const matches = index.byInstagramHandle.get(key);
  if (!matches || matches.length === 0) return { status: 'unmatched' };
  const uniq = dedupeById(matches);
  if (uniq.length === 1) return { status: 'matched', venue: uniq[0], via: 'handle' };
  return { status: 'ambiguous', candidates: uniq };
}

/**
 * venueIntel-only: for promoter/DJ/photographer accounts, the venue has to
 * be found by name inside the free-text caption rather than in a
 * structured field. Only counts a venue as "mentioned" when every
 * significant word of its name/alias appears in the caption (>=2 words,
 * same generic-match guard as matchVenue) — never a single-word match,
 * which would false-positive constantly against free text.
 */
export function matchVenueInCaption(caption: unknown, index: VenueIndex): VenueMatchResult {
  const normalized = normalizeText(caption);
  if (!normalized) return { status: 'unmatched' };
  const captionWords = significantWords(normalized);

  const found = index.all.filter((v) => {
    const names = [v.name, ...(v.aliases || [])].filter(Boolean);
    return names.some((n) => {
      const venueWords = significantWords(normalizeText(n));
      if (venueWords.length < 2) return false;
      return venueWords.every((w) => captionWords.includes(w));
    });
  });

  const uniq = dedupeById(found);
  if (uniq.length === 1) return { status: 'matched', venue: uniq[0], via: 'contains' };
  if (uniq.length > 1) return { status: 'ambiguous', candidates: uniq };
  return { status: 'unmatched' };
}

// ── Mention matching (issue #236) ────────────────────────────────────
// venue-intel: a promoter/DJ/photographer caption that @-mentions or
// IG-tags the venue is a strong signal matchVenueInCaption never sees
// (it only scans for the venue's NAME in free text). These fill that
// gap using the same byInstagramHandle index matchVenueByHandle already
// relies on — a mention IS a handle, just sourced from the caption/tags
// instead of the post's own account.

// IG handles: [A-Za-z0-9._]{1,30}, never end with '.' (that's sentence
// punctuation, not part of the handle) and are never embedded inside a
// word — a leading '@' preceded by a word char or '.' means this is an
// email address (e.g. "booking@thevenue.com"), not an IG mention.
const MENTION_RE = /(?<![\w.])@([A-Za-z0-9._]{1,30})/g;

/** Pure @handle extractor for free caption text. Never guesses at emails/URLs — see MENTION_RE. */
export function extractMentionsFromCaption(caption: unknown): string[] {
  if (!caption || typeof caption !== 'string') return [];
  const out: string[] = [];
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(caption)) !== null) {
    const handle = m[1].replace(/\.+$/, ''); // strip a sentence-ending '.' IG itself would never allow trailing
    if (handle) out.push(handle);
  }
  return out;
}

/**
 * Unions caption @-mentions with the Apify item's structured tag/mention
 * fields (see apifyWebhook.ts mapApifyItemToVenueIntelDoc), dedupes by
 * normalized handle, and drops the post's own sourceAccount — an account
 * mentioning itself is not a venue signal.
 */
export function resolveMentionCandidates(
  caption: unknown,
  structuredMentions: unknown,
  sourceAccount: unknown
): string[] {
  const fromCaption = extractMentionsFromCaption(caption);
  const fromStructured = Array.isArray(structuredMentions)
    ? structuredMentions.filter((m): m is string => typeof m === 'string')
    : [];

  const selfKey = normalizeInstagramHandle(sourceAccount);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...fromCaption, ...fromStructured]) {
    const key = normalizeInstagramHandle(raw);
    if (!key || key === selfKey || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

/**
 * venueIntel-only: matches a list of raw @mention/tag strings (caption
 * @-mentions unioned with structured taggedUsers/mentions data) against
 * venues.instagram, same machinery as matchVenueByHandle. A single unique
 * venue across all mentions is matched; more than one distinct venue is
 * ambiguous (never auto-picked) — same never-guess discipline as matchVenue.
 */
export function matchVenueByMentions(mentions: string[], index: VenueIndex): VenueMatchResult {
  const found = new Map<string, Venue>();
  for (const raw of mentions) {
    const key = normalizeInstagramHandle(raw);
    if (!key) continue;
    const matches = index.byInstagramHandle.get(key);
    if (!matches) continue;
    for (const v of dedupeById(matches)) found.set(v.id, v);
  }
  const uniq = Array.from(found.values());
  if (uniq.length === 1) return { status: 'matched', venue: uniq[0], via: 'mention' };
  if (uniq.length > 1) return { status: 'ambiguous', candidates: uniq };
  return { status: 'unmatched' };
}

/** First non-empty caption line, truncated — captions have no structured title field. */
export function deriveEventTitle(caption: unknown): string {
  const text = typeof caption === 'string' ? caption : '';
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) || '';
  if (!firstLine) return 'Untitled event';
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}
