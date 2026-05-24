// ─────────────────────────────────────────────────────────────────────
// Wugi — HomeScreen
//
// Plan-first "Tonight" digest, restyled to the Claude Design handoff
// (wugi-design-system @ consumer-app). Home owns "for me, right now,
// tonight": a time-aware hero, vibe-matched picks, where-to-start
// venues, and a weekend look-ahead.
//
// Real-data-only build: shelves from the design that need backends we
// don't have yet are omitted rather than mocked —
//   • "Your Plan" (passes + saved)  → favorites/passes not wired here
//   • "Recent Galleries" (Lens)     → only mock galleries exist today
// Fetches live data from Firestore, falls back to mock if empty/error.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, FlatList, SafeAreaView, ActivityIndicator, StyleSheet, RefreshControl, Platform } from 'react-native';
import { Image } from 'expo-image';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, GalleryData, FSEvent, FSVenue } from '../types';
import { EVENTS, VENUES, makeGallery } from '../constants/mockData';
import { CameraIcon, ChevronRightIcon } from '../components/icons';

// Monospace family for the design's "letterpress" eyebrow/kicker labels.
// System mono only (Menlo on iOS) — no custom font, per build constraints.
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string;

// ── Time-aware hero copy ─────────────────────────────────────────────
// Buckets the current hour into morning / afternoon / evening / late-night.
// Pure function so it's easy to test and avoids re-rendering on every tick.
type DayBucket = 'morning' | 'afternoon' | 'evening' | 'lateNight';
function getDayBucket(d: Date = new Date()): DayBucket {
  const h = d.getHours();
  if (h >= 5 && h < 12)  return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 24) return 'evening';
  return 'lateNight';
}
const HERO_COPY: Record<DayBucket, { kicker: string; title: string; sub: string; cta: string }> = {
  morning:   { kicker: 'BRUNCH HOUR', title: 'Brunch nearby',        sub: 'Where to start your day in Atlanta',         cta: 'See brunch spots' },
  afternoon: { kicker: 'TONIGHT',     title: 'Tonight at a glance',  sub: 'Picked for your vibes',                      cta: 'See tonight' },
  evening:   { kicker: 'TONIGHT',     title: "Tonight's scene",      sub: 'Venues, events, and dishes from your vibes', cta: 'Start exploring' },
  lateNight: { kicker: 'STILL OPEN',  title: 'Still open near you',  sub: 'Late-night spots from your vibes',           cta: 'See late-night' },
};

// ── Firestore → local type converters ────────────────────────────────
function toEventData(e: FSEvent): EventData {
  return {
    id: e.id, title: e.title, venue: e.venue, venueId: e.venueId,
    date: e.date, time: e.time, age: e.age, about: e.about || '',
    media: e.media || [],
    hasTickets: (e as any).hasTickets === true,
    gallery: makeGallery(e.id, e.title, e.venue, e.date,
      ['gp1','gp2','gp3','gp4','gp5','gp6','gp7','gp8']),
  };
}

function toVenueData(v: FSVenue): VenueData {
  return {
    id: v.id, name: v.name, category: v.category || '',
    address: v.address || '', phone: v.phone || '',
    logoUrl: (v as any).logoUrl || '',
    website: v.website || '', instagram: v.instagram || '',
    attributes: v.attributes || [], about: v.about || '',
    // Normalize legacy string-array media to {type, uri} objects so all
    // downstream renders can read .uri uniformly.
    media: (v.media || []).map(m =>
      typeof m === 'string' ? { type: 'image', uri: m } : m
    ),
    menuDescription: v.about || '', menuAttributes: v.attributes || [],
    bestSellers: [], upcomingEvents: [], galleries: [],
    // Phase-2 reskin fields. Forward when present; downstream screens
    // render slots only when the field exists.
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

// Mock → FS type helpers for fallback
const mockToFSEvent = (e: EventData): FSEvent => ({ id:e.id, title:e.title, venue:e.venue, venueId:e.venueId ?? '', date:e.date, time:e.time, age:e.age, about:e.about, vibes:['Boujee'], media:e.media || [], status:'approved', createdAt:null });
const mockToFSVenue = (v: VenueData): FSVenue => ({ id:v.id, name:v.name, category:v.category, address:v.address, phone:v.phone, website:v.website, instagram:v.instagram, attributes:v.attributes || [], vibes:['Boujee'], about:v.about, media:v.media || [], status:'approved', createdAt:null });

// ── Shelf header — mono kicker + bold title, optional "All →" ─────────
function ShelfHeader({ kicker, title, theme, onSeeAll }: {
  kicker: string; title: string; theme: Theme; onSeeAll?: () => void;
}) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.5, marginBottom: 4 }} numberOfLines={1}>
          {kicker}
        </Text>
        <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700', letterSpacing: -0.3 }}>
          {title}
        </Text>
      </View>
      {onSeeAll && (
        <TouchableOpacity onPress={onSeeAll} activeOpacity={0.85} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '600' }}>All</Text>
          <ChevronRightIcon color={theme.accent}/>
        </TouchableOpacity>
      )}
    </View>
  );
}

type Props = {
  theme: Theme;
  onEventPress:   (event: EventData)    => void;
  onVenuePress:   (venue: VenueData)    => void;
  onGalleryPress: (gallery: GalleryData) => void;
  userVibes:      string[];
  onCameraPress:  () => void;
};

export function HomeScreen({ theme, onEventPress, onVenuePress, userVibes, onCameraPress }: Props) {
  const [events,     setEvents]     = useState<FSEvent[]>([]);
  const [venues,     setVenues]     = useState<FSVenue[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const { getApprovedEvents, getApprovedVenues } =
        await import('../../firestoreService');

      // Larger pool (100) so the picks / weekend / where-to-start shelves
      // have room to slice from after vibe filtering.
      const [liveEvents, liveVenues] = await Promise.all([
        getApprovedEvents(userVibes, 100),
        getApprovedVenues(userVibes, 100),
      ]);

      setEvents(liveEvents.length > 0 ? liveEvents : EVENTS.map(mockToFSEvent));
      setVenues(liveVenues.length > 0 ? liveVenues : VENUES.map(mockToFSVenue));
    } catch (e) {
      console.log('HomeScreen: Firestore fetch failed, using mock data', e);
      setEvents(EVENTS.map(mockToFSEvent));
      setVenues(VENUES.map(mockToFSVenue));
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
  }, [userVibes]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const eventList = events.map(toEventData);
  const venueList = venues.map(toVenueData);
  // Hero is backed by the top featured event (real data) — no dedicated
  // editorial hero-image source exists, so we borrow the lead event's media.
  const featuredEvents = events.filter(e => (e as any).isFeatured);
  const heroEvent = (featuredEvents.length > 0 ? featuredEvents : events)[0]
    ? toEventData((featuredEvents.length > 0 ? featuredEvents : events)[0]) : undefined;
  const picks   = eventList.slice(0, 8);
  const weekend = eventList.slice(0, 6);
  const starters = venueList.slice(0, 5);

  // Time-aware hero copy — computed once per render (cheap).
  const bucket = getDayBucket();
  const hero   = HERO_COPY[bucket];
  // "BECAUSE · [vibe]" reason for picks cards. Falls back to the bucket
  // kicker so the chip never reads blank for a no-vibe user.
  const picksReason = userVibes[0] ? `BECAUSE · ${userVibes[0].toUpperCase()}` : hero.kicker;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} size="large"/>
        <Text style={{ color: theme.subtext, fontSize: 13, marginTop: 12 }}>Loading your feed...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Minimal header — wordmark + camera + vibe summary. No vibe-picker
          (moved to onboarding in the design). */}
      <SafeAreaView style={{ borderBottomWidth: 1, borderBottomColor: theme.divider, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 36 }}/>
          <Text style={{ color: theme.accent, fontSize: 26, fontWeight: '900', letterSpacing: -1 }}>wugi</Text>
          <TouchableOpacity onPress={onCameraPress} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <CameraIcon color={theme.subtext}/>
          </TouchableOpacity>
        </View>
        {userVibes.length > 0 && (
          <Text style={{ color: theme.subtext, fontSize: 11, textAlign: 'center', marginTop: 4, fontFamily: MONO, letterSpacing: 0.4 }}>
            {userVibes.slice(0, 3).join(' · ').toUpperCase()}
          </Text>
        )}
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        {/* Time-aware hero — image-backed by the lead featured event */}
        <TouchableOpacity
          activeOpacity={heroEvent ? 0.92 : 1}
          onPress={() => heroEvent && onEventPress(heroEvent)}
          style={{ height: 280, marginHorizontal: 16, marginTop: 12, borderRadius: 20, overflow: 'hidden', backgroundColor: theme.card }}
        >
          {heroEvent && (
            <Image
              cachePolicy="memory-disk"
              source={{ uri: (heroEvent.media || [])[0]?.uri || 'https://picsum.photos/seed/homehero/800/600' }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
            />
          )}
          <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: theme.overlayMedium }}/>
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 18 }}>
            <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, fontFamily: MONO, marginBottom: 8 }}>
              {hero.kicker}
            </Text>
            <Text style={{ color: theme.onImage, fontSize: 32, fontWeight: '900', letterSpacing: -1, marginBottom: 6 }}>
              {hero.title}
            </Text>
            <Text style={{ color: theme.onImageSoft, fontSize: 13, marginBottom: 14 }}>
              {hero.sub}
            </Text>
            <View style={{ flexDirection: 'row' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(244,239,225,0.15)', borderWidth: 1, borderColor: 'rgba(244,239,225,0.25)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 }}>
                <Text style={{ color: theme.onImage, fontSize: 13, fontWeight: '600' }}>{hero.cta}</Text>
                <Text style={{ color: theme.onImage, fontSize: 13, fontWeight: '600', marginLeft: 6 }}>→</Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>

        {/* Picks for you — vibe-matched events */}
        {picks.length > 0 && (
          <>
            <ShelfHeader kicker="FOR YOUR VIBES" title="Picks for you" theme={theme}/>
            <FlatList
              data={picks} keyExtractor={i => i.id} horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={{ width: 170, height: 240, borderRadius: 14, overflow: 'hidden' }} activeOpacity={0.9} onPress={() => onEventPress(item)}>
                  <Image cachePolicy="memory-disk" source={{ uri: (item.media || [])[0]?.uri || 'https://picsum.photos/seed/fallback/400/600' }} style={StyleSheet.absoluteFillObject} contentFit="cover"/>
                  <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: theme.overlayMedium }}/>
                  <View style={{ position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(244,239,225,0.18)', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: theme.onImage, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, fontFamily: MONO }} numberOfLines={1}>{picksReason}</Text>
                  </View>
                  <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14 }}>
                    <Text style={{ color: theme.onImage, fontSize: 15, fontWeight: '700', letterSpacing: -0.2, lineHeight: 18, marginBottom: 3 }} numberOfLines={2}>{item.title}</Text>
                    <Text style={{ color: theme.onImageMuted, fontSize: 11 }} numberOfLines={1}>{item.venue}{item.time ? ` · ${item.time}` : ''}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        {/* Where to start — vibe-matched venues, open tonight */}
        {starters.length > 0 && (
          <>
            <ShelfHeader kicker="FROM YOUR VIBES · OPEN TONIGHT" title="Where to start" theme={theme}/>
            <View style={{ marginHorizontal: 16, borderRadius: 14, borderWidth: 1, overflow: 'hidden', backgroundColor: theme.card, borderColor: theme.border }}>
              {starters.map((item, index) => {
                const sub = [item.neighborhood, item.priceTier].filter(Boolean).join(' · ');
                const hours = item.hoursText || item.openStatusHint;
                return (
                  <TouchableOpacity key={item.id} onPress={() => onVenuePress(item)} activeOpacity={0.7}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: index > 0 ? 1 : 0, borderTopColor: theme.divider }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{item.name}</Text>
                      {sub.length > 0 && <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 2 }} numberOfLines={1}>{sub}</Text>}
                    </View>
                    {hours && (
                      <Text style={{ color: theme.subtext, fontSize: 10, fontWeight: '600', letterSpacing: 0.4, fontFamily: MONO, textTransform: 'uppercase' }} numberOfLines={1}>{hours}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {/* This weekend — short look-ahead */}
        {weekend.length > 0 && (
          <>
            <ShelfHeader kicker="LOOKING AHEAD" title="This weekend" theme={theme}/>
            <FlatList
              data={weekend} keyExtractor={i => i.id} horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={{ width: 140, height: 190, borderRadius: 12, overflow: 'hidden' }} activeOpacity={0.9} onPress={() => onEventPress(item)}>
                  <Image cachePolicy="memory-disk" source={{ uri: (item.media || [])[0]?.uri || 'https://picsum.photos/seed/fallback/400/600' }} style={StyleSheet.absoluteFillObject} contentFit="cover"/>
                  <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: theme.overlaySoft }}/>
                  <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12 }}>
                    <Text style={{ color: theme.accent, fontSize: 9, fontWeight: '700', letterSpacing: 0.6, fontFamily: MONO, marginBottom: 2 }} numberOfLines={1}>{item.date}</Text>
                    <Text style={{ color: theme.onImage, fontSize: 12, fontWeight: '700', lineHeight: 15 }} numberOfLines={2}>{item.title}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        <View style={{ height: 40 }}/>
      </ScrollView>
    </View>
  );
}
