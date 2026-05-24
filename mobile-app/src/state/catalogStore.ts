// ─────────────────────────────────────────────────────────────────────
// Wugi — catalogStore
// VENUE-DATA-07 Deliverable E.1
//
// Zustand store for catalog metadata: venues, events, taxonomy. Persisted
// to AsyncStorage so the app can render from cache on cold start before
// any network request resolves.
//
// SCOPE — catalog metadata ONLY. Never store anything live/transactional
// here (passes, orders, ticket inventory, Wugi Lens uploads, Door scans
// — those mount Firestore onSnapshot listeners on the screen that needs
// them, see useLiveSubscription.ts).
// ─────────────────────────────────────────────────────────────────────
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FSVenue, FSEvent } from '../../firestoreService';

type VenueMap = Record<string, FSVenue>;
type EventMap = Record<string, FSEvent>;

type CatalogState = {
  venues:           VenueMap;
  events:           EventMap;
  vibes:            string[];
  lastHydratedAt:   number | null;

  // Mutators (only React Query write-throughs should call these)
  setVenues:        (list: FSVenue[]) => void;
  setEvents:        (list: FSEvent[]) => void;
  upsertVenue:      (v: FSVenue) => void;
  upsertEvent:      (e: FSEvent) => void;
  setVibes:         (vibes: string[]) => void;
  invalidate:       () => void;        // resets lastHydratedAt; queries refetch on next access
  reset:            () => void;        // wipes everything; for tests / sign-out
};

const toMap = <T extends { id: string }>(list: T[]): Record<string, T> => {
  const out: Record<string, T> = {};
  for (const item of list) if (item && item.id) out[item.id] = item;
  return out;
};

export const useCatalogStore = create<CatalogState>()(
  persist(
    (set) => ({
      venues:         {},
      events:         {},
      vibes:          [],
      lastHydratedAt: null,

      setVenues: (list) => set((s) => ({
        venues: { ...s.venues, ...toMap(list) },
        lastHydratedAt: Date.now(),
      })),
      setEvents: (list) => set((s) => ({
        events: { ...s.events, ...toMap(list) },
        lastHydratedAt: Date.now(),
      })),
      upsertVenue: (v) => set((s) => v && v.id ? { venues: { ...s.venues, [v.id]: v } } : s),
      upsertEvent: (e) => set((s) => e && e.id ? { events: { ...s.events, [e.id]: e } } : s),
      setVibes:    (vibes) => set({ vibes }),
      invalidate:  () => set({ lastHydratedAt: null }),
      reset:       () => set({ venues: {}, events: {}, vibes: [], lastHydratedAt: null }),
    }),
    {
      name: 'wugi-catalog-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist data fields, not action references
      partialize: (s) => ({
        venues:         s.venues,
        events:         s.events,
        vibes:          s.vibes,
        lastHydratedAt: s.lastHydratedAt,
      }),
      // Bump on schema changes that require dropping old data on disk
      version: 1,
    }
  )
);

// ── Selectors (memoizable in React Query) ─────────────────────────────
export const selectVenuesArray = (s: CatalogState): FSVenue[] => Object.values(s.venues);
export const selectEventsArray = (s: CatalogState): FSEvent[] => Object.values(s.events);
export const selectVenueById   = (id: string) => (s: CatalogState): FSVenue | undefined => s.venues[id];
export const selectEventById   = (id: string) => (s: CatalogState): FSEvent | undefined => s.events[id];
