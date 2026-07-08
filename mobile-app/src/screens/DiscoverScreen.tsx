// ─────────────────────────────────────────────────────────────────────
// Wugi — DiscoverScreen  (Wave 1 full redesign)
//
// Design source: design_handoff_event_discover/README.md §2 DiscoverScreen
//
// Layout:
//   • Header (pt 60 / ph 16 / pb 14):
//       - "Discover" centered bold title (22px / display / -0.7 tracking)
//       - Row below: flex search input (card bg, 12px radius, accent border +
//         glow on focus, inline × clear) + 44×44 map-toggle icon button right
//   • Sticky filter bar:
//       - Category pills (All / Events / Venues / Deals) — single-select,
//         active = accent fill + onAccent text, inactive = card + text + border,
//         radius 999, 6px gap, horizontal scroll
//       - Vibe pills — single-select toggle, each with 6×6 dot in vibe accent;
//         active = ${accent}26 bg + 1px accent border + accent text,
//         inactive = card + subtext + border
//   • Results header: mono "{N} RESULTS [· VIBE]" + list/grid toggle
//   • Results body — three states:
//       (a) map ON → MapPlaceholder (~420px, grid-texture bg + map icon + "COMING SOON")
//           and hide list/grid toggle
//       (b) list view → ResultListCard (88px square thumb + type chip + name + sub + chevron)
//       (c) grid view → 2-col ResultGridCard (aspect-1 photo with type chip overlay + name + sub)
//   • Empty state: "Nothing matches that" / "Try a different search or filter."
//     with a "Clear filters" action when a search/category/vibe is active
//   • Recent searches dropdown (kept from existing implementation)
//   • Pull-to-refresh
//   • Firestore fetch only — error/timeout → retryable ErrorState (no mock fallback)
//
// DROPPED (no backing data — real-data-only rule):
//   • Neighborhood guide shelf (no Firestore collection)
//   • Photographer feature shelf (no Lens/galleries editorial data)
//   • "Just opened" shelf (no openedAt date field in venues)
//   • Weekend itineraries shelf (no itineraries collection)
//   • Vibe deep-dive ranked shelf (no rankings collection)
//   • Full clustered map with pins (out-of-scope per instructions — placeholder only)
//   • Token-dimension search overlay (backend facets not wired; real TextInput kept)
//
// Files touched: DiscoverScreen.tsx only (icons already in icons/index.tsx).
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  SafeAreaView, TextInput, Dimensions, ActivityIndicator,
  StyleSheet, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Circle, Rect, Line } from 'react-native-svg';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, FSEvent, FSVenue } from '../types';
import { makeGallery } from '../constants/mockData';
import { FONTS, MONO } from '../constants/fonts';
import { SearchIcon, ChevronRightIcon } from '../components/icons';
import { ErrorState, EmptyState } from '../components/StateViews';
import { dealTypeLabel } from '../utils/deals';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Converters ────────────────────────────────────────────────────────
function toEventData(e: FSEvent): EventData {
  return {
    id: e.id, title: e.title, venue: e.venue, venueId: e.venueId,
    seriesId: e.seriesId ?? null,
    date: e.date, time: e.time, age: e.age, about: e.about || '',
    media: e.media || [],
    hasTickets: (e as any).hasTickets === true,
    gallery: makeGallery(e.id, e.title, e.venue, e.date, ['gp1','gp2','gp3','gp4']),
  };
}

function toVenueData(v: FSVenue): VenueData {
  return {
    id: v.id, name: v.name, category: v.category || '',
    address: v.address || '', phone: v.phone || '',
    logoUrl: (v as any).logoUrl || '',
    website: v.website || '', instagram: v.instagram || '',
    attributes: v.attributes || [], about: v.about || '',
    media: (v.media || []).map(m =>
      typeof m === 'string' ? { type: 'image', uri: m } : m
    ),
    menuDescription: v.about || '', menuAttributes: v.attributes || [],
    bestSellers: [], upcomingEvents: [], galleries: [],
    shortDescription: v.shortDescription, neighborhood: v.neighborhood,
    priceTier: v.priceTier, rating: v.rating, age: v.age,
    dressCode: v.dressCode, hoursText: v.hoursText,
    openStatusHint: v.openStatusHint, amenities: v.amenities,
    vibes: v.vibes,
    reservationProvider: v.reservationProvider,
    reservationUrl: v.reservationUrl,
    reservationUrlWithDefaults: v.reservationUrlWithDefaults,
    ctaPrimary: v.ctaPrimary, ctaSecondary: v.ctaSecondary,
  };
}

// ── Types ─────────────────────────────────────────────────────────────
type DiscoverItem =
  | { kind: 'event'; data: EventData; image: string }
  | { kind: 'venue'; data: VenueData; image: string }
  | { kind: 'deal';  title: string; venueName: string; detail: string; image: string; dealType?: string };

const CATEGORIES = ['All', 'Events', 'Venues', 'Deals'] as const;
type Category = typeof CATEGORIES[number];

// Vibe vocabulary with per-vibe accent colors (per design spec).
const DISCOVER_VIBES = [
  { label: 'Boujee',      accent: '#9b59b6' },
  { label: 'Divey',       accent: '#d49a6a' },
  { label: 'Speakeasy',   accent: '#95a5a6' },
  { label: 'High Energy', accent: '#d97a6a' },
  { label: 'Rooftop',     accent: '#5ba8c4' },
  { label: 'Late Night',  accent: '#3d3a8c' },
];

// Content-type tag colors (per design spec).
const TAG_COLORS = {
  event: '#5fa080',
  venue: '#5ba8c4',
  deal:  '#a8533f',
} as const;

// ── Helpers ───────────────────────────────────────────────────────────
const getItemName = (item: DiscoverItem): string => {
  if (item.kind === 'event') return item.data.title ?? '';
  if (item.kind === 'venue') return item.data.name ?? '';
  return (item as any).title ?? '';
};
const getItemSub = (item: DiscoverItem): string => {
  if (item.kind === 'event') return `${item.data.venue ?? ''} · ${item.data.date ?? ''}`;
  if (item.kind === 'venue') return item.data.category ?? '';
  return (item as any).venueName ?? '';
};
const getItemTag = (item: DiscoverItem): { label: string; color: string } => {
  if (item.kind === 'event') return { label: 'EVENT', color: TAG_COLORS.event };
  if (item.kind === 'venue') return { label: 'VENUE', color: TAG_COLORS.venue };
  return                            { label: 'DEAL',  color: TAG_COLORS.deal  };
};
const getItemImage = (item: DiscoverItem): string => item.image;

// ── Inline icon helpers (kept inline — avoid modifying icons/index.tsx) ─
function MapIconSvg({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 9m0 8V9m0 0L9 7"
        stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      />
    </Svg>
  );
}

function GridIconSvg({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}

function ListIconSvg({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke={color} strokeWidth={1.8} strokeLinecap="round"/>
    </Svg>
  );
}

function CloseIconSvg({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M18 6L6 18M6 6l12 12" stroke={color} strokeWidth={2} strokeLinecap="round"/>
    </Svg>
  );
}

// ── Map placeholder card (420px, subtle grid texture via nested Views) ─
function MapPlaceholder({ theme }: { theme: Theme }) {
  return (
    <View style={{
      marginHorizontal: 16, borderRadius: 16, overflow: 'hidden',
      height: 420,
      backgroundColor: theme.surface,
      borderWidth: 1, borderColor: theme.border,
    }}>
      {/* Grid texture overlay — 8×8 dots pattern using a tight View grid */}
      <View style={StyleSheet.absoluteFillObject}>
        {/* Horizontal lines */}
        {Array.from({ length: 14 }).map((_, i) => (
          <View key={`h${i}`} style={{
            position: 'absolute',
            top: i * 30 + 15,
            left: 0, right: 0,
            height: 1,
            backgroundColor: 'rgba(244,239,225,0.04)',
          }}/>
        ))}
        {/* Vertical lines */}
        {Array.from({ length: 12 }).map((_, i) => (
          <View key={`v${i}`} style={{
            position: 'absolute',
            left: i * 30 + 15,
            top: 0, bottom: 0,
            width: 1,
            backgroundColor: 'rgba(244,239,225,0.04)',
          }}/>
        ))}
        {/* Radial center glow via a center-positioned View */}
        <View style={{
          position: 'absolute',
          top: '20%', left: '20%', right: '20%', bottom: '20%',
          borderRadius: 999,
          backgroundColor: 'rgba(42,122,90,0.06)',
        }}/>
      </View>

      {/* Content */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{
          width: 56, height: 56, borderRadius: 28,
          backgroundColor: theme.card,
          borderWidth: 1, borderColor: theme.border,
          alignItems: 'center', justifyContent: 'center',
          marginBottom: 14,
        }}>
          <MapIconSvg color={theme.subtext} size={24}/>
        </View>
        <Text style={{
          color: theme.subtext,
          fontSize: 11, fontFamily: MONO, letterSpacing: 0.5,
          textTransform: 'uppercase', marginBottom: 4,
        }}>
          COMING SOON
        </Text>
        <Text style={{
          color: theme.subtext, fontSize: 13, fontFamily: FONTS.body,
          textAlign: 'center', paddingHorizontal: 24, opacity: 0.7,
        }}>
          Interactive map with venue pins is coming in a future update.
        </Text>
      </View>
    </View>
  );
}

// ── Props ─────────────────────────────────────────────────────────────
type Props = {
  theme: Theme;
  onEventPress: (event: EventData) => void;
  onVenuePress: (venue: VenueData) => void;
  // Additive (editorial Discover): when this screen is pushed as the search/
  // filter mode from the editorial default view, onBack returns to it and
  // initialMapOn opens directly on the map placeholder. Both optional — when
  // absent the screen behaves exactly as before (e.g. as a standalone tab).
  onBack?: () => void;
  initialMapOn?: boolean;
};

// ── Main screen ───────────────────────────────────────────────────────
export function DiscoverScreen({ theme, onEventPress, onVenuePress, onBack, initialMapOn }: Props) {
  const [search,         setSearch]         = useState('');
  const [searchFocused,  setSearchFocused]  = useState(false);
  const [cat,            setCat]            = useState<Category>('All');
  const [vibe,           setVibe]           = useState<string | null>(null);
  const [view,           setView]           = useState<'list' | 'grid'>('list');
  const [mapOn,          setMapOn]          = useState(initialMapOn ?? false);
  const [allResults,     setAllResults]     = useState<DiscoverItem[]>([]);
  const [status,         setStatus]         = useState<'loading' | 'ready' | 'error'>('loading');
  const [refreshing,     setRefreshing]     = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const RECENT_KEY = 'wugi_recent_searches';
  const MAX_RECENT = 8;

  // ── Recent searches ───────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY)
      .then(v => { if (v) setRecentSearches(JSON.parse(v)); })
      .catch(() => {});
  }, []);

  const saveSearch = async (term: string) => {
    if (!term.trim()) return;
    const updated = [term, ...recentSearches.filter(s => s !== term)].slice(0, MAX_RECENT);
    setRecentSearches(updated);
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated)).catch(() => {});
  };

  const clearRecentSearches = async () => {
    setRecentSearches([]);
    await AsyncStorage.removeItem(RECENT_KEY).catch(() => {});
  };

  const handleSearchSubmit = () => {
    if (search.trim()) saveSearch(search.trim());
  };

  const handleRecentPress = (term: string) => {
    setSearch(term);
    setSearchFocused(false);
    saveSearch(term);
  };

  // ── Fetch from Firestore ──────────────────────────────────────────
  // Real data only — a failed or hung fetch surfaces the error state (with
  // retry) instead of silently substituting stale mock content.
  const loadData = async (): Promise<'ready' | 'error'> => {
    try {
      const { getApprovedEvents, getApprovedVenues, getActiveDeals } =
        await import('../../firestoreService');

      const fetchAll = Promise.all([
        getApprovedEvents([], 100),
        getApprovedVenues([], 100),
        getActiveDeals([], 10),
      ]);
      // 8000ms guard — a stalled fetch becomes an error, not an endless spinner.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 8000)
      );
      const [liveEvents, liveVenues, liveDeals] = await Promise.race([fetchAll, timeout]);

      const results: DiscoverItem[] = [];

      liveEvents.forEach(e => results.push({
        kind: 'event',
        data: toEventData(e),
        image: (e.media || [])[0]?.uri || '',
      }));

      liveVenues.forEach(v => results.push({
        kind: 'venue',
        data: toVenueData(v),
        image: (() => {
          const first = (v.media || [])[0] as any;
          if (!first) return '';
          if (typeof first === 'string') return first;
          return first?.uri || '';
        })(),
      }));

      liveDeals.forEach(d => results.push({
        kind: 'deal',
        title: d.title,
        venueName: d.venueName,
        detail: d.detail,
        image: d.image || '',
        dealType: d.dealType,
      }));

      setAllResults(results);
      return 'ready';
    } catch (e) {
      console.log('DiscoverScreen: fetch failed', e);
      return 'error';
    }
  };

  useEffect(() => {
    let cancelled = false;
    loadData().then(result => { if (!cancelled) setStatus(result); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = () => {
    setStatus('loading');
    loadData().then(setStatus);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    const result = await loadData();
    setStatus(result);
    setRefreshing(false);
  };

  // ── Filter ────────────────────────────────────────────────────────
  const filtered = allResults.filter(item => {
    const matchCat =
      cat === 'All' ||
      (cat === 'Events' && item.kind === 'event') ||
      (cat === 'Venues' && item.kind === 'venue') ||
      (cat === 'Deals'  && item.kind === 'deal');

    const name = getItemName(item).toLowerCase();
    const sub  = getItemSub(item).toLowerCase();
    // Deals are also searchable by their deal type (e.g. "happy hour").
    const extra = item.kind === 'deal' ? dealTypeLabel(item.dealType).toLowerCase() : '';
    const q    = search.toLowerCase();
    const matchSearch = search === '' || name.includes(q) || sub.includes(q) || (extra !== '' && extra.includes(q));

    const matchVibe = !vibe || (() => {
      if (item.kind === 'event') return item.data.about?.toLowerCase().includes(vibe.toLowerCase());
      if (item.kind === 'venue') return (
        item.data.attributes?.some(a => a.toLowerCase().includes(vibe.toLowerCase())) ||
        item.data.category?.toLowerCase().includes(vibe.toLowerCase()) ||
        (item.data.vibes as string[] | undefined)?.some(vb => vb.toLowerCase() === vibe.toLowerCase())
      );
      return true;
    })();

    return matchCat && matchSearch && matchVibe;
  });

  const handleItemPress = (item: DiscoverItem) => {
    if (item.kind === 'event') onEventPress(item.data);
    else if (item.kind === 'venue') onVenuePress(item.data);
    // deal cards non-navigating (sheet not in scope)
  };

  const COL_WIDTH = (SCREEN_WIDTH - 48) / 2;

  // ── List row card ────────────────────────────────────────────────
  const renderListItem = (item: DiscoverItem, index: number) => {
    const tag = getItemTag(item);
    return (
      <TouchableOpacity
        key={index}
        style={{
          flexDirection: 'row', alignItems: 'center',
          backgroundColor: theme.card, borderRadius: 14, overflow: 'hidden',
          borderWidth: 1, borderColor: theme.border, marginBottom: 10,
        }}
        onPress={() => handleItemPress(item)}
        activeOpacity={0.85}
      >
        {/* Thumbnail — 88px square */}
        <Image
          cachePolicy="memory-disk"
          source={{ uri: getItemImage(item) }}
          style={{ width: 88, height: 88 }}
          contentFit="cover"
        />
        {/* Body */}
        <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10 }}>
          {/* Type chip */}
          <View style={{
            alignSelf: 'flex-start',
            backgroundColor: tag.color + '22',
            borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2,
            marginBottom: 5,
          }}>
            <Text style={{ color: tag.color, fontSize: 9, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.5 }}>
              {tag.label}
            </Text>
          </View>
          <Text style={{ color: theme.text, fontSize: 14, fontFamily: FONTS.display, letterSpacing: -0.2, marginBottom: 3 }} numberOfLines={1}>
            {getItemName(item)}
          </Text>
          <Text style={{ color: theme.subtext, fontSize: 12, fontFamily: FONTS.body }} numberOfLines={1}>
            {getItemSub(item)}
          </Text>
        </View>
        {/* Chevron */}
        <View style={{ paddingRight: 14 }}>
          <ChevronRightIcon color={theme.subtext}/>
        </View>
      </TouchableOpacity>
    );
  };

  // ── Grid card ────────────────────────────────────────────────────
  const renderGridItem = (item: DiscoverItem, index: number) => {
    const tag = getItemTag(item);
    return (
      <TouchableOpacity
        key={index}
        style={{
          width: COL_WIDTH, borderRadius: 14, overflow: 'hidden',
          backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
        }}
        onPress={() => handleItemPress(item)}
        activeOpacity={0.85}
      >
        {/* Cover photo — aspect 1:1 */}
        <View style={{ position: 'relative', width: COL_WIDTH, height: COL_WIDTH }}>
          <Image
            cachePolicy="memory-disk"
            source={{ uri: getItemImage(item) }}
            style={{ width: COL_WIDTH, height: COL_WIDTH }}
            contentFit="cover"
          />
          {/* Soft scrim */}
          <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' }}/>
          {/* Type chip — top-left overlay (solid color per spec) */}
          <View style={{
            position: 'absolute', top: 8, left: 8,
            backgroundColor: tag.color, borderRadius: 5,
            paddingHorizontal: 6, paddingVertical: 2,
          }}>
            <Text style={{ color: '#fff', fontSize: 9, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.4 }}>
              {tag.label}
            </Text>
          </View>
        </View>
        {/* Caption */}
        <View style={{ padding: 10 }}>
          <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.display, letterSpacing: -0.1, marginBottom: 2 }} numberOfLines={1}>
            {getItemName(item)}
          </Text>
          <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: FONTS.body }} numberOfLines={1}>
            {getItemSub(item)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  // ── Loading ───────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} size="large"/>
        <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, marginTop: 12 }}>
          Loading…
        </Text>
      </View>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center' }}>
        <ErrorState theme={theme} onRetry={retry}/>
      </View>
    );
  }

  // ── Empty results — "Nothing matches" + clear-filters action ───────
  const hasActiveFilters = search !== '' || cat !== 'All' || vibe !== null;
  const clearFilters = () => {
    setSearch('');
    setCat('All');
    setVibe(null);
  };
  const renderEmpty = () => (
    <EmptyState
      theme={theme}
      title="Nothing matches that"
      message="Try a different search or filter."
      actionLabel={hasActiveFilters ? 'Clear filters' : undefined}
      onAction={hasActiveFilters ? clearFilters : undefined}
    />
  );

  // ── Render ────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>

      {/* ── Header ────────────────────────────────────────────────────
           padding: top 60 / horizontal 16 / bottom 14
           Row 1: centered "Discover" title (22px / display / -0.7)
           Row 2: flex search input + 44×44 map toggle (right of search)
      ──────────────────────────────────────────────────────────────── */}
      <SafeAreaView style={{
        backgroundColor: theme.bg,
        borderBottomWidth: 1, borderBottomColor: theme.divider,
        paddingHorizontal: 16,
        paddingTop: 60,
        paddingBottom: 14,
      }}>
        {/* Title — centered. Back button (left) only when pushed as a
            stack screen from the editorial default view. */}
        {onBack && (
          <TouchableOpacity
            onPress={onBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ position: 'absolute', left: 16, top: 58, zIndex: 10, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M15 18l-6-6 6-6" stroke={theme.text} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </TouchableOpacity>
        )}
        <Text style={{
          color: theme.text,
          fontSize: 22,
          fontFamily: FONTS.display,
          letterSpacing: -0.7,
          textAlign: 'center',
          marginBottom: 12,
        }}>
          Discover
        </Text>

        {/* Search bar + map toggle row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {/* Search input */}
          <View style={{
            flex: 1,
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: theme.card,
            borderRadius: 12,
            borderWidth: searchFocused ? 1.5 : 1,
            borderColor: searchFocused ? theme.accent : theme.border,
            paddingHorizontal: 12, paddingVertical: 10, gap: 8,
            ...(searchFocused ? {
              shadowColor: theme.accent,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.08,
              shadowRadius: 4,
            } : {}),
          }}>
            <SearchIcon color={searchFocused ? theme.accent : theme.subtext}/>
            <TextInput
              placeholder="Search venues, events, vibes…"
              placeholderTextColor={theme.subtext}
              value={search}
              onChangeText={setSearch}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              onSubmitEditing={handleSearchSubmit}
              style={{ flex: 1, color: theme.text, fontSize: 14, fontFamily: FONTS.body, padding: 0 }}
              returnKeyType="search"
            />
            {/* Inline × clear button */}
            {search.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearch('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <CloseIconSvg color={theme.subtext} size={16}/>
              </TouchableOpacity>
            )}
          </View>

          {/* Map toggle — 44×44, filled accent when active */}
          <TouchableOpacity
            onPress={() => setMapOn(v => !v)}
            style={{
              width: 44, height: 44,
              borderRadius: 12,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: mapOn ? theme.accent : theme.card,
              borderWidth: 1,
              borderColor: mapOn ? theme.accent : theme.border,
            }}
            activeOpacity={0.85}
          >
            <MapIconSvg color={mapOn ? theme.onAccent : theme.subtext} size={20}/>
          </TouchableOpacity>
        </View>

        {/* Recent searches dropdown (shown when focused, no query, and recents exist) */}
        {searchFocused && search.length === 0 && recentSearches.length > 0 && (
          <View style={{
            marginTop: 8,
            backgroundColor: theme.card, borderRadius: 12,
            borderWidth: 1, borderColor: theme.border,
            overflow: 'hidden', zIndex: 100,
          }}>
            <View style={{
              flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
              paddingHorizontal: 14, paddingVertical: 10,
              borderBottomWidth: 1, borderBottomColor: theme.divider,
            }}>
              <Text style={{ color: theme.subtext, fontSize: 10, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.5 }}>
                RECENT SEARCHES
              </Text>
              <TouchableOpacity onPress={clearRecentSearches}>
                <Text style={{ color: theme.accent, fontSize: 11, fontFamily: FONTS.medium }}>Clear</Text>
              </TouchableOpacity>
            </View>
            {recentSearches.map((term, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => handleRecentPress(term)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  paddingHorizontal: 14, paddingVertical: 12,
                  borderTopWidth: i > 0 ? 1 : 0, borderTopColor: theme.divider,
                }}
              >
                {/* Clock icon */}
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke={theme.subtext} strokeWidth={1.8} strokeLinecap="round"/>
                </Svg>
                <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.body, flex: 1 }}>{term}</Text>
                <TouchableOpacity
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => {
                    const updated = recentSearches.filter(s => s !== term);
                    setRecentSearches(updated);
                    AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated)).catch(() => {});
                  }}
                >
                  <CloseIconSvg color={theme.subtext} size={12}/>
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </SafeAreaView>

      {/* ── Main scroll — sticky filter bar + results ──────────────────── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[0]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >

        {/* ── Sticky filter bar ──────────────────────────────────────────
             • Category pills: single-select, radius 999, 6px gap
               active = accent fill + onAccent text
               inactive = card + text (not subtext) + border
             • Vibe pills: single-select toggle, 6px gap
               active = ${accent}26 bg + 1px solid accent border + accent text
               inactive = card + subtext + border
        ──────────────────────────────────────────────────────────────── */}
        <View style={{
          backgroundColor: theme.bg,
          paddingTop: 10, paddingBottom: 10,
          borderBottomWidth: 1, borderBottomColor: theme.divider,
        }}>
          {/* Category pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}
          >
            {CATEGORIES.map(c => {
              const active = cat === c;
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCat(c)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 7,
                    borderRadius: 999,
                    backgroundColor: active ? theme.accent : theme.card,
                    borderWidth: 1,
                    borderColor: active ? theme.accent : theme.border,
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={{
                    color: active ? theme.onAccent : theme.text,
                    fontSize: 13, fontFamily: FONTS.medium,
                  }}>
                    {c}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Vibe pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 6, marginTop: 8 }}
          >
            {DISCOVER_VIBES.map(v => {
              const active = vibe === v.label;
              // active: ${accent}26 bg + 1px accent border + accent text
              // inactive: card bg + subtext + border
              const activeBg = v.accent + '26'; // ~15% opacity hex
              return (
                <TouchableOpacity
                  key={v.label}
                  onPress={() => setVibe(active ? null : v.label)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 5,
                    paddingHorizontal: 12, paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: active ? activeBg : theme.card,
                    borderWidth: 1,
                    borderColor: active ? v.accent : theme.border,
                  }}
                  activeOpacity={0.8}
                >
                  {/* 6×6 dot in vibe accent color */}
                  <View style={{
                    width: 6, height: 6, borderRadius: 3,
                    backgroundColor: v.accent,
                  }}/>
                  <Text style={{
                    color: active ? v.accent : theme.subtext,
                    fontSize: 12, fontFamily: FONTS.medium,
                  }}>
                    {v.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Results header — mono count + list/grid toggle ─────────────
             Format: "{N} RESULTS" [+ " · VIBE" when vibe active]
             Toggle hidden when map is ON
        ──────────────────────────────────────────────────────────────── */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
        }}>
          <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.4 }}>
            {filtered.length} RESULTS{vibe ? ` · ${vibe.toUpperCase()}` : ''}
          </Text>
          {!mapOn && (
            <TouchableOpacity
              onPress={() => setView(v => v === 'list' ? 'grid' : 'list')}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: 10, paddingVertical: 6,
                borderRadius: 8, backgroundColor: theme.card,
                borderWidth: 1, borderColor: theme.border,
              }}
              activeOpacity={0.8}
            >
              {view === 'list'
                ? <GridIconSvg color={theme.subtext}/>
                : <ListIconSvg color={theme.subtext}/>
              }
              <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: FONTS.medium }}>
                {view === 'list' ? 'Grid' : 'List'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Results body — three states ───────────────────────────────
             (a) map ON → MapPlaceholder (~420px card)
             (b) list view → vertical ResultListCards
             (c) grid view → 2-col ResultGridCards
             Empty state for list/grid when nothing matches
        ──────────────────────────────────────────────────────────────── */}
        {mapOn ? (
          <MapPlaceholder theme={theme}/>
        ) : view === 'list' ? (
          <View style={{ paddingHorizontal: 16 }}>
            {filtered.length === 0
              ? renderEmpty()
              : filtered.map((item, i) => renderListItem(item, i))
            }
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            {filtered.length === 0
              ? <View style={{ width: '100%' }}>{renderEmpty()}</View>
              : filtered.map((item, i) => renderGridItem(item, i))
            }
          </View>
        )}

        <View style={{ height: 40 }}/>
      </ScrollView>
    </View>
  );
}
