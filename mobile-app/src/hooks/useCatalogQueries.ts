// ─────────────────────────────────────────────────────────────────────
// Wugi — useCatalogQueries
// VENUE-DATA-07 Deliverable E.2
//
// React Query hooks over firestoreService catalog reads. All queries
// write through to the Zustand catalogStore on success so the UI
// renders instantly from cache on next mount.
//
// Stale times tuned to data volatility:
//   venues   1h    — slow churn (claims, status changes)
//   events   15m   — events come/go faster, ticket inventory drift
//   taxonomy 24h   — vibes / categories almost never change
//
// Cache time (gcTime) 24h on all queries — keeps data hot in memory
// for back-navigation even after staleTime expires; refetch-on-mount
// behavior controlled by staleTime.
//
// Inventory display rule (per ticket Deliverable E.7): NEVER read
// table availability from these hooks. Use useLiveSubscription for
// any field that affects ticketing decisions.
// ─────────────────────────────────────────────────────────────────────
import { useEffect } from 'react';
import {
  useQuery,
  useInfiniteQuery,
  useQueryClient,
  type UseQueryOptions,
  type UseInfiniteQueryOptions,
} from '@tanstack/react-query';
import {
  getApprovedVenues,
  getApprovedEvents,
  getApprovedVenuesPage,
  getApprovedEventsPage,
  getVenueById,
  getEventById,
  type FSVenue,
  type FSEvent,
} from '../../firestoreService';
import { useCatalogStore } from '../state/catalogStore';

// Stale-time constants
const STALE_VENUES   = 60 * 60 * 1000;       // 1h
const STALE_EVENTS   = 15 * 60 * 1000;       // 15m
const STALE_TAXONOMY = 24 * 60 * 60 * 1000;  // 24h
const GC_DAY         = 24 * 60 * 60 * 1000;

// Query keys (single source of truth; same shape app-wide)
export const queryKeys = {
  venues:        (filter?: { vibes?: string[] }) => ['venues', filter ?? {}] as const,
  venuesInfinite:(filter?: { vibes?: string[] }) => ['venues', 'infinite', filter ?? {}] as const,
  venueById:     (id: string) => ['venue', id] as const,
  events:        (filter?: { vibes?: string[] }) => ['events', filter ?? {}] as const,
  eventsInfinite:(filter?: { vibes?: string[] }) => ['events', 'infinite', filter ?? {}] as const,
  eventById:     (id: string) => ['event', id] as const,
  vibes:         () => ['taxonomy', 'vibes'] as const,
};

// ── Venues (single page, 100 default) ────────────────────────────────
export function useVenues(
  filter?: { vibes?: string[] },
  options?: Omit<UseQueryOptions<FSVenue[]>, 'queryKey' | 'queryFn'>
) {
  const setVenues = useCatalogStore((s) => s.setVenues);

  const q = useQuery<FSVenue[]>({
    queryKey:  queryKeys.venues(filter),
    queryFn:   async () => getApprovedVenues(filter?.vibes, 100),
    staleTime: STALE_VENUES,
    gcTime:    GC_DAY,
    ...options,
  });

  // Write-through to Zustand on success
  useEffect(() => {
    if (q.data && q.data.length) setVenues(q.data);
  }, [q.data, setVenues]);

  return q;
}

// ── Venues (infinite, cursor pagination — Discover scroll) ──────────
type VenuePage = { venues: FSVenue[]; nextCursor: any; hasMore: boolean };

export function useInfiniteVenues(filter?: { vibes?: string[] }) {
  const setVenues = useCatalogStore((s) => s.setVenues);

  const q = useInfiniteQuery<VenuePage, Error, { pages: VenuePage[]; pageParams: any[] }, readonly unknown[], any>({
    queryKey:        queryKeys.venuesInfinite(filter),
    queryFn:         async ({ pageParam }) => getApprovedVenuesPage({
      cursor:    (pageParam as any) ?? null,
      limit:     30,
      userVibes: filter?.vibes,
    }) as Promise<VenuePage>,
    initialPageParam: null,
    getNextPageParam: (last: VenuePage) => (last.hasMore ? last.nextCursor : undefined),
    staleTime:       STALE_VENUES,
    gcTime:          GC_DAY,
  });

  useEffect(() => {
    if (!q.data) return;
    const all: FSVenue[] = [];
    for (const page of q.data.pages) all.push(...((page && page.venues) || []));
    if (all.length) setVenues(all);
  }, [q.data, setVenues]);

  return q;
}

// ── Single venue (in-cache lookup, falls back to fetch) ──────────────
export function useVenue(id: string | null | undefined) {
  const cached     = useCatalogStore((s) => (id ? s.venues[id] : undefined));
  const upsert     = useCatalogStore((s) => s.upsertVenue);

  const q = useQuery<FSVenue | null>({
    queryKey:  queryKeys.venueById(id || '__none__'),
    queryFn:   async () => (id ? getVenueById(id) : null),
    enabled:   !!id && !cached,
    staleTime: STALE_VENUES,
    gcTime:    GC_DAY,
    initialData: cached ?? undefined,
  });

  useEffect(() => { if (q.data) upsert(q.data); }, [q.data, upsert]);
  return q;
}

// ── Events (single page) ─────────────────────────────────────────────
export function useEvents(
  filter?: { vibes?: string[] },
  options?: Omit<UseQueryOptions<FSEvent[]>, 'queryKey' | 'queryFn'>
) {
  const setEvents = useCatalogStore((s) => s.setEvents);

  const q = useQuery<FSEvent[]>({
    queryKey:  queryKeys.events(filter),
    queryFn:   async () => getApprovedEvents(filter?.vibes, 100),
    staleTime: STALE_EVENTS,
    gcTime:    GC_DAY,
    ...options,
  });

  useEffect(() => {
    if (q.data && q.data.length) setEvents(q.data);
  }, [q.data, setEvents]);

  return q;
}

// ── Events (infinite, cursor pagination) ─────────────────────────────
type EventPage = { events: FSEvent[]; nextCursor: any; hasMore: boolean };

export function useInfiniteEvents(filter?: { vibes?: string[] }) {
  const setEvents = useCatalogStore((s) => s.setEvents);

  const q = useInfiniteQuery<EventPage, Error, { pages: EventPage[]; pageParams: any[] }, readonly unknown[], any>({
    queryKey:        queryKeys.eventsInfinite(filter),
    queryFn:         async ({ pageParam }) => getApprovedEventsPage({
      cursor:    (pageParam as any) ?? null,
      limit:     30,
      userVibes: filter?.vibes,
    }) as Promise<EventPage>,
    initialPageParam: null,
    getNextPageParam: (last: EventPage) => (last.hasMore ? last.nextCursor : undefined),
    staleTime:       STALE_EVENTS,
    gcTime:          GC_DAY,
  });

  useEffect(() => {
    if (!q.data) return;
    const all: FSEvent[] = [];
    for (const page of q.data.pages) all.push(...((page && page.events) || []));
    if (all.length) setEvents(all);
  }, [q.data, setEvents]);

  return q;
}

// ── Single event ─────────────────────────────────────────────────────
export function useEvent(id: string | null | undefined) {
  const cached = useCatalogStore((s) => (id ? s.events[id] : undefined));
  const upsert = useCatalogStore((s) => s.upsertEvent);

  const q = useQuery<FSEvent | null>({
    queryKey:  queryKeys.eventById(id || '__none__'),
    queryFn:   async () => (id ? getEventById(id) : null),
    enabled:   !!id && !cached,
    staleTime: STALE_EVENTS,
    gcTime:    GC_DAY,
    initialData: cached ?? undefined,
  });

  useEffect(() => { if (q.data) upsert(q.data); }, [q.data, upsert]);
  return q;
}

// ── Featured venues (derived selector) ───────────────────────────────
// Reads from cache (no extra query); useVenues() must be called somewhere
// upstream to prime the data. Returns immediately even before network.
export function useFeaturedVenues(): FSVenue[] {
  return useCatalogStore((s) => Object.values(s.venues).filter((v) => v && v.isFeatured));
}

// ── Vibes / category taxonomy (24h staleTime) ────────────────────────
// Static-ish derived list of canonical vibes — lifted directly from the
// store so it can be used wherever vibe filters are rendered.
export function useVibes(): string[] {
  // Until taxonomy reads ever go to Firestore, we just expose what's
  // already in the store (seeded by useVenues writes / hard-coded list).
  return useCatalogStore((s) => s.vibes);
}

// ── Imperative invalidation helper ───────────────────────────────────
// Used by App.tsx's AppState foreground listener to force-refetch after
// a >5min idle period.
export function useInvalidateCatalog() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['venues'] });
    qc.invalidateQueries({ queryKey: ['events'] });
  };
}
