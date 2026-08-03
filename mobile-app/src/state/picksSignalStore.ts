// ─────────────────────────────────────────────────────────────────────
// Wugi — picksSignalStore
// UAT-W3-3 Picks For You v1: behavior-signal ranking scaffold
//
// Local (on-device) log of "viewed" / "saved" behavior on Picks cards,
// reduced into additive category/vibe scores that picksRanking.ts uses
// to re-rank the pool. This is a standalone scaffold, scoped to the Picks
// feed — issue #202 (W2-D interaction logging) had not landed on `main`
// at the time this was written, so there was no shared interaction store
// to consume yet. If/when #202 ships a broader interaction log, this
// store should fold into it rather than run in parallel.
//
// Persisted to AsyncStorage (same pattern as catalogStore.ts) so signals
// survive app restarts. No server round-trip — purely local personalization.
// ─────────────────────────────────────────────────────────────────────
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PickSignalKind = 'view' | 'save';

export type PickInteraction = {
  kind: PickSignalKind;
  category?: string;
  vibes: string[];
  title: string;
  ts: number;
};

// "save" (swipe-right / favorite) is a stronger intent signal than "view"
// (tap-through) — weighted accordingly in the additive score.
const SIGNAL_WEIGHT: Record<PickSignalKind, number> = { view: 1, save: 3 };

// Ring buffer of recent interactions, used only to attribute a "Because you
// viewed X" hint to a specific past card — not for scoring.
const MAX_RECENT = 40;

type PicksSignalState = {
  categoryScores: Record<string, number>;
  vibeScores: Record<string, number>;
  recent: PickInteraction[];

  recordSignal: (kind: PickSignalKind, input: { category?: string; vibes: string[]; title: string }) => void;
  reset: () => void;
};

export const usePicksSignalStore = create<PicksSignalState>()(
  persist(
    (set) => ({
      categoryScores: {},
      vibeScores: {},
      recent: [],

      recordSignal: (kind, { category, vibes, title }) => set((s) => {
        const weight = SIGNAL_WEIGHT[kind];

        const categoryScores = { ...s.categoryScores };
        if (category) categoryScores[category] = (categoryScores[category] || 0) + weight;

        const vibeScores = { ...s.vibeScores };
        for (const v of vibes) vibeScores[v] = (vibeScores[v] || 0) + weight;

        const interaction: PickInteraction = { kind, category, vibes, title, ts: Date.now() };
        const recent = [interaction, ...s.recent].slice(0, MAX_RECENT);

        return { categoryScores, vibeScores, recent };
      }),

      reset: () => set({ categoryScores: {}, vibeScores: {}, recent: [] }),
    }),
    {
      name: 'wugi-picks-signals-v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    }
  )
);

export const selectHasPicksSignals = (s: PicksSignalState): boolean =>
  Object.keys(s.categoryScores).length > 0 || Object.keys(s.vibeScores).length > 0;
