// ─────────────────────────────────────────────────────────────────────
// Wugi — picksSignalStore
// UAT-W3-3: local, on-device behavior-signal store for Picks (For You)
// ranking v1. Records additive signal weight per vibe + venue category,
// fed from the SAME interaction points as logForYouInteraction()
// (see analyticsService.ts + ForYouScreen.tsx) — no parallel event
// wiring, so W2D's analytics and this ranking signal stay in lockstep.
//
// Scoped to Picks ranking only. If/when a shared cross-feature
// interaction store lands, this should fold into it rather than run
// alongside it.
// ─────────────────────────────────────────────────────────────────────
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PicksSignalAction = 'view' | 'like' | 'skip';

// view (card shown) = noticed it; like (swipe-right/save) = stronger
// intent. skip carries no weight in v1 — additive, positive-only scoring
// per scope (a "skip lowers score" model is a v2 concern). The call site
// still exists for every action so ranking and analytics fire off the
// exact same events; it's just a no-op for 'skip'.
const SIGNAL_WEIGHTS: Record<PicksSignalAction, number> = { view: 1, like: 3, skip: 0 };

type PicksSignalState = {
  vibeScore:     Record<string, number>;
  categoryScore: Record<string, number>;
  // 0 => cold start; rankPicksPool() falls back to the incoming pool order.
  totalSignals:  number;

  recordSignal: (action: PicksSignalAction, target: { vibes: string[]; venueCategory: string | null }) => void;
  reset: () => void;
};

export const usePicksSignalStore = create<PicksSignalState>()(
  persist(
    (set) => ({
      vibeScore:     {},
      categoryScore: {},
      totalSignals:  0,

      recordSignal: (action, target) => {
        const weight = SIGNAL_WEIGHTS[action];
        if (weight <= 0) return;
        set((s) => {
          const vibeScore = { ...s.vibeScore };
          for (const v of target.vibes) {
            const key = v.toLowerCase();
            vibeScore[key] = (vibeScore[key] || 0) + weight;
          }
          const categoryScore = { ...s.categoryScore };
          if (target.venueCategory) {
            const key = target.venueCategory.toLowerCase();
            categoryScore[key] = (categoryScore[key] || 0) + weight;
          }
          return { vibeScore, categoryScore, totalSignals: s.totalSignals + 1 };
        });
      },

      reset: () => set({ vibeScore: {}, categoryScore: {}, totalSignals: 0 }),
    }),
    {
      name: 'wugi-picks-signal-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        vibeScore:     s.vibeScore,
        categoryScore: s.categoryScore,
        totalSignals:  s.totalSignals,
      }),
      version: 1,
    }
  )
);
