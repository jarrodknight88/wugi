// ─────────────────────────────────────────────────────────────────────
// Wugi — DiscoverEditorialScreen   (default Discover view)
//
// Design source: ui_kits/consumer-app/DiscoverScreen.jsx → DiscoverEditorial.
//
// The editorial-shelf experience: curated horizontal shelves (neighborhood
// guides, photographer features, multi-stop itineraries) read live from the
// top-level `neighborhoodGuides` / `itineraries` / `photographerFeatures`
// collections via getEditorialShelves(). Each shelf card embeds display
// fields and carries a real venueId/eventId/galleryId for tap-through.
//
// This is a SEPARATE screen from src/screens/DiscoverScreen.tsx — that screen
// is preserved as the search/filter mode, reached by tapping the search bar
// here (onSearchTap) or the map button (onMapTap → opens it on the map
// placeholder). Nothing in DiscoverScreen was replaced.
//
// DROPPED vs the kit (real-data-only rule — see seed scripts for rationale):
//   • "Just opened / New this month" shelf — no reliable venue open-date.
//   • "Vibe deep-dive · ranked #1/#2/#3" shelf — no ranking signal.
//   • "9 spots within 12 minutes" subtitles — needs geo/distance.
//   • Photographer "180+ photos from the past month" + follower counts —
//     replaced with real computed "{N} galleries · {M} photos".
//   • Token-dimension search overlay — superseded by the existing DiscoverScreen.
//   • Stylized clustered map with pins — needs per-venue lat/lng; the map
//     button opens the existing DiscoverScreen's map placeholder instead.
//   • Photographer "Profile" card — no photographer-profile screen exists.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  Dimensions, ActivityIndicator, StyleSheet,
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

type Props = {
  theme: Theme;
  onSearchTap: () => void;
  onMapTap: () => void;
  onEventPress: (event: EventData) => void;
  onVenuePress: (venue: VenueData) => void;
  onGalleryPress: (gallery: GalleryData) => void;
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
    id: g.id,
    title: g.title,
    venue: g.photographerName || '',
    date: g.date || '',
    coverImage: g.coverImage || images[0] || '',
    photos: (images.length > 0 ? images : [g.coverImage].filter(Boolean))
      .map((uri, i) => ({ id: `${g.id}-${i}`, uri, height: 300 })),
  };
}

// ── Header — "Discover" + Map button + search tap-target ───────────────
function MapIcon({ color }: { color: string }) {
  return (
    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
      <Path d="M9 3L3 6v15l6-3 6 3 6-3V3l-6 3-6-3zM9 3v15M15 6v15"
        stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}

function DiscoverHeader({ theme, onSearchTap, onMapTap }: { theme: Theme; onSearchTap: () => void; onMapTap: () => void }) {
  return (
    // backgroundColor: theme.bg — the header is sticky (stickyHeaderIndices={[0]});
    // without an opaque fill, shelves scroll up THROUGH the title/search/map row.
    <View style={{ backgroundColor: theme.bg, paddingTop: 60, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={{ color: theme.text, fontSize: 22, fontFamily: FONTS.display, letterSpacing: -0.7 }}>Discover</Text>
        <TouchableOpacity
          onPress={onMapTap} activeOpacity={0.8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}
        >
          <MapIcon color={theme.subtext}/>
          <Text style={{ color: theme.text, fontSize: 11, fontFamily: FONTS.medium }}>Map</Text>
        </TouchableOpacity>
      </View>
      {/* Search bar is a TAP-TARGET (not a live filter) — opens DiscoverScreen */}
      <TouchableOpacity
        onPress={onSearchTap} activeOpacity={0.8}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 }}
      >
        <SearchIcon color={theme.subtext}/>
        <Text style={{ color: theme.subtext, fontSize: 14, fontFamily: FONTS.body }}>Search venues, events, vibes…</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Shelf card — full-bleed image + gradient scrim + tag + title/sub ───
function ShelfCard({ card, theme, onPress }: { card: EditorialCard; theme: Theme; onPress: () => void }) {
  const width = Math.round(200 * (card.ratio ?? 1));
  const navigates = card.kind === 'venue' || card.kind === 'stop' || card.kind === 'event' || card.kind === 'gallery';
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
        <Text numberOfLines={2} style={{ color: '#f4efe1', fontSize: 15, fontFamily: FONTS.display, letterSpacing: -0.3, marginBottom: 2, lineHeight: 18 }}>{card.title}</Text>
        <Text numberOfLines={1} style={{ color: 'rgba(244,239,225,0.65)', fontSize: 11, fontFamily: FONTS.body }}>{card.sub}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Shelf — kicker + title + subtitle + horizontal card scroller ───────
function Shelf({ kicker, title, subtitle, cards, theme, onCardPress }: {
  kicker: string; title: string; subtitle?: string; cards: EditorialCard[];
  theme: Theme; onCardPress: (c: EditorialCard) => void;
}) {
  return (
    <View>
      <View style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 10 }}>
        <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 }}>{kicker}</Text>
        <Text style={{ color: theme.text, fontSize: 22, fontFamily: FONTS.display, letterSpacing: -0.6, marginBottom: 2 }}>{title}</Text>
        {!!subtitle && <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body }}>{subtitle}</Text>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: 18 }}>
        {cards.map((c, i) => <ShelfCard key={`${c.kind}-${i}`} card={c} theme={theme} onPress={() => onCardPress(c)}/>)}
      </ScrollView>
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────
export function DiscoverEditorialScreen({ theme, onSearchTap, onMapTap, onEventPress, onVenuePress, onGalleryPress }: Props) {
  const [shelves, setShelves] = useState<EditorialShelf[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => { if (!cancelled) setLoading(false); }, 8000);
    (async () => {
      try {
        const svc = await import('../../firestoreService');
        const data = await svc.getEditorialShelves();
        if (!cancelled) setShelves(data);
      } catch (e) {
        console.log('DiscoverEditorialScreen: load failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, []);

  const handleCard = async (card: EditorialCard) => {
    try {
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
      // 'itinerary' / 'photographer' hero cards are non-navigating.
    } catch (e) {
      console.log('DiscoverEditorialScreen: card nav failed', e);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} stickyHeaderIndices={[0]}>
        <DiscoverHeader theme={theme} onSearchTap={onSearchTap} onMapTap={onMapTap}/>

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
                onCardPress={handleCard}
              />
            ))}
            <View style={{ height: 40 }}/>
          </>
        )}
      </ScrollView>
    </View>
  );
}
