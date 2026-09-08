// ─────────────────────────────────────────────────────────────────────
// Wugi — editorial calendar placement engine (Phase 1, read-only)
//
// Computes WHERE an eligible event or deal would land — homepage featured,
// in-app featured, standard listing, or deal — without ever writing that
// tier back to Firestore. Nothing here pins or suppresses anything; it's a
// pure function of the current data, recomputed on every render, so it
// exists purely to observe how the ranking heuristic behaves before Phase 2
// (pin/suppress overrides) builds on top of it.
//
// Framework-agnostic on purpose (no Firestore/React imports) — see
// scripts/test-placement.js for a plain-Node test against these exports.
// ─────────────────────────────────────────────────────────────────────

export type VenueTier = "unclaimed" | "claimed_basic" | "standard" | "premium"

export type PlacementEvent = {
  id: string
  title: string
  venueId: string
  venueName: string
  /** YYYY-MM-DD local calendar day. Use parseDashboardDate() on the raw `date` field. */
  dateISO: string
  status: string
  isActive?: boolean
  hasTickets?: boolean
  isFeatured?: boolean
  eventFeatured?: boolean
}

export type PlacementVenue = {
  id: string
  tier?: VenueTier
}

export type PlacementTier = "homepage-featured" | "in-app-featured" | "standard-listing" | "deal"

export type PlacedEvent = PlacementEvent & {
  tier: PlacementTier
  score: number
  isTonight: boolean
}

export type DealInput = {
  id: string
  title: string
  venueId: string
  venueName: string
  dealType?: string
  status?: string
  isActive?: boolean
  daysOfWeek?: number[]
  /** One-off ("flash") deal display date, e.g. "SAT JUN 21" — parsed with parseDashboardDate(). */
  date?: string
  /** Pre-normalized to YYYY-MM-DD by the caller (Firestore Timestamp -> ISO). */
  validFrom?: string | null
  validUntil?: string | null
}

export type PlacedDeal = {
  id: string
  title: string
  venueId: string
  venueName: string
  dealType?: string
  dateISO: string
  tier: "deal"
}

export type CalendarItem = PlacedEvent | PlacedDeal

export type Segment = { id: string; label: string; isDefault?: boolean }

// Ships with exactly one segment today. Adding a cohort later is adding an
// entry here plus a matching SEGMENT_FILTERS function — never a rebuild of
// the calendar page, since callers only ever ask "give me segmentId X".
export const SEGMENTS: Segment[] = [
  { id: "default", label: "All Users (Default)", isDefault: true },
]

type SegmentFilter = (event: PlacementEvent) => boolean

// The default segment is eligibility-only (no cohort narrowing yet). A real
// cohort filter — e.g. "21+ only" or "vibes includes Rooftop" — plugs in
// here without touching computePlacements() or the page component.
const SEGMENT_FILTERS: Record<string, SegmentFilter> = {
  default: () => true,
}

export function filterForSegment(events: PlacementEvent[], segmentId: string): PlacementEvent[] {
  const fn = SEGMENT_FILTERS[segmentId] ?? SEGMENT_FILTERS.default
  return events.filter(fn)
}

export const PLACEMENT_CONFIG = {
  /** Rolling homepage window: tonight + this many following days. */
  horizonDays: 7,
  /** Total homepage-featured slots across the whole rolling window (not per day). */
  homepageFeaturedCap: 6,
  /** Total in-app-featured slots across the whole rolling window. */
  inAppFeaturedCap: 24,
  /** A day with fewer than this many total eligible items is flagged under-filled. */
  underfilledThreshold: 2,
}

const VENUE_TIER_WEIGHT: Record<VenueTier, number> = {
  premium: 30,
  standard: 20,
  claimed_basic: 10,
  unclaimed: 0,
}

// The dashboard doesn't write a `tier` field on venue docs today (only v2
// mobile schema defines VenueTier) — default missing tiers to "standard"
// rather than penalizing every pre-existing venue down to zero.
function venueTierWeight(venue: PlacementVenue | undefined): number {
  const tier = venue?.tier ?? "standard"
  return VENUE_TIER_WEIGHT[tier] ?? VENUE_TIER_WEIGHT.standard
}

// Ticket sales velocity isn't tracked anywhere in Firestore yet — no
// sold/capacity rollup exists on the event doc, and reading every event's
// ticketTypes subcollection on each calendar render would be expensive.
// `hasTickets` is the only signal available today, so momentum is a coarse
// on/off stand-in. It's weighted below venue tier on purpose: this heuristic
// should not overclaim precision it doesn't have. Replace with a real
// sold/capacity ratio once that pipeline exists.
function momentumScore(event: PlacementEvent): number {
  return event.hasTickets ? 5 : 0
}

function score(event: PlacementEvent, venue: PlacementVenue | undefined): number {
  return venueTierWeight(venue) + momentumScore(event)
}

function isEligible(event: PlacementEvent): boolean {
  // Missing `isActive` counts as active (dashboard-authored docs don't set
  // it) — see AGENTS.md's Firestore foot-gun note on treating missing
  // fields as their default, not as false.
  return event.status === "approved" && event.isActive !== false
}

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// Dashboard events/deals store their date as a "MMM DD YYYY" display string
// (see components/DatePicker.tsx), not an ISO field. `new Date(...)` parses
// that format fine, and since "today" is computed the same way (new Date()
// in the same execution context), relative-day math stays consistent even
// though the stored value isn't ISO.
export function parseDashboardDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return toISODate(d)
}

export function addDays(iso: string, days: number): string {
  const [y, m, day] = iso.split("-").map(Number)
  const dt = new Date(y, m - 1, day)
  dt.setDate(dt.getDate() + days)
  return toISODate(dt)
}

/**
 * Compute the placement tier for every eligible event, for the given
 * segment. Events outside the rolling homepage horizon are always
 * "standard-listing" — the rolling window only makes sense anchored to
 * `today`, so a day three weeks out can't meaningfully be "homepage
 * featured" yet.
 */
export function computePlacements(
  events: PlacementEvent[],
  venues: PlacementVenue[],
  opts: { today?: string; segmentId?: string } = {}
): PlacedEvent[] {
  const today = opts.today ?? toISODate(new Date())
  const horizonEnd = addDays(today, PLACEMENT_CONFIG.horizonDays - 1)
  const venueById = new Map(venues.map(v => [v.id, v]))

  const eligible = filterForSegment(events, opts.segmentId ?? "default").filter(isEligible)
  const scored = eligible.map(event => ({ event, s: score(event, venueById.get(event.venueId)) }))

  const inHorizon = scored.filter(x => x.event.dateISO >= today && x.event.dateISO <= horizonEnd)

  // Tonight's events fill homepage-featured slots first; only once tonight
  // is exhausted do the remaining days in the horizon backfill by score.
  const tonight = inHorizon.filter(x => x.event.dateISO === today).sort((a, b) => b.s - a.s)
  const restOfHorizon = inHorizon
    .filter(x => x.event.dateISO !== today)
    .sort((a, b) => b.s - a.s)

  const homepageFeaturedIds = new Set<string>()
  for (const x of [...tonight, ...restOfHorizon]) {
    if (homepageFeaturedIds.size >= PLACEMENT_CONFIG.homepageFeaturedCap) break
    homepageFeaturedIds.add(x.event.id)
  }

  const inAppCandidates = inHorizon
    .filter(x => !homepageFeaturedIds.has(x.event.id))
    .sort((a, b) => b.s - a.s)

  const inAppFeaturedIds = new Set<string>()
  for (const x of inAppCandidates) {
    if (inAppFeaturedIds.size >= PLACEMENT_CONFIG.inAppFeaturedCap) break
    inAppFeaturedIds.add(x.event.id)
  }

  function tierFor(id: string): PlacementTier {
    if (homepageFeaturedIds.has(id)) return "homepage-featured"
    if (inAppFeaturedIds.has(id)) return "in-app-featured"
    return "standard-listing"
  }

  return scored.map(x => ({
    ...x.event,
    score: x.s,
    isTonight: x.event.dateISO === today,
    tier: tierFor(x.event.id),
  }))
}

function isDealEligible(deal: DealInput): boolean {
  if (deal.status && deal.status !== "active") return false
  if (deal.isActive === false) return false
  return true
}

/**
 * Expand deals into one calendar occurrence per matching day inside
 * [rangeStartISO, rangeEndISO]. Deals are venue+schedule scoped (not
 * event-scoped), so this walks recurring `daysOfWeek` across the range and
 * resolves one-off `date` deals directly — mirrors the recurrence rules in
 * mobile-app/src/utils/deals.ts (isDealEligible/isDealActiveNow) so the
 * calendar agrees with what the app actually shows.
 */
export function computeDealOccurrences(
  deals: DealInput[],
  rangeStartISO: string,
  rangeEndISO: string
): PlacedDeal[] {
  const out: PlacedDeal[] = []
  for (const deal of deals.filter(isDealEligible)) {
    if (deal.daysOfWeek && deal.daysOfWeek.length > 0) {
      for (let iso = rangeStartISO; iso <= rangeEndISO; iso = addDays(iso, 1)) {
        if (deal.validFrom && iso < deal.validFrom) continue
        if (deal.validUntil && iso > deal.validUntil) continue
        const weekday = new Date(`${iso}T00:00:00`).getDay()
        if (deal.daysOfWeek.includes(weekday)) {
          out.push({
            id: `${deal.id}:${iso}`, title: deal.title, venueId: deal.venueId,
            venueName: deal.venueName, dealType: deal.dealType, dateISO: iso, tier: "deal",
          })
        }
      }
    } else if (deal.date) {
      const iso = parseDashboardDate(deal.date)
      if (iso && iso >= rangeStartISO && iso <= rangeEndISO) {
        out.push({
          id: `${deal.id}:${iso}`, title: deal.title, venueId: deal.venueId,
          venueName: deal.venueName, dealType: deal.dealType, dateISO: iso, tier: "deal",
        })
      }
    }
    // No daysOfWeek and no date = an always-on deal with no fixed calendar
    // day to anchor to — intentionally not placed on the calendar.
  }
  return out
}

export function bucketByDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>()
  for (const item of items) {
    const list = map.get(item.dateISO)
    if (list) list.push(item)
    else map.set(item.dateISO, [item])
  }
  return map
}

export function isDayUnderfilled(dayItems: CalendarItem[]): boolean {
  return dayItems.length < PLACEMENT_CONFIG.underfilledThreshold
}
