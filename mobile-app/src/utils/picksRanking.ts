// ─────────────────────────────────────────────────────────────────────
// Wugi — picksRanking
// UAT-W3-3 Picks For You v1: behavior-signal ranking scaffold
//
// Simple additive scoring over the Picks (ForYou) card pool: v1 on purpose,
// full recommendation engine is post-launch. See picksSignalStore.ts for
// where the scores come from.
//
// Scoring function (documented per task notes):
//   score(card) = max(vibeScore[v] for v in card.vibes)
//               + categoryScore[card.category]     // venue cards only
//
// - vibeScore / categoryScore are additive counters: +1 per view, +3 per
//   save, accumulated per vibe tag / venue category over local history.
// - Event cards carry only a single primary vibe (card.tag) — EventData has
//   no vibes[] field — so they score on that one tag; venue cards score on
//   their full vibes[] list (their category also contributes).
// - Cold start: if the user has no recorded signals at all, rankPicksPool
//   returns the input order unchanged (all scores are 0 and there is
//   nothing meaningful to rank by yet).
// - Ties (including the all-zero cold-start case) keep original pool order
//   — the sort is stable by explicit index tiebreak, not engine behavior.
// ─────────────────────────────────────────────────────────────────────
import type { ForYouCard, EventData, VenueData } from '../types';

export type PicksSignals = {
  categoryScores: Record<string, number>;
  vibeScores: Record<string, number>;
  recent: { kind: 'view' | 'save'; category?: string; vibes: string[]; title: string }[];
};

export type PickSignalInput = { category?: string; vibes: string[]; title: string } | null;

// Fallback tags fsEventToCard/fsVenueToCard use when a card has no real
// vibe data — never treat these as an actual vibe signal.
const PLACEHOLDER_TAGS = new Set(['Event', 'Venue']);

// What a card "is" for signal purposes — used both to score a card against
// existing signals and to record a new signal when the user views/saves one.
// Only event/venue cards carry personalization-relevant data.
export function extractCardSignal(card: ForYouCard): PickSignalInput {
  if (card.type === 'venue' && card.data) {
    const v = card.data as VenueData;
    return { category: v.category || undefined, vibes: v.vibes || [], title: v.name };
  }
  if (card.type === 'event' && card.data) {
    const e = card.data as EventData;
    const tagVibe = !PLACEHOLDER_TAGS.has(card.tag) ? [card.tag] : [];
    return { category: undefined, vibes: tagVibe, title: e.title };
  }
  return null;
}

export type PickRankReason =
  | { kind: 'vibe'; vibe: string }
  | { kind: 'category'; category: string; recentTitle?: string };

function scoreCard(card: ForYouCard, signals: PicksSignals): { score: number; reason: PickRankReason | null } {
  const signal = extractCardSignal(card);
  if (!signal) return { score: 0, reason: null };

  let vibeScore = 0;
  let topVibe: string | null = null;
  for (const v of signal.vibes) {
    const s = signals.vibeScores[v] || 0;
    if (s > vibeScore) { vibeScore = s; topVibe = v; }
  }

  const categoryScore = signal.category ? (signals.categoryScores[signal.category] || 0) : 0;
  const score = vibeScore + categoryScore;
  if (score <= 0) return { score: 0, reason: null };

  if (vibeScore >= categoryScore && topVibe) {
    return { score, reason: { kind: 'vibe', vibe: topVibe } };
  }
  const recentMatch = signals.recent.find(r => r.category === signal.category);
  return { score, reason: { kind: 'category', category: signal.category as string, recentTitle: recentMatch?.title } };
}

function reasonLabel(reason: PickRankReason): string {
  if (reason.kind === 'vibe') return `For your ${reason.vibe} vibe`;
  return reason.recentTitle
    ? `Because you viewed ${reason.recentTitle}`
    : `Because you like ${reason.category}`;
}

// Re-ranks `cards` (already-built event/venue pool, pre-deal-injection) by
// local behavior signal score, descending. Non-event/venue cards and cards
// with no positive score keep their relative order (stable sort).
export function rankPicksPool(cards: ForYouCard[], signals: PicksSignals): ForYouCard[] {
  const hasSignals = Object.keys(signals.vibeScores).length > 0 || Object.keys(signals.categoryScores).length > 0;
  if (!hasSignals) return cards;

  const scored = cards.map((card, index) => ({ card, index, ...scoreCard(card, signals) }));
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));

  return scored.map(({ card, score, reason }) =>
    score > 0 && reason ? { ...card, rankReason: reasonLabel(reason) } : card
  );
}
