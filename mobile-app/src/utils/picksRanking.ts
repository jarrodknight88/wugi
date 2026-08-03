// ─────────────────────────────────────────────────────────────────────
// Wugi — picksRanking
// UAT-W3-3: Picks (For You) v1 ranking scaffold. Pure, synchronous
// reorder of an already-built card set by local behavior signals (see
// state/picksSignalStore.ts) — no filtering, no async work, so it drops
// into ForYouScreen's existing pool-building step as a final step.
//
// score(card) = categoryScore[card.venueCategory] + max(vibeScore[v] for v in cardVibes(card))
//
// Cold start (no signals recorded yet): input order is returned as-is.
//
// IMPORTANT: call this AFTER the day-cap slice + content-type interleave
// (roundRobin in ForYouScreen), not before. Ranking must only reorder the
// set of cards that already survived the cap/mix logic — never change
// which cards or content types are in that set.
// ─────────────────────────────────────────────────────────────────────
import type { ForYouCard, EventData, VenueData } from '../types';

export type PicksSignals = {
  vibeScore:     Record<string, number>;
  categoryScore: Record<string, number>;
  totalSignals:  number;
};

// Vibes only exist on event/venue cards today (see ForYouCard) — other
// content types (deal/gallery/food) score on venue category alone.
export function cardVibes(card: ForYouCard): string[] {
  if (card.type !== 'event' && card.type !== 'venue') return [];
  return (card.data as EventData | VenueData | null)?.vibes || [];
}

function scoreParts(card: ForYouCard, signals: PicksSignals): { vibe: number; vibeLabel: string | null; category: number } {
  let vibe = 0;
  let vibeLabel: string | null = null;
  for (const v of cardVibes(card)) {
    const s = signals.vibeScore[v.toLowerCase()] || 0;
    if (s > vibe) { vibe = s; vibeLabel = v; }
  }
  const category = card.venueCategory ? (signals.categoryScore[card.venueCategory.toLowerCase()] || 0) : 0;
  return { vibe, vibeLabel, category };
}

// Growth-visibility hint — attached only when a signal actually
// contributed a positive score to this card, never on a zero-score card
// and never during cold start (rankPicksPool short-circuits before this).
function hintFor(card: ForYouCard, parts: { vibe: number; vibeLabel: string | null; category: number }): string | undefined {
  if (parts.vibe <= 0 && parts.category <= 0) return undefined;
  return parts.vibe >= parts.category
    ? `✦ For your ${parts.vibeLabel} vibe`
    : `✦ Because you like ${card.venueCategory} spots`;
}

// Stable sort (Array#sort is spec-stable since ES2019) — ties keep the
// incoming (round-robin) relative order instead of being scrambled.
export function rankPicksPool(pool: ForYouCard[], signals: PicksSignals): ForYouCard[] {
  if (signals.totalSignals === 0) return pool;

  const withScores = pool.map(card => {
    const parts = scoreParts(card, signals);
    return { card, score: parts.vibe + parts.category, parts };
  });

  withScores.sort((a, b) => b.score - a.score);

  return withScores.map(({ card, score, parts }) => {
    if (score <= 0) return card;
    const personalizationHint = hintFor(card, parts);
    return personalizationHint ? { ...card, personalizationHint } : card;
  });
}
