// ─────────────────────────────────────────────────────────────────────
// Wugi — DiscoverEditorialScreen   (persistent shell + inline search)
//
// Design source: ui_kits/consumer-app/DiscoverScreen.jsx +
// design_handoff_discover_itinerary/README.md.
//
// The new model: a single persistent header shell never unmounts. Tapping
// the search bar flips an internal `searchActive` flag and the BODY swaps
// between editorial shelves and a search view — no screen navigation. The
// existing src/screens/DiscoverScreen.tsx is no longer routed to via search;
// it's preserved as the map-mode destination (map button still pushes it
// with initialMapOn:true).
//
// Search-active header:
//   • Title row collapses; back-arrow appears left of the input.
//   • Search input gains focus glow (1.5px accent border + soft accent shadow).
//   • Map button hides — search owns the row.
//
// Search body (grid-first):
//   • Sticky filter bar with [Filters · N] button, active-filter chip strip,
//     and grid/list view toggle.
//   • Result count line ("N RESULTS · QUERY").
//   • Grid (default) or list cards over real Firestore data
//     (getApprovedEvents + getApprovedVenues + getActiveDeals
//      + getApprovedGalleries; Menus deferred — see TYPE_MENUS_TODO below).
//
// Filter sheet (RN Modal slide-up; no new native deps):
//   • Three categorized multi-select dimensions — Type / Vibe / Amenities.
//   • Draft pattern: edits stage to a draft copy; Apply commits, Cancel/scrim
//     discards. "Clear all" empties the draft.
//
// BATCH 6 — Type filter expansion + Vibe/Amenities taxonomy moved to Firestore.
//   • Type filter now includes Events / Venues / Deals / Galleries / Menus.
//     Menus is a no-op placeholder pending a collectionGroup('menu') index
//     and an `approved` flag on menu-item docs (see TYPE_MENUS_TODO).
//   • Vibe + Amenities pulled from filters/{vibes,amenities} Firestore docs
//     on first search-bar tap; the hardcoded FALLBACK_VIBES / FALLBACK_AMENITIES
//     arrays below stay in sync with scripts/scrape/03-transform-and-write.js
//     VIBES and VenueScreen AMENITY_ICON, and are used if the Firestore read
//     fails so the filter sheet remains usable offline.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  Dimensions, ActivityIndicator, StyleSheet, FlatList, Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../constants/colors';
import type {
  EventData, VenueData, GalleryData, FSEvent, FSVenue, GalleryDoc,
  EditorialShelf, EditorialCard,
} from '../types';
import { FONTS, MONO } from '../constants/fonts';
import { SearchIcon } from '../components/icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Filter taxonomy ────────────────────────────────────────────────────
// Three multi-select dimensions per the handoff. Type is hardcoded (app
// structure — Events / Venues / Deals / Galleries / Menus); Vibe + Amenities
// are pulled from filters/{vibes,amenities} Firestore docs at runtime with
// the fallback arrays below standing in if the read fails.
//
// TYPE_MENUS_TODO — "Menus" is shown in the filter UI but emits no results
// today. Cross-venue menu search would require a `collectionGroup('menu')`
// query against the `venues/{venueId}/menu` subcollection. That needs an
// `approved` flag on menu-item docs + a composite index in
// firebase/firestore.indexes.json: { approved ASC, name ASC, queryScope:
// COLLECTION_GROUP } + an explicit `match /{path=**}/menu/{id}` rule in
// firestore.rules. None of those exist today, and the workflow directive
// flags such index additions as out-of-scope. When that infra lands, wire
// `getMenuItemsByName(q)` into ensureSearchData and emit kind:'menu' rows.
const FILTER_DIMS = ['Type', 'Vibe', 'Amenities'] as const;
type FilterDim = typeof FILTER_DIMS[number];
const TYPE_OPTIONS = ['Events', 'Venues', 'Deals', 'Galleries', 'Menus'] as const;
type TypeOption = typeof TYPE_OPTIONS[number];

// Fallback values kept in lockstep with the canonical sources:
//   • FALLBACK_VIBES     — scripts/scrape/03-transform-and-write.js VIBES (16 values).
//   • FALLBACK_AMENITIES — union of VenueScreen AMENITY_ICON keys + Discover
//                          search filters, deduped. "Patio" canonicalized
//                          (was "Outdoor Patio" — never matched the icon map).
const FALLBACK_VIBES: string[] = [
  'Boujee', 'Divey', 'Speakeasy', 'High Energy', 'Rooftop', 'Late Night',
  'Chill', 'Dance', 'Live Music', 'Date Night', 'Sports', 'Brunch',
  'Cultural', 'Hookah', 'Lounge', 'Adult',
];
const FALLBACK_AMENITIES: string[] = [
  'Rooftop', 'Bottle Service', 'Dress Code', 'Open Late', 'Reservations',
  'Patio', 'Live Music', 'Hookah', 'Brunch', 'Happy Hour', 'Pet Friendly',
];
const FALLBACK_FILTERS: Record<FilterDim, string[]> = {
  Type:      [...TYPE_OPTIONS],
  Vibe:      FALLBACK_VIBES,
  Amenities: FALLBACK_AMENITIES,
};
const DIM_ACCENT: Record<FilterDim, string> = { Type: '#5fa080', Vibe: '#9b59b6', Amenities: '#5ba8c4' };
type SearchKind = 'event' | 'venue' | 'deal' | 'gallery' | 'menu';
const TYPE_COLOR: Record<SearchKind, string> = {
  event:   '#5fa080',
  venue:   '#5ba8c4',
  deal:    '#a8533f',
  gallery: '#9b59b6',
  menu:    '#c4a35b',
};
type Picked = Record<FilterDim, string[]>;
const EMPTY_PICKS: Picked = { Type: [], Vibe: [], Amenities: [] };

type Props = {
  theme: Theme;
  onMapTap: () => void;
  onEventPress: (event: EventData) => void;
  onVenuePress: (venue: VenueData) => void;
  onGalleryPress: (gallery: GalleryData) => void;
  onItineraryPress: (itineraryId: string) => void;
};

// ── FS → navigation-payload converters (match DiscoverScreen) ──────────
function toEventData(e: FSEvent): EventData {
  return {
    id: e.id, title: e.title, venue: e.venue, venueId: e.venueId,
    date: e.date, time: e.time, age: e.age, about: e.about || '',
    media: e.media || [],
    hasTickets: (e as any).hasTickets === true,
    gallery: { id: e.id, title: e.title, venue: e.venue, date: e.date, coverImage: '', photos: [] },
  } as EventData;
}
function toVenueData(v: FSVenue): VenueData {
  return {
    id: v.id, name: v.name, category: v.category || '',
    address: v.address || '', phone: v.phone || '',
    logoUrl: (v as any).logoUrl || '',
    website: v.website || '', instagram: v.instagram || '',
    attributes: v.attributes || [], about: v.about || '',
    media: (v.media || []).map(m => typeof m === 'string' ? { type: 'image', uri: m } : m),
    menuDescription: v.about || '', menuAttributes: v.attributes || [],
    bestSellers: [], upcomingEvents: [], galleries: [],
    shortDescription: v.shortDescription, neighborhood: v.neighborhood,
    priceTier: v.priceTier, rating: v.rating, age: v.age,
    dressCode: v.dressCode, hoursText: v.hoursText,
    openStatusHint: v.openStatusHint, amenities: v.amenities, vibes: v.vibes,
    reservationProvider: v.reservationProvider, reservationUrl: v.reservationUrl,
    reservationUrlWithDefaults: v.reservationUrlWithDefaults,
    ctaPrimary: v.ctaPrimary, ctaSecondary: v.ctaSecondary,
  } as VenueData;
}
function galleryDocToData(g: GalleryDoc): GalleryData {
  const images = (g.images || []).filter(Boolean);
  return {
    id: g.id, title: g.title, venue: g.photographerName || '',
    date: g.date || '', coverImage: g.coverImage || images[0] || '',
    photos: (images.length > 0 ? images : [g.coverImage].filter(Boolean))
      .map((uri, i) => ({ id: `${g.id}-${i}`, uri, height: 300 })),
  };
}

// ── Header inline icons ────────────────────────────────────────────────
function MapIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M9 3L3 6v15l6-3 6 3 6-3V3l-6 3-6-3zM9 3v15M15 6v15"
        stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}
function BackArrow({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M15 18l-6-6 6-6" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}
function CloseX({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M18 6L6 18M6 6l12 12" stroke={color} strokeWidth={2.2} strokeLinecap="round"/>
    </Svg>
  );
}
function FilterIcon({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path d="M3 5h18M6 12h12M10 19h4" stroke={color} strokeWidth={2} strokeLinecap="round"/>
    </Svg>
  );
}
function GridIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}
function ListIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M3 6h18M3 12h18M3 18h18" stroke={color} strokeWidth={1.8} strokeLinecap="round"/>
    </Svg>
  );
}

// ── Persistent header shell ────────────────────────────────────────────
function DiscoverHeader({
  theme, searchActive, searchValue, onSearchValueChange, onActivate, onCancel, onMapTap,
}: {
  theme: Theme;
  searchActive: boolean;
  searchValue: string;
  onSearchValueChange: (s: string) => void;
  onActivate: () => void;
  onCancel: () => void;
  onMapTap: () => void;
}) {
  return (
    <View style={{ backgroundColor: theme.bg, paddingTop: 60, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
      {!searchActive && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ color: theme.text, fontSize: 22, fontFamily: FONTS.display, letterSpacing: -0.7 }}>Discover</Text>
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {searchActive && (
          <TouchableOpacity onPress={onCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ width: 28, alignItems: 'flex-start' }}>
            <BackArrow color={theme.text}/>
          </TouchableOpacity>
        )}
        {/* The input — pressable shell when inactive, real TextInput when active. */}
        {searchActive ? (
          <View style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
            backgroundColor: theme.card, borderRadius: 12,
            borderWidth: 1.5, borderColor: theme.accent,
            paddingHorizontal: 14, paddingVertical: 9,
            shadowColor: theme.accent, shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.08, shadowRadius: 4,
          }}>
            <SearchIcon color={theme.accent}/>
            <TextInput
              value={searchValue}
              onChangeText={onSearchValueChange}
              placeholder="Search venues, events, vibes…"
              placeholderTextColor={theme.subtext}
              autoFocus
              returnKeyType="search"
              style={{ flex: 1, color: theme.text, fontSize: 14, fontFamily: FONTS.body, padding: 0 }}
            />
            {searchValue.length > 0 && (
              <TouchableOpacity onPress={() => onSearchValueChange('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <CloseX color={theme.subtext} size={14}/>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <TouchableOpacity
            onPress={onActivate} activeOpacity={0.85}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
              backgroundColor: theme.card, borderRadius: 12,
              borderWidth: 1, borderColor: theme.border,
              paddingHorizontal: 14, paddingVertical: 11,
            }}
          >
            <SearchIcon color={theme.subtext}/>
            <Text style={{ flex: 1, color: theme.subtext, fontSize: 14, fontFamily: FONTS.body }}>Search venues, events, vibes…</Text>
          </TouchableOpacity>
        )}
        {/* Map button — editorial state only (search owns the row). */}
        {!searchActive && (
          <TouchableOpacity
            onPress={onMapTap} activeOpacity={0.85}
            style={{
              width: 44, height: 44, borderRadius: 12,
              backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <MapIcon color={theme.subtext}/>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── Shelf card (editorial mode) ────────────────────────────────────────
// Gallery-kind cards render a 3-line footer (venue / date / title) matching
// the PhotoViewer info-overlay typography hierarchy. Venue + date are read
// from the embedded card payload when present (seed-photographer-features.ts
// now denormalizes them); for older docs we fall back to a hydrated
// venueId → name map populated by the parent screen. Other kinds keep the
// legacy 2-line title + sub footer. Item 4.1.
function ShelfCard({ card, theme, onPress, venueNameFallback, dateFallback }: {
  card: EditorialCard;
  theme: Theme;
  onPress: () => void;
  venueNameFallback?: string;
  dateFallback?: string;
}) {
  const width = Math.round(200 * (card.ratio ?? 1));
  // 'photographer' is the only kind with no navigation target.
  const navigates = card.kind !== 'photographer';
  // Denormalized fields the seed writes onto gallery-kind cards but which
  // aren't on the EditorialCard type today (src/types/index.ts is frozen
  // for this batch). Cast through `any` rather than widening the type.
  const cardAny = card as EditorialCard & { venueName?: string; date?: string };
  const isGallery = card.kind === 'gallery';
  const venueLine = isGallery ? (cardAny.venueName || venueNameFallback || '') : '';
  const dateLine  = isGallery ? (cardAny.date || dateFallback || '') : '';
  return (
    <TouchableOpacity
      activeOpacity={navigates ? 0.9 : 1}
      onPress={navigates ? onPress : undefined}
      style={{ width, height: 240, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.card }}
    >
      {!!card.image && (
        <Image source={{ uri: card.image }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="memory-disk"/>
      )}
      <LinearGradient
        colors={['rgba(0,0,0,0.3)', 'transparent', 'rgba(0,0,0,0.92)']}
        locations={[0, 0.3, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={{ position: 'absolute', top: 10, left: 10, backgroundColor: card.tagColor, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4 }}>
        <Text style={{ color: '#f4efe1', fontSize: 9, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.5 }}>{card.tag}</Text>
      </View>
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 14 }}>
        {isGallery ? (
          // Event / Venue / Date — matches the PhotoViewer info overlay
          // stack. `card.title` is the event-named gallery title.
          <>
            <Text numberOfLines={2} style={{ color: '#f4efe1', fontSize: 15, fontFamily: FONTS.display, letterSpacing: -0.3, lineHeight: 18, marginBottom: 3 }}>
              {card.title}
            </Text>
            {!!venueLine && (
              <Text numberOfLines={1} style={{ color: 'rgba(244,239,225,0.7)', fontSize: 11, fontFamily: FONTS.body, marginBottom: 1 }}>
                {venueLine}
              </Text>
            )}
            {!!dateLine && (
              <Text numberOfLines={1} style={{ color: theme.accent, fontSize: 11, fontFamily: FONTS.body }}>
                {dateLine}
              </Text>
            )}
          </>
        ) : (
          <>
            <Text numberOfLines={2} style={{ color: '#f4efe1', fontSize: 15, fontFamily: FONTS.display, letterSpacing: -0.3, marginBottom: 2, lineHeight: 18 }}>{card.title}</Text>
            <Text numberOfLines={1} style={{ color: 'rgba(244,239,225,0.65)', fontSize: 11, fontFamily: FONTS.body }}>{card.sub}</Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

function Shelf({ kicker, title, subtitle, cards, theme, onCardPress, venueNameById, galleryFallback }: {
  kicker: string; title: string; subtitle?: string; cards: EditorialCard[];
  theme: Theme; onCardPress: (c: EditorialCard) => void;
  venueNameById: Record<string, string>;
  galleryFallback: Record<string, { venueName: string; date: string }>;
}) {
  return (
    <View>
      <View style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 10 }}>
        <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 }}>{kicker}</Text>
        <Text style={{ color: theme.text, fontSize: 22, fontFamily: FONTS.display, letterSpacing: -0.6, marginBottom: 2 }}>{title}</Text>
        {!!subtitle && <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body }}>{subtitle}</Text>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: 18 }}>
        {cards.map((c, i) => {
          // Venue-name fallback resolves in this order:
          //   1) venueId on the card (modern seed) → venueNameById lookup
          //   2) galleryId on the card (legacy seed, no venueId) →
          //      galleryFallback lookup populated from gallery→venue join
          const galleryEntry = c.kind === 'gallery' && c.galleryId ? galleryFallback[c.galleryId] : undefined;
          const venueFallback =
            (c.venueId && venueNameById[c.venueId]) ||
            galleryEntry?.venueName ||
            undefined;
          const dateFallback = galleryEntry?.date || undefined;
          return (
            <ShelfCard
              key={`${c.kind}-${i}`}
              card={c}
              theme={theme}
              onPress={() => onCardPress(c)}
              venueNameFallback={venueFallback || undefined}
              dateFallback={dateFallback}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Editorial body (existing shelf experience) ─────────────────────────
function EditorialBody({ shelves, loading, theme, onCard, venueNameById, galleryFallback }: {
  shelves: EditorialShelf[]; loading: boolean; theme: Theme;
  onCard: (shelf: EditorialShelf, c: EditorialCard) => void;
  venueNameById: Record<string, string>;
  galleryFallback: Record<string, { venueName: string; date: string }>;
}) {
  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {loading ? (
        <View style={{ paddingTop: 80, alignItems: 'center' }}>
          <ActivityIndicator color={theme.accent} size="large"/>
        </View>
      ) : shelves.length === 0 ? (
        <View style={{ paddingTop: 80, paddingHorizontal: 32, alignItems: 'center' }}>
          <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.display, letterSpacing: -0.2, marginBottom: 6, textAlign: 'center' }}>
            No guides yet
          </Text>
          <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, textAlign: 'center', opacity: 0.7 }}>
            Tap the search bar to explore venues, events, and vibes.
          </Text>
        </View>
      ) : (
        <>
          {shelves.map(shelf => (
            <Shelf
              key={`${shelf.type}-${shelf.doc.id}`}
              kicker={shelf.doc.kicker}
              title={shelf.doc.title}
              subtitle={shelf.doc.subtitle}
              cards={shelf.doc.cards || []}
              theme={theme}
              onCardPress={(c) => onCard(shelf, c)}
              venueNameById={venueNameById}
              galleryFallback={galleryFallback}
            />
          ))}
          <View style={{ height: 40 }}/>
        </>
      )}
    </ScrollView>
  );
}

// ── Filter sheet (RN Modal slide-up; draft pattern) ─────────────────────
function FilterSheet({
  visible, theme, picked, filterValues, onApply, onClose,
}: {
  visible: boolean; theme: Theme; picked: Picked;
  filterValues: Record<FilterDim, string[]>;
  onApply: (next: Picked) => void; onClose: () => void;
}) {
  // Draft state — discarded on close, committed on Apply.
  const [draft, setDraft] = useState<Picked>(picked);
  useEffect(() => { if (visible) setDraft(picked); }, [visible, picked]);

  const total = draft.Type.length + draft.Vibe.length + draft.Amenities.length;

  const toggle = (dim: FilterDim, opt: string) => {
    setDraft(d => {
      const cur = d[dim];
      const next = cur.includes(opt) ? cur.filter(o => o !== opt) : [...cur, opt];
      return { ...d, [dim]: next };
    });
  };
  const clearAll = () => setDraft(EMPTY_PICKS);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <TouchableWithoutFeedback onPress={() => { /* swallow inside the sheet */ }}>
            <View style={{
              marginTop: 'auto', maxHeight: '82%',
              backgroundColor: theme.bg,
              borderTopLeftRadius: 24, borderTopRightRadius: 24,
              borderTopWidth: 1, borderTopColor: theme.border,
            }}>
              {/* Grabber */}
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border }}/>
              </View>
              {/* Header: title + Clear all */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
                <Text style={{ color: theme.text, fontSize: 18, fontFamily: FONTS.display, letterSpacing: -0.4 }}>Filters</Text>
                <TouchableOpacity onPress={clearAll} disabled={total === 0}>
                  <Text style={{ color: total > 0 ? theme.accent : theme.subtext, fontSize: 13, fontFamily: FONTS.medium }}>Clear all</Text>
                </TouchableOpacity>
              </View>
              {/* Body — categorized multi-select */}
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                {FILTER_DIMS.map(dim => (
                  <View key={dim} style={{ paddingTop: 18 }}>
                    <Text style={{ color: DIM_ACCENT[dim], fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 10 }}>
                      {dim.toUpperCase()}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {filterValues[dim].map(opt => {
                        const on = draft[dim].includes(opt);
                        return (
                          <TouchableOpacity
                            key={opt}
                            onPress={() => toggle(dim, opt)}
                            activeOpacity={0.8}
                            style={{
                              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
                              backgroundColor: on ? `${DIM_ACCENT[dim]}22` : theme.card,
                              borderWidth: 1.5, borderColor: on ? DIM_ACCENT[dim] : theme.border,
                              flexDirection: 'row', alignItems: 'center', gap: 6,
                            }}
                          >
                            {on && <Text style={{ color: DIM_ACCENT[dim], fontSize: 12, lineHeight: 14 }}>✓</Text>}
                            <Text style={{ color: on ? DIM_ACCENT[dim] : theme.text, fontSize: 13, fontFamily: on ? FONTS.medium : FONTS.body, letterSpacing: -0.1 }}>
                              {opt}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))}
                <View style={{ height: 12 }}/>
              </ScrollView>
              {/* Apply CTA */}
              <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, borderTopWidth: 1, borderTopColor: theme.divider }}>
                <TouchableOpacity
                  onPress={() => onApply(draft)}
                  activeOpacity={0.9}
                  style={{
                    backgroundColor: theme.accent, borderRadius: 14,
                    paddingVertical: 16, alignItems: 'center',
                    shadowColor: theme.accent, shadowOpacity: 0.4,
                    shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 6,
                  }}
                >
                  <Text style={{ color: theme.onAccent, fontSize: 15, fontFamily: FONTS.display, letterSpacing: -0.1 }}>
                    {total > 0 ? `Show results · ${total} filter${total !== 1 ? 's' : ''}` : 'Show all results'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

// ── Search body (filter bar + results) ─────────────────────────────────
type SearchItem =
  | { kind: 'event';   data: FSEvent;  image: string }
  | { kind: 'venue';   data: FSVenue;  image: string }
  | { kind: 'deal';    id: string; title: string; venueName: string; detail: string; image: string }
  | { kind: 'gallery'; data: GalleryDoc; image: string };
// `menu` kind intentionally omitted from the union: see TYPE_MENUS_TODO at
// the top of this file. The "Menus" filter option renders an empty results
// state until the collectionGroup index lands.

function venueFirstImage(v: FSVenue): string {
  const m = (v.media || []) as any[];
  for (const x of m) {
    if (!x) continue;
    if (typeof x === 'string') return x;
    if (typeof x.uri === 'string') return x.uri;
  }
  return '';
}

type SearchDeal = { id: string; title: string; venueName: string; detail: string; image: string };

function SearchBody({
  theme, query, picked, onOpenFilters, onChipRemove, onEvent, onVenue, onGallery,
  events, venues, deals, galleries, loading,
}: {
  theme: Theme;
  query: string;
  picked: Picked;
  onOpenFilters: () => void;
  onChipRemove: (dim: FilterDim, opt: string) => void;
  onEvent: (e: FSEvent) => void;
  onVenue: (v: FSVenue) => void;
  onGallery: (g: GalleryDoc) => void;
  events: FSEvent[];
  venues: FSVenue[];
  deals: SearchDeal[];
  galleries: GalleryDoc[];
  loading: boolean;
}) {
  const [view,    setView]    = useState<'grid' | 'list'>('grid');   // grid-first

  // Active filter chips flattened for the bar.
  const activeChips = useMemo(() => {
    const out: { dim: FilterDim; opt: string }[] = [];
    FILTER_DIMS.forEach(dim => picked[dim].forEach(opt => out.push({ dim, opt })));
    return out;
  }, [picked]);
  const totalFilters = activeChips.length;

  // Build the filtered, unified result list.
  const results: SearchItem[] = useMemo(() => {
    const wantType = picked.Type;
    const wantVibe = picked.Vibe.map(v => v.toLowerCase());
    const wantAmen = picked.Amenities.map(a => a.toLowerCase());
    const q = query.trim().toLowerCase();

    const matchVibe = (vs: string[] | undefined) =>
      wantVibe.length === 0 || (vs || []).some(v => wantVibe.includes(v.toLowerCase()));
    const matchAmen = (as: string[] | undefined) =>
      wantAmen.length === 0 || (as || []).some(a => wantAmen.includes(a.toLowerCase()));
    const matchSearch = (name: string, sub: string) =>
      q === '' || name.toLowerCase().includes(q) || sub.toLowerCase().includes(q);

    // Galleries carry no vibes/amenities of their own — they inherit them
    // (and their venue name) from the parent venue. Index the loaded venues
    // by id so gallery rows can resolve venueName + venue vibes/amenities
    // without a per-card Firestore read.
    const venueById: Record<string, FSVenue> = {};
    venues.forEach(v => { if (v.id) venueById[v.id] = v; });

    const out: SearchItem[] = [];
    const includeKind = (k: TypeOption) => wantType.length === 0 || wantType.includes(k);

    if (includeKind('Events')) {
      events.forEach(e => {
        if (!matchVibe(e.vibes)) return;
        // Events have no amenities — if amenities are required, exclude them.
        if (wantAmen.length > 0) return;
        if (!matchSearch(e.title, `${e.venue} · ${e.date}`)) return;
        out.push({ kind: 'event', data: e, image: (e.media || [])[0]?.uri || '' });
      });
    }
    if (includeKind('Venues')) {
      venues.forEach(v => {
        if (!matchVibe(v.vibes)) return;
        if (!matchAmen(v.amenities)) return;
        if (!matchSearch(v.name, v.category || v.neighborhood || '')) return;
        out.push({ kind: 'venue', data: v, image: venueFirstImage(v) });
      });
    }
    if (includeKind('Deals')) {
      // Deals have no vibes/amenities — if either is required, exclude them.
      if (wantVibe.length === 0 && wantAmen.length === 0) {
        deals.forEach(d => {
          if (!matchSearch(d.title, d.venueName)) return;
          out.push({ kind: 'deal', id: d.id, title: d.title, venueName: d.venueName, detail: d.detail, image: d.image });
        });
      }
    }
    if (includeKind('Galleries')) {
      // Galleries inherit vibes/amenities from their parent venue, so an
      // active Vibe/Amenity filter no longer excludes them outright (the old
      // behavior). Query text matches on the gallery's (event-named) title
      // OR the venue name; vibe/amenity filters match against the venue's.
      galleries.forEach(g => {
        const v = g.venueId ? venueById[g.venueId] : undefined;
        const venueName = v?.name || '';
        if (!matchVibe(v?.vibes)) return;
        if (!matchAmen(v?.amenities)) return;
        if (!matchSearch(g.title, venueName)) return;
        const cover = g.coverImage || (g.images || []).find(Boolean) || '';
        out.push({ kind: 'gallery', data: g, image: cover });
      });
    }
    // 'Menus' includeKind('Menus') is intentionally a no-op — see TYPE_MENUS_TODO.
    return out;
  }, [query, picked, events, venues, deals, galleries]);

  const onItemTap = (item: SearchItem) => {
    if (item.kind === 'event') onEvent(item.data);
    else if (item.kind === 'venue') onVenue(item.data);
    else if (item.kind === 'gallery') onGallery(item.data);
    // deal cards non-navigating in v1 (no deal-detail screen).
  };

  const itemName = (item: SearchItem) =>
    item.kind === 'deal'    ? item.title
    : item.kind === 'event' ? item.data.title
    : item.kind === 'venue' ? item.data.name
    : /* gallery */           item.data.title;
  const itemSub = (item: SearchItem) =>
    item.kind === 'deal'    ? item.venueName
    : item.kind === 'event' ? `${item.data.venue} · ${item.data.date}`
    : item.kind === 'venue' ? (item.data.category || item.data.neighborhood || '')
    : /* gallery */           [item.data.photographerName, item.data.date].filter(Boolean).join(' · ');

  const renderGridCard = ({ item }: { item: SearchItem }) => {
    const name = itemName(item);
    const sub  = itemSub(item);
    const img  = item.image;
    const cardW = (SCREEN_WIDTH - 32 - 10) / 2;  // 16 gutter each side, 10 inter-column gap
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => onItemTap(item)}
        style={{ width: cardW, backgroundColor: theme.card, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}
      >
        <View style={{ width: cardW, height: cardW }}>
          {!!img && <Image source={{ uri: img }} style={{ width: cardW, height: cardW }} contentFit="cover" cachePolicy="memory-disk"/>}
          <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: TYPE_COLOR[item.kind], borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: '#f4efe1', fontSize: 9, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.6 }}>{item.kind.toUpperCase()}</Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 }}>
          <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.medium, letterSpacing: -0.1, marginBottom: 2 }}>{name}</Text>
          <Text numberOfLines={1} style={{ color: theme.subtext, fontSize: 11, fontFamily: FONTS.body }}>{sub}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderListCard = ({ item }: { item: SearchItem }) => {
    const name = itemName(item);
    const sub  = itemSub(item);
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => onItemTap(item)}
        style={{ flexDirection: 'row', backgroundColor: theme.card, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: theme.border, marginBottom: 10 }}
      >
        <Image source={{ uri: item.image }} style={{ width: 88, height: 88 }} contentFit="cover" cachePolicy="memory-disk"/>
        <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 12, gap: 4 }}>
          <View style={{ alignSelf: 'flex-start', backgroundColor: `${TYPE_COLOR[item.kind]}22`, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text style={{ color: TYPE_COLOR[item.kind], fontSize: 9, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.6 }}>{item.kind.toUpperCase()}</Text>
          </View>
          <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14, fontFamily: FONTS.medium, letterSpacing: -0.1 }}>{name}</Text>
          <Text numberOfLines={1} style={{ color: theme.subtext, fontSize: 12, fontFamily: FONTS.body }}>{sub}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const FilterBar = () => (
    <View style={{ backgroundColor: theme.bg, borderBottomWidth: 1, borderBottomColor: theme.divider, paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }}>
        <TouchableOpacity
          onPress={onOpenFilters} activeOpacity={0.85}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 7,
            paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999,
            backgroundColor: totalFilters > 0 ? theme.accent : theme.card,
            borderWidth: 1, borderColor: totalFilters > 0 ? theme.accent : theme.border,
          }}
        >
          <FilterIcon color={totalFilters > 0 ? theme.onAccent : theme.text}/>
          <Text style={{ color: totalFilters > 0 ? theme.onAccent : theme.text, fontSize: 13, fontFamily: FONTS.medium, letterSpacing: -0.1 }}>
            Filters{totalFilters > 0 ? ` · ${totalFilters}` : ''}
          </Text>
        </TouchableOpacity>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 6, alignItems: 'center' }}>
          {activeChips.length === 0 ? (
            <Text style={{ color: theme.subtext, fontSize: 12, fontFamily: FONTS.body }}>All venues & events</Text>
          ) : (
            activeChips.map(({ dim, opt }) => (
              <View key={`${dim}:${opt}`} style={{
                flexDirection: 'row', alignItems: 'center', gap: 5,
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
                backgroundColor: `${DIM_ACCENT[dim]}22`, borderWidth: 1, borderColor: `${DIM_ACCENT[dim]}66`,
              }}>
                <Text style={{ color: DIM_ACCENT[dim], fontSize: 12, fontFamily: FONTS.medium }}>{opt}</Text>
                <TouchableOpacity onPress={() => onChipRemove(dim, opt)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <CloseX color={DIM_ACCENT[dim]} size={12}/>
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
        <TouchableOpacity
          onPress={() => setView(v => v === 'grid' ? 'list' : 'grid')}
          activeOpacity={0.85}
          style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
        >
          {view === 'grid' ? <ListIcon color={theme.subtext}/> : <GridIcon color={theme.subtext}/>}
        </TouchableOpacity>
      </View>
    </View>
  );

  const ResultCount = () => (
    <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
      <Text style={{ color: theme.subtext, fontSize: 12, fontFamily: MONO, letterSpacing: 0.4 }}>
        {results.length} RESULT{results.length === 1 ? '' : 'S'}{query ? ` · "${query.toUpperCase()}"` : ''}
      </Text>
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <FilterBar/>
        <View style={{ paddingTop: 60, alignItems: 'center' }}>
          <ActivityIndicator color={theme.accent} size="large"/>
        </View>
      </View>
    );
  }

  return (
    <FlatList
      key={view}   // re-mount to apply numColumns change
      data={results}
      keyExtractor={(item, i) => `${item.kind}-${i}-${
        item.kind === 'deal' ? item.id
        : item.kind === 'event' ? item.data.id
        : item.kind === 'venue' ? item.data.id
        : /* gallery */ item.data.id
      }`}
      renderItem={view === 'grid' ? renderGridCard : renderListCard}
      numColumns={view === 'grid' ? 2 : 1}
      columnWrapperStyle={view === 'grid' ? { paddingHorizontal: 16, gap: 10, marginBottom: 10 } : undefined}
      contentContainerStyle={view === 'list' ? { paddingHorizontal: 16, paddingBottom: 24 } : { paddingBottom: 24 }}
      ListHeaderComponent={<><FilterBar/><ResultCount/></>}
      stickyHeaderIndices={[0]}
      ListEmptyComponent={
        // Menus-only filter shows a distinct empty state — search across menu
        // items isn't wired yet (see TYPE_MENUS_TODO at top of file).
        picked.Type.length === 1 && picked.Type[0] === 'Menus' ? (
          <View style={{ paddingTop: 60, paddingHorizontal: 32, alignItems: 'center' }}>
            <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.display, letterSpacing: -0.2, marginBottom: 6, textAlign: 'center' }}>Menu search coming soon</Text>
            <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, textAlign: 'center', opacity: 0.7 }}>We're wiring cross-venue menu search. Try a venue to see its menu.</Text>
          </View>
        ) : (
          <View style={{ paddingTop: 60, paddingHorizontal: 32, alignItems: 'center' }}>
            <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.display, letterSpacing: -0.2, marginBottom: 6, textAlign: 'center' }}>Nothing matches that</Text>
            <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, textAlign: 'center', opacity: 0.7 }}>Try a different search or fewer filters.</Text>
          </View>
        )
      }
      showsVerticalScrollIndicator={false}
    />
  );
}

// ── Top-level screen ────────────────────────────────────────────────────
export function DiscoverEditorialScreen({ theme, onMapTap, onEventPress, onVenuePress, onGalleryPress, onItineraryPress }: Props) {
  // Editorial-state data (always loaded, even when searching, so cancel is instant).
  const [shelves, setShelves] = useState<EditorialShelf[]>([]);
  const [editorialLoading, setEditorialLoading] = useState(true);

  // Gallery-card 3-line render fallback hydration. Two indices:
  //   • venueNameById   — venueId → venueName (used when card carries venueId
  //                       but not yet venueName).
  //   • galleryFallback — galleryId → { venueName, date } (used for LEGACY
  //                       gallery cards that have only galleryId).
  // Both are populated once when shelves load, ONLY for gallery cards missing
  // the denormalized fields (i.e. seeded before seed-photographer-features.ts
  // was re-run). After the seed re-runs the maps stay empty / unused. Item 4.1.
  const [venueNameById,   setVenueNameById]   = useState<Record<string, string>>({});
  const [galleryFallback, setGalleryFallback] = useState<Record<string, { venueName: string; date: string }>>({});

  // Inline-search state.
  const [searchActive, setSearchActive] = useState(false);
  const [searchValue, setSearchValue]   = useState('');
  const [picked,      setPicked]        = useState<Picked>(EMPTY_PICKS);
  const [sheetOpen,   setSheetOpen]     = useState(false);
  const navigatingRef = useRef(false);

  // Lifted search dataset — fetched lazily on first search-bar tap and kept
  // alive across SearchBody mount/unmount so re-opening the overlay paints
  // instantly instead of re-firing the Firestore queries every time.
  // Batch 6.1: added searchGalleries to the lifted set.
  const [searchEvents,    setSearchEvents]    = useState<FSEvent[]>([]);
  const [searchVenues,    setSearchVenues]    = useState<FSVenue[]>([]);
  const [searchDeals,     setSearchDeals]     = useState<SearchDeal[]>([]);
  const [searchGalleries, setSearchGalleries] = useState<GalleryDoc[]>([]);
  const [searchDataLoaded, setSearchDataLoaded] = useState(false);
  const searchLoadStartedRef = useRef(false);
  const searchUnmountedRef = useRef(false);

  // Filter taxonomy — Vibe + Amenities values pulled from filters/{name}
  // Firestore docs the first time search is opened. Falls back to the
  // canonical FALLBACK_VIBES / FALLBACK_AMENITIES so the sheet is usable
  // if the read fails. Cached for the screen's lifetime.
  const [filterValues, setFilterValues] = useState<Record<FilterDim, string[]>>(FALLBACK_FILTERS);
  const filterTaxonomyStartedRef = useRef(false);

  const ensureSearchData = () => {
    if (searchLoadStartedRef.current) return;
    searchLoadStartedRef.current = true;
    (async () => {
      try {
        const svc = await import('../../firestoreService');
        const [evs, vns, ds, gls] = await Promise.all([
          svc.getApprovedEvents([], 200),
          svc.getApprovedVenues([], 200),
          svc.getActiveDeals([], 50),
          svc.getApprovedGalleries(50),
        ]);
        if (searchUnmountedRef.current) return;
        setSearchEvents(evs);
        setSearchVenues(vns);
        setSearchDeals((ds as any[]).map(d => ({
          id: d.id, title: d.title, venueName: d.venueName, detail: d.detail, image: d.image || '',
        })));
        setSearchGalleries(gls);
        setSearchDataLoaded(true);
      } catch (e) {
        console.log('Discover search load failed', e);
        // Allow a retry on next tap if the first attempt failed.
        searchLoadStartedRef.current = false;
      }
    })();
  };

  // Filter taxonomy fetch runs in parallel with the search-data fetch. We
  // don't gate the search-data loaded flag on it — if the read is slow or
  // fails, the fallback values render and the sheet is still usable. Once
  // it resolves we splice in the resolved values without disturbing the
  // user's current `picked` selections.
  const ensureFilterTaxonomy = () => {
    if (filterTaxonomyStartedRef.current) return;
    filterTaxonomyStartedRef.current = true;
    (async () => {
      try {
        const svc = await import('../../firestoreService');
        const [vibes, amenities] = await Promise.all([
          svc.getFilterTaxonomy('vibes'),
          svc.getFilterTaxonomy('amenities'),
        ]);
        if (searchUnmountedRef.current) return;
        setFilterValues(prev => ({
          Type:      prev.Type,
          Vibe:      vibes      && vibes.length      > 0 ? vibes      : prev.Vibe,
          Amenities: amenities  && amenities.length  > 0 ? amenities  : prev.Amenities,
        }));
      } catch (e) {
        console.log('Discover filter-taxonomy load failed', e);
        // Allow a retry on the next search-bar tap so a transient failure
        // doesn't pin us to the fallback for the session.
        filterTaxonomyStartedRef.current = false;
      }
    })();
  };

  useEffect(() => {
    return () => { searchUnmountedRef.current = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => { if (!cancelled) setEditorialLoading(false); }, 8000);
    (async () => {
      try {
        const svc = await import('../../firestoreService');
        const data = await svc.getEditorialShelves();
        if (!cancelled) setShelves(data);

        // Fallback hydration for gallery cards that DON'T already carry the
        // denormalized `venueName` / `date` (older seed output). Resolve
        // venue via the gallery doc → venue doc, in parallel. After
        // seed-photographer-features.ts is re-run with the venueName + date
        // embed, this branch finds nothing to hydrate and no extra reads fire.
        const legacyGalleryIds = new Set<string>();
        for (const shelf of data) {
          for (const c of (shelf.doc.cards || [])) {
            if (c.kind !== 'gallery') continue;
            const cAny = c as EditorialCard & { venueName?: string; date?: string };
            const hasVenue = !!(cAny.venueName && cAny.venueName.length > 0);
            const hasDate  = !!(cAny.date && cAny.date.length > 0);
            if (hasVenue && hasDate) continue;
            if (c.galleryId) legacyGalleryIds.add(c.galleryId);
          }
        }
        if (legacyGalleryIds.size === 0) return;

        const uniqueGalleryIds = Array.from(legacyGalleryIds);
        const galleryDocs = await Promise.all(uniqueGalleryIds.map(id => svc.getGalleryById(id).catch(() => null)));
        if (cancelled) return;

        const uniqueVenueIds = Array.from(new Set(
          galleryDocs.filter((g): g is NonNullable<typeof g> => !!g && !!g.venueId).map(g => g.venueId!)
        ));
        const venues = uniqueVenueIds.length > 0
          ? await Promise.all(uniqueVenueIds.map(id => svc.getVenueById(id).catch(() => null)))
          : [];
        if (cancelled) return;

        const vMap: Record<string, string> = {};
        venues.forEach(v => { if (v && v.id && v.name) vMap[v.id] = v.name; });

        const gMap: Record<string, { venueName: string; date: string }> = {};
        galleryDocs.forEach(g => {
          if (!g || !g.id) return;
          gMap[g.id] = {
            venueName: g.venueId ? (vMap[g.venueId] || '') : '',
            date: g.date || '',
          };
        });

        setVenueNameById(prev => ({ ...prev, ...vMap }));
        setGalleryFallback(prev => ({ ...prev, ...gMap }));
      } catch (e) {
        console.log('DiscoverEditorialScreen: load failed', e);
      } finally {
        if (!cancelled) setEditorialLoading(false);
      }
    })();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, []);

  // Editorial card tap — resolve doc + navigate.
  const handleEditorialCard = async (shelf: EditorialShelf, card: EditorialCard) => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    try {
      // Itinerary hero card → ItineraryDetailScreen, keyed by the shelf's doc id.
      if (card.kind === 'itinerary' && shelf.type === 'itinerary') {
        onItineraryPress(shelf.doc.id);
        return;
      }
      const svc = await import('../../firestoreService');
      if ((card.kind === 'venue' || card.kind === 'stop') && card.venueId) {
        const v = await svc.getVenueById(card.venueId);
        if (v) onVenuePress(toVenueData(v));
      } else if (card.kind === 'event' && card.eventId) {
        const e = await svc.getEventById(card.eventId);
        if (e) onEventPress(toEventData(e));
      } else if (card.kind === 'gallery' && card.galleryId) {
        const g = await svc.getGalleryById(card.galleryId);
        if (g) onGalleryPress(galleryDocToData(g));
      }
      // 'photographer' is non-navigating.
    } catch (e) {
      console.log('DiscoverEditorialScreen: card nav failed', e);
    } finally {
      // Re-enable taps quickly so users aren't locked out if nav doesn't fire.
      setTimeout(() => { navigatingRef.current = false; }, 350);
    }
  };

  const handleSearchEvent = (e: FSEvent) => onEventPress(toEventData(e));
  const handleSearchVenue = (v: FSVenue) => onVenuePress(toVenueData(v));

  const removeChip = (dim: FilterDim, opt: string) => {
    setPicked(p => ({ ...p, [dim]: p[dim].filter(o => o !== opt) }));
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DiscoverHeader
        theme={theme}
        searchActive={searchActive}
        searchValue={searchValue}
        onSearchValueChange={setSearchValue}
        onActivate={() => { ensureSearchData(); ensureFilterTaxonomy(); setSearchActive(true); }}
        onCancel={() => { setSearchActive(false); setSearchValue(''); /* picked stays so toggle is round-trippable */ }}
        onMapTap={onMapTap}
      />
      {searchActive ? (
        <SearchBody
          theme={theme}
          query={searchValue}
          picked={picked}
          onOpenFilters={() => setSheetOpen(true)}
          onChipRemove={removeChip}
          onEvent={handleSearchEvent}
          onVenue={handleSearchVenue}
          onGallery={(g) => onGalleryPress(galleryDocToData(g))}
          events={searchEvents}
          venues={searchVenues}
          deals={searchDeals}
          galleries={searchGalleries}
          loading={!searchDataLoaded}
        />
      ) : (
        <EditorialBody
          shelves={shelves}
          loading={editorialLoading}
          theme={theme}
          onCard={handleEditorialCard}
          venueNameById={venueNameById}
          galleryFallback={galleryFallback}
        />
      )}
      <FilterSheet
        visible={sheetOpen}
        theme={theme}
        picked={picked}
        filterValues={filterValues}
        onApply={(next) => { setPicked(next); setSheetOpen(false); }}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}
