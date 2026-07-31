// Heuristic title/about cleanup for the draft-events publish prefill (v1 —
// the AI Generate button is the higher-quality alternative, gated on
// ANTHROPIC_API_KEY). Same spirit as functions/src/intel/eventTransformCore.ts's
// deriveEventTitle (first non-empty caption line, truncated) plus emoji-run
// and announcement-boilerplate stripping. Kept local to dashboard/ rather than
// imported — functions/ is a separate package and out of scope for this change
// (companion functions task owns ingestion).
// Character class includes ZWJ (U+200D) and the emoji variation selector
// (U+FE0F) so multi-codepoint emoji (joined sequences, text-vs-emoji
// presentation) are stripped as a single run, not left as stray glyphs.
const EMOJI_RUN_RE = /[\p{Extended_Pictographic}‍️]+/gu
const BOILERPLATE_RE =
  /\b(link in bio|swipe up|tag (a |your )?(friend|someone)|drop (a|your) .*? below|comment below|dm (us|for)|tap the link)\b.*/gi

function stripEmojiAndBoilerplate(text: string): string {
  return text
    .replace(EMOJI_RUN_RE, " ")
    .replace(BOILERPLATE_RE, "")
    .replace(/[ \t]+/g, " ")
    .trim()
}

export function cleanDraftTitle(caption: string, fallback: string): string {
  const firstLine = caption.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) || ""
  let cleaned = stripEmojiAndBoilerplate(firstLine).replace(/^[-•*.\s]+/, "").trim()
  if (!cleaned) cleaned = fallback
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned
}

export function cleanDraftAbout(caption: string): string {
  return stripEmojiAndBoilerplate(caption).replace(/\n{3,}/g, "\n\n").trim()
}

// "MMM DD, YYYY" — byte-for-byte the same format DatePicker itself produces
// (toLocaleDateString("en-US",{month:"short",day:"2-digit",year:"numeric"})
// .toUpperCase()), computed from a UTC-anchored ISO date so it matches the
// calendar date regardless of server timezone.
export function isoToDatePickerString(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`)
  return d
    .toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" })
    .toUpperCase()
}

export const DOW_TO_DAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
export const DAY_TO_DOW: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
}

// Day-of-week name (matches series/page.tsx's DAYS values) for a "MonD"
// dateISO — DST/timezone-safe via midday UTC, same trick as
// functions/src/intel/eventTransformCore.ts's dayOfWeekET.
export function dayNameForDateISO(dateISO: string): string {
  const dow = new Date(`${dateISO}T12:00:00Z`).getUTCDay()
  return DOW_TO_DAY[dow]
}

// Mirrors series/page.tsx's toSlug — kept in sync manually (component file,
// not importable from a route handler).
export function toEventSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
