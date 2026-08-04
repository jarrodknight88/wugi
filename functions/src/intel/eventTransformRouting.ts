// ─────────────────────────────────────────────────────────────────────
// Wugi — venueIntel routing classifier (pure)
//
// Decides what an APPROVED venueIntel post becomes, per issue #133 SCOPE
// item 3 and issue #137's recap-inference upgrade:
//   a. future date (explicit or relative) + venue matched -> draft_event
//   b. past date, venue matched                           -> night_observation
//   c. no date at all (explicit or relative), venue matched
//                                                          -> night_observation
//        (recap inference — dateless + venue-matched is overwhelmingly
//        recap content; see classifyIntelPost)
//   d. no venue match, or venue-ambiguous                  -> needs_classification
//
// Pure/testable: no Firestore reads. The caller (onVenueIntelApproved,
// scripts/backfill-approved-intel.js) resolves accountType and the full
// venues list, builds a VenueIndex with eventTransformCore.buildVenueIndex,
// computes "today" in America/New_York, and passes all three in.
// ─────────────────────────────────────────────────────────────────────
'use strict';

import {
  TIMEZONE,
  Venue,
  VenueIndex,
  VenueMatchResult,
  extractDateFromText,
  computeNightOf,
  dateISOInTimeZone,
  dayOfWeekET,
  deriveEventTitle,
  matchVenueByHandle,
  matchVenueInCaption,
  matchVenueByMentions,
  resolveMentionCandidates,
} from './eventTransformCore';

export type AccountType = 'venue' | 'promoter' | 'photographer' | 'dj_artist' | 'staff' | 'influencer';

export interface IntelRoutingInput {
  sourceAccount: string;
  caption: string;
  /** The post's own timestamp — the year-inference anchor (there is no separate "capturedAt" for scraped IG posts). */
  postedAt: string | Date | number | null;
  accountType?: AccountType | null;
  /**
   * A venue picked by a human on the Needs Attention tab (see
   * dashboard/app/dashboard/venue-intel/page.tsx's VenuePicker) and staged
   * onto the venueIntel doc's `venueId` field before Retry. When present it
   * wins outright — skips handle/caption matching entirely — since a human
   * override always beats the heuristic classifier. A stale/unknown id
   * (venue deleted after assignment) falls back to normal resolution rather
   * than failing closed.
   */
  manualVenueId?: string | null;
  /**
   * The Apify item's structured tag/mention fields (taggedUsers/mentions —
   * see apifyWebhook.ts mapApifyItemToVenueIntelDoc's mentionedHandles),
   * unioned with caption @-mentions inside resolveVenue's mention-match
   * fallback (issue #236). Raw, un-normalized handle strings.
   */
  structuredMentions?: string[] | null;
}

export type RoutingResult =
  | { outcome: 'draft_event'; title: string; dateISO: string; nightOf: string; venue: Venue }
  | { outcome: 'night_observation'; venue: Venue; dateISO: string; dayOfWeek: number }
  | { outcome: 'needs_classification'; reason: string };

/**
 * accountType 'venue' (or unknown — the majority of seed accounts are
 * venues): sourceAccount IS the venue, matched by Instagram handle first.
 * Only falls back to scanning the caption text when the handle doesn't
 * resolve — a venue account's own caption still names other venues
 * sometimes (co-hosted nights), but the account identity is the stronger
 * signal and must win when it's unambiguous.
 *
 * Mention-match (issue #236) is the last fallback, tried only when
 * caption-name matching comes back unmatched — same "only fall through on
 * unmatched, never override ambiguous/matched" discipline as the
 * handle->caption fallback above, so existing handle/caption resolutions
 * are byte-for-byte unchanged. It catches promoter/DJ posts that
 * @-mention or IG-tag the venue instead of (or in addition to) naming it.
 */
function resolveVenue(input: IntelRoutingInput, index: VenueIndex): VenueMatchResult {
  if (input.manualVenueId) {
    const venue = index.all.find((v) => v.id === input.manualVenueId);
    if (venue) return { status: 'matched', venue, via: 'manual' };
  }
  if (!input.accountType || input.accountType === 'venue') {
    const byHandle = matchVenueByHandle(input.sourceAccount, index);
    if (byHandle.status !== 'unmatched') return byHandle;
  }
  const byCaption = matchVenueInCaption(input.caption, index);
  if (byCaption.status !== 'unmatched') return byCaption;

  const mentions = resolveMentionCandidates(input.caption, input.structuredMentions, input.sourceAccount);
  return matchVenueByMentions(mentions, index);
}

export function classifyIntelPost(
  input: IntelRoutingInput,
  index: VenueIndex,
  todayISO: string
): RoutingResult {
  const anchor = input.postedAt ?? Date.now();
  const dateISO = extractDateFromText(input.caption, anchor);
  const venueMatch = resolveVenue(input, index);

  if (!dateISO) {
    // Recap inference: a venue-matched post with no parseable date
    // (explicit or relative) is overwhelmingly recap/night-of content, not
    // an unclassifiable one — route it as an observation of the post's own
    // night rather than draining into needs_classification. Observation
    // noise is filtered downstream by the >=3-same-weekday inference
    // threshold.
    if (venueMatch.status === 'matched') {
      const anchorDate = anchor instanceof Date ? anchor : new Date(anchor);
      const anchorISO = dateISOInTimeZone(anchorDate, TIMEZONE);
      return {
        outcome: 'night_observation',
        venue: venueMatch.venue,
        dateISO: anchorISO,
        dayOfWeek: dayOfWeekET(anchorISO),
      };
    }
    return {
      outcome: 'needs_classification',
      reason: 'no-parseable-date-and-no-venue-match',
    };
  }
  if (venueMatch.status === 'ambiguous') {
    return { outcome: 'needs_classification', reason: 'venue-ambiguous' };
  }
  if (venueMatch.status === 'unmatched') {
    return { outcome: 'needs_classification', reason: 'no-venue-match' };
  }

  const venue = venueMatch.venue;
  if (dateISO >= todayISO) {
    return {
      outcome: 'draft_event',
      title: deriveEventTitle(input.caption),
      dateISO,
      nightOf: computeNightOf(dateISO),
      venue,
    };
  }
  return { outcome: 'night_observation', venue, dateISO, dayOfWeek: dayOfWeekET(dateISO) };
}
