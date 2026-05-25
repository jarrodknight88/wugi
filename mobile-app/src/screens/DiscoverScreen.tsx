// ─────────────────────────────────────────────────────────────────────
// Wugi — DiscoverScreen
//
// Restyled to the Claude Design handoff visual language (token search,
// pill filters, card treatments, mono eyebrow kickers, FONTS.* type).
//
// Real-data-only: all editorial sections from the design are dropped
// (no Firestore backing exists for Neighborhood Guides, Photographer
// Features, Just Opened, Weekend Itineraries, Vibe Deep-Dives).
// What ships:
//   • Styled search bar + map toggle (header)
//   • Sticky filter bar — category pills + vibe pills
//   • Results count eyebrow + list/grid toggle
//   • List view — full-bleed image card with tag chip + type badge
//   • Grid view — 2-col cards with overlay tag
//   • Empty state
//   • Pull-to-refresh
//   • Recent searches dropdown (kept from existing screen)
//   • Firestore fetch → mock fallback (unchanged logic)
//
// DROPPED vs design (no backing data):
//   • Neighborhood guide shelf (editorial — no Firestore collection)
//   • Photographer feature shelf (Lens/galleries editorial — no data)
//   • "Just opened" shelf (editorial — no openedAt date field in venues)
//   • Weekend itineraries shelf (editorial — no itineraries collection)
//   • Vibe deep-dive ranked shelf (editorial — no rankings collection)
//   • Full-bleed map with clustered pins (out-of-scope per instructions)
//   • Token-dimension search overlay (design uses suggestion vocabulary
//     with backend facets not yet wired; real TextInput search kept instead)
//
// Type: FONTS.display titles, FONTS.medium buttons/pills, FONTS.body body.
//       Eyebrow kickers via MONO (system mono). No explicit fontWeight
//       when a named FONTS.* family is set.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, FlatList,
  SafeAreaView, TextInput, Dimensions, ActivityIndicator,
  StyleSheet, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Circle } from 'react-native-svg';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, FSEvent, FSVenue } from '../types';
import { EVENTS, VENUES, makeGallery } from '../constants/mockData';
import { FONTS, MONO } from '../constants/fonts';
import { SearchIcon, ChevronRightIcon } from '../components/icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Converters ────────────────────────────────────────────────────────
function toEventData(e: FSEvent): EventData {
  return {
    id: e.id, title: e.title, venue: e.venue, venueId: e.venueId,
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
  | { kind: 'deal';  title: string; venueName: string; detail: string; image: string };

const CATEGORIES = ['All', 'Events', 'Venues', 'Deals'];

// Design vibe vocabulary with per-vibe accent colors.
const DISCOVER_VIBES = [
  { label: 'Boujee',      accent: '#9b59b6' },
  { label: 'Divey',       accent: '#e67e22' },
  { label: 'Speakeasy',   accent: '#95a5a6' },
  { label: 'High Energy', accent: '#e74c3c' },
  { label: 'Rooftop',     accent: '#3498db' },
  { label: 'Late Night',  accent: '#2980b9' },
];

// Design content-type tag colors (warm-toned — matches design token palette).
const TAG_COLORS = {
  event: '#5fa080',
  venue: '#5ba8c4',
  deal:  '#a8533f',
};

const getItemName = (item: DiscoverItem) => {
  if (item.kind === 'event') return item.data.title ?? '';
  if (item.kind === 'venue') return item.data.name ?? '';
  return item.title ?? '';
};
const getItemSub = (item: DiscoverItem) => {
  if (item.kind === 'event') return `${item.data.venue ?? ''} · ${item.data.date ?? ''}`;
  if (item.kind === 'venue') return item.data.category ?? '';
  return item.venueName ?? '';
};
const getItemTag = (item: DiscoverItem): { label: string; color: string } => {
  if (item.kind === 'event') return { label: 'EVENT',  color: TAG_COLORS.event };
  if (item.kind === 'venue') return { label: 'VENUE',  color: TAG_COLORS.venue };
  return                            { label: 'DEAL',   color: TAG_COLORS.deal  };
};
const getItemImage = (item: DiscoverItem) => item.image;

// ── Map icon (inline — not in icons/index.tsx) ────────────────────────
function MapIcon({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 9m0 8V9m0 0L9 7"
        stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      />
    </Svg>
  );
}

// Grid/List toggle icons (inline — kept from existing screen's inline Svg blocks)
function GridIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}
function ListIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke={color} strokeWidth={1.8} strokeLinecap="round"/>
    </Svg>
  );
}

// ── Props ─────────────────────────────────────────────────────────────
type Props = {
  theme: Theme;
  onEventPress: (event: EventData) => void;
  onVenuePress: (venue: VenueData) => void;
};

// ── Main screen ───────────────────────────────────────────────────────
export function DiscoverScreen({ theme, onEventPress, onVenuePress }: Props) {
  const [search,         setSearch]         = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeVibe,     setActiveVibe]     = useState<string | null>(null);
  const [viewMode,       setViewMode]       = useState<'list' | 'grid'>('list');
  const [showMap,        setShowMap]        = useState(false);
  const [allResults,     setAllResults]     = useState<DiscoverItem[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [searchFocused,  setSearchFocused]  = useState(false);

  const RECENT_KEY = 'wugi_recent_searches';
  const MAX_RECENT = 8;

  // Load recent searches on mount
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
  const loadData = async () => {
    try {
      const { getApprovedEvents, getApprovedVenues, getActiveDeals } =
        await import('../../firestoreService');

      const [liveEvents, liveVenues, liveDeals] = await Promise.all([
        getApprovedEvents([], 100),
        getApprovedVenues([], 100),
        getActiveDeals([], 10),
      ]);

      const results: DiscoverItem[] = [];

      const events = liveEvents.length > 0 ? liveEvents : EVENTS.map(e => ({
        id: e.id, title: e.title, venue: e.venue, venueId: '',
        date: e.date, time: e.time, age: e.age, about: e.about,
        vibes: ['Boujee'], media: e.media || [], status: 'approved', createdAt: null,
      }));

      const venues = liveVenues.length > 0 ? liveVenues : VENUES.map(v => ({
        id: v.id, name: v.name, category: v.category, address: v.address,
        phone: v.phone, website: v.website, instagram: v.instagram,
        attributes: v.attributes || [], vibes: ['Boujee'], about: v.about,
        media: v.media || [], status: 'approved', createdAt: null,
      }));

      events.forEach(e => results.push({
        kind: 'event',
        data: toEventData(e),
        image: (e.media || [])[0]?.uri || `https://picsum.photos/seed/${e.id}/400/400`,
      }));

      venues.forEach(v => results.push({
        kind: 'venue',
        data: toVenueData(v),
        image: (() => {
          const first = (v.media || [])[0] as any;
          if (!first) return `https://picsum.photos/seed/${v.id}/400/400`;
          if (typeof first === 'string') return first;
          return first?.uri || `https://picsum.photos/seed/${v.id}/400/400`;
        })(),
      }));

      liveDeals.forEach(d => results.push({
        kind: 'deal',
        title: d.title,
        venueName: d.venueName,
        detail: d.detail,
        image: d.image || `https://picsum.photos/seed/${d.id}/400/400`,
      }));

      setAllResults(results);
    } catch (e) {
      console.log('DiscoverScreen: fetch failed, using mock', e);
      const results: DiscoverItem[] = [];
      EVENTS.forEach(ev => results.push({ kind: 'event', data: ev, image: (ev.media || [])[0]?.uri || 'https://picsum.photos/seed/ev/400/400' }));
      VENUES.forEach(v  => results.push({ kind: 'venue', data: v,  image: (v.media  || [])[0]?.uri || 'https://picsum.photos/seed/vn/400/400' }));
      setAllResults(results);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await loadData();
      if (!cancelled) setLoading(false);
    };
    const timeout = setTimeout(() => { if (!cancelled) setLoading(false); }, 8000);
    run();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // ── Filter ────────────────────────────────────────────────────────
  const filtered = allResults.filter(item => {
    const matchCat =
      activeCategory === 'All' ||
      (activeCategory === 'Events' && item.kind === 'event') ||
      (activeCategory === 'Venues' && item.kind === 'venue') ||
      (activeCategory === 'Deals'  && item.kind === 'deal');

    const name = getItemName(item).toLowerCase();
    const sub  = getItemSub(item).toLowerCase();
    const matchSearch = search === '' || name.includes(search.toLowerCase()) || sub.includes(search.toLowerCase());

    const matchVibe = !activeVibe || (() => {
      if (item.kind === 'event') return item.data.about?.toLowerCase().includes(activeVibe.toLowerCase());
      if (item.kind === 'venue') return (
        item.data.attributes?.some(a => a.toLowerCase().includes(activeVibe.toLowerCase())) ||
        item.data.category?.toLowerCase().includes(activeVibe.toLowerCase()) ||
        (item.data.vibes as string[] | undefined)?.some(vb => vb.toLowerCase() === activeVibe.toLowerCase())
      );
      return true;
    })();

    return matchCat && matchSearch && matchVibe;
  });

  const handleItemPress = (item: DiscoverItem) => {
    if (item.kind === 'event') onEventPress(item.data);
    else if (item.kind === 'venue') onVenuePress(item.data);
  };

  const COL_WIDTH = (SCREEN_WIDTH - 48) / 2;

  // ── List row card — design language ──────────────────────────────
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
        {/* Image */}
        <Image
          cachePolicy="memory-disk"
          source={{ uri: getItemImage(item) }}
          style={{ width: 88, height: 88 }}
          contentFit="cover"
        />
        {/* Body */}
        <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10 }}>
          {/* Tag chip — design: bg tinted, mono lettering */}
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

  // ── Grid card — design language ───────────────────────────────────
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
        {/* Cover image */}
        <View style={{ position: 'relative', width: COL_WIDTH, height: COL_WIDTH }}>
          <Image cachePolicy="memory-disk" source={{ uri: getItemImage(item) }} style={{ width: COL_WIDTH, height: COL_WIDTH }} contentFit="cover"/>
          {/* Soft bottom scrim */}
          <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' }}/>
          {/* Tag badge top-left — design: solid color */}
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
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} size="large"/>
        <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, marginTop: 12 }}>
          Loading…
        </Text>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>

      {/* ── Header — design: "Discover" bold title + search bar + map toggle */}
      <SafeAreaView style={{ backgroundColor: theme.bg, borderBottomWidth: 1, borderBottomColor: theme.divider, paddingBottom: 12 }}>
        {/* Title row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 }}>
          <Text style={{ color: theme.text, fontSize: 22, fontFamily: FONTS.display, letterSpacing: -0.7 }}>
            Discover
          </Text>
          {/* Map toggle — design: small button with Map icon + label */}
          <TouchableOpacity
            onPress={() => setShowMap(v => !v)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              paddingHorizontal: 12, paddingVertical: 6,
              backgroundColor: showMap ? theme.accent : theme.card,
              borderRadius: 8, borderWidth: 1,
              borderColor: showMap ? theme.accent : theme.border,
            }}
            activeOpacity={0.85}
          >
            <MapIcon color={showMap ? theme.onAccent : theme.subtext} size={13}/>
            <Text style={{ color: showMap ? theme.onAccent : theme.text, fontSize: 11, fontFamily: FONTS.medium }}>
              Map
            </Text>
          </TouchableOpacity>
        </View>

        {/* Search bar — design: card bg, accent border on focus, search icon */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, gap: 10 }}>
          <View style={{
            flex: 1, flexDirection: 'row', alignItems: 'center',
            backgroundColor: theme.card,
            borderRadius: 12, borderWidth: searchFocused ? 1.5 : 1,
            borderColor: searchFocused ? theme.accent : theme.border,
            paddingHorizontal: 12, paddingVertical: 10, gap: 8,
            ...(searchFocused ? { shadowColor: theme.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.08, shadowRadius: 4 } : {}),
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
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M18 6L6 18M6 6l12 12" stroke={theme.subtext} strokeWidth={2} strokeLinecap="round"/>
                </Svg>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Recent searches dropdown */}
        {searchFocused && search.length === 0 && recentSearches.length > 0 && (
          <View style={{
            marginHorizontal: 16, marginTop: 6,
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
                  <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                    <Path d="M18 6L6 18M6 6l12 12" stroke={theme.subtext} strokeWidth={2} strokeLinecap="round"/>
                  </Svg>
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </SafeAreaView>

      {/* ── Main scroll — sticky filter bar + results ─────────────────── */}
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

        {/* ── Sticky filter bar — category + vibe pills ────────────────── */}
        <View style={{
          backgroundColor: theme.bg,
          paddingTop: 10, paddingBottom: 8,
          borderBottomWidth: 1, borderBottomColor: theme.divider,
        }}>
          {/* Category pills */}
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          >
            {CATEGORIES.map(cat => {
              const active = activeCategory === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  onPress={() => setActiveCategory(cat)}
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
                    color: active ? theme.onAccent : theme.subtext,
                    fontSize: 13, fontFamily: FONTS.medium,
                  }}>
                    {cat}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Vibe pills */}
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginTop: 8 }}
          >
            {DISCOVER_VIBES.map(vibe => {
              const active = activeVibe === vibe.label;
              return (
                <TouchableOpacity
                  key={vibe.label}
                  onPress={() => setActiveVibe(active ? null : vibe.label)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 5,
                    paddingHorizontal: 12, paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: active ? vibe.accent : theme.card,
                    borderWidth: 1,
                    borderColor: active ? vibe.accent : theme.border,
                  }}
                  activeOpacity={0.8}
                >
                  {/* Color dot */}
                  <View style={{
                    width: 6, height: 6, borderRadius: 3,
                    backgroundColor: active ? '#fff' : vibe.accent,
                  }}/>
                  <Text style={{
                    color: active ? '#fff' : theme.subtext,
                    fontSize: 12, fontFamily: FONTS.medium,
                  }}>
                    {vibe.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Results header — mono count eyebrow + list/grid toggle ─────── */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
        }}>
          <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.4 }}>
            {filtered.length} {activeCategory !== 'All' ? activeCategory.toUpperCase() : 'RESULT'}{filtered.length !== 1 ? 'S' : ''}{activeVibe ? ` · ${activeVibe.toUpperCase()}` : ''}
          </Text>
          {!showMap && (
            <TouchableOpacity
              onPress={() => setViewMode(v => v === 'list' ? 'grid' : 'list')}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: 12, paddingVertical: 6,
                borderRadius: 10, backgroundColor: theme.card,
                borderWidth: 1, borderColor: theme.border,
              }}
              activeOpacity={0.8}
            >
              {viewMode === 'list'
                ? <GridIcon color={theme.subtext}/>
                : <ListIcon color={theme.subtext}/>
              }
              <Text style={{ color: theme.subtext, fontSize: 12, fontFamily: FONTS.medium }}>
                {viewMode === 'list' ? 'Grid' : 'List'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Results ──────────────────────────────────────────────────── */}
        {showMap ? (
          /* Non-functional map placeholder — map toggle exists, full clustered
             map is out-of-scope per instructions. Shows a styled placeholder
             card that communicates the intent without fabricating functionality. */
          <View style={{ marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', height: 260, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}>
            <MapIcon color={theme.subtext} size={32}/>
            <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, marginTop: 10 }}>
              Map view coming soon
            </Text>
          </View>
        ) : viewMode === 'list' ? (
          <View style={{ paddingHorizontal: 16 }}>
            {filtered.length === 0 ? (
              <View style={{ alignItems: 'center', paddingTop: 60, paddingBottom: 40 }}>
                <Text style={{ color: theme.subtext, fontSize: 32, marginBottom: 12 }}>—</Text>
                <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, marginBottom: 6 }}>
                  No results found
                </Text>
                <Text style={{ color: theme.subtext, fontSize: 14, fontFamily: FONTS.body, textAlign: 'center' }}>
                  Try a different search or filter
                </Text>
              </View>
            ) : (
              filtered.map((item, i) => renderListItem(item, i))
            )}
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            {filtered.length === 0 ? (
              <View style={{ width: '100%', alignItems: 'center', paddingTop: 60, paddingBottom: 40 }}>
                <Text style={{ color: theme.subtext, fontSize: 32, marginBottom: 12 }}>—</Text>
                <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, marginBottom: 6 }}>
                  No results found
                </Text>
                <Text style={{ color: theme.subtext, fontSize: 14, fontFamily: FONTS.body, textAlign: 'center' }}>
                  Try a different search or filter
                </Text>
              </View>
            ) : (
              filtered.map((item, i) => renderGridItem(item, i))
            )}
          </View>
        )}

        <View style={{ height: 40 }}/>
      </ScrollView>
    </View>
  );
}
