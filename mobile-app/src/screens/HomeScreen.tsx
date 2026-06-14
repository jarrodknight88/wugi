// ─────────────────────────────────────────────────────────────────────
// Wugi — HomeScreen
//
// Plan-first "Tonight" digest, restyled to the Claude Design handoff
// (wugi-design-system @ consumer-app). Home owns "for me, right now,
// tonight": a time-aware hero carousel, vibe-matched picks, deals,
// StartHere shelf (horizontal venue cards), and a weekend look-ahead.
//
// Wave 1 changes (2026-05-25):
//   • Hero → HomeHeroCarousel: 3-banner auto-advance (5500ms), finger-following
//     horizontal swipe + infinite/circular loop (clone-page technique on a
//     paging ScrollView), Instagram pagination dots, pause on touch + resume
//     2500ms after release. Core RN ScrollView only — no new deps.
//   • StartHereShelf: horizontal scroller of compact venue cards (160px)
//     with hours chip (top-left glass) + price-tier chip (bottom-right
//     parchment). Replaces the flat list/table.
//   • Camera icon removed from header (stories not at launch).
//   • Brunch banner: proper eyebrow/title/desc with carousel image.
//   • Deals cards: wired onPress → onVenuePress/onEventPress by venueId/eventId.
//   • Time-aware header: confirmed using getDayBucket (not hardcoded).
//   • Featured fallback chain: eventFeatured → isFeatured → soonest/first-N.
//
// Real-data-only build: shelves from the design that need backends we
// don't have yet are omitted rather than mocked —
//   • "Your Plan" (passes + saved)  → favorites/passes not wired here
//   • "Recent Galleries" (Lens)     → only mock galleries exist today
// Fetches live data from Firestore, falls back to mock if empty/error.
//
// Type: PP Neue Montreal via FONTS.* (the design's brand face); eyebrow
// kickers use system mono (MONO) per the design. See constants/fonts.ts.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, FlatList,
  SafeAreaView, ActivityIndicator, StyleSheet, RefreshControl,
  Animated, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, GalleryData, FSEvent, FSVenue, FSDeal } from '../types';
import { EVENTS, VENUES, DEALS, makeGallery } from '../constants/mockData';
import { FONTS, MONO } from '../constants/fonts';
import { ChevronRightIcon } from '../components/icons';

// Design content-type tag color for deals — ember terracotta (--tag-deal).
const DEAL_COLOR = '#a8533f';

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

// ── Banner data shape ─────────────────────────────────────────────────
type BannerItem = {
  id: string;
  image: string;
  kicker: string;
  hero: string;
  sub: string;
  cta: string;
  onCtaPress?: () => void;
};

// ── Firestore → local type converters ────────────────────────────────
function toEventData(e: FSEvent): EventData {
  return {
    id: e.id, title: e.title, venue: e.venue, venueId: e.venueId,
    seriesId: e.seriesId ?? null,
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
const mockToFSDeal  = (d: typeof DEALS[0]): FSDeal => ({ id:d.id, title:d.title, venueName:d.venueName, venueId:'', detail:d.detail, image:d.image, vibes:['Boujee'], expiresAt:null });

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
        <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, letterSpacing: -0.3 }}>
          {title}
        </Text>
      </View>
      {onSeeAll && (
        <TouchableOpacity onPress={onSeeAll} activeOpacity={0.85} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: theme.accent, fontSize: 12, fontFamily: FONTS.medium }}>All</Text>
          <ChevronRightIcon color={theme.accent}/>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── HomeHeroCarousel ─────────────────────────────────────────────────
// Horizontal paging ScrollView with finger-following swipe and an infinite/
// circular loop via the clone-page technique (prepend last + append first;
// silently snap back from the clones on momentum-end). Auto-advances every
// 5500ms, pauses while touched and resumes 2500ms after release. Instagram-
// style pagination dots (active 22×6, inactive 6×6, animated width via
// Animated, useNativeDriver:false), tap a dot to jump. Core RN only — no new deps.
const { width: SCREEN_WIDTH } = Dimensions.get('window');

function HomeHeroCarousel({ banners, theme }: { banners: BannerItem[]; theme: Theme }) {
  const n    = banners.length;
  const loop = n > 1;
  const PAGE_W = SCREEN_WIDTH - 32;   // container has 16px horizontal margins each side

  // Cloned page list for an infinite/circular feel: [last, ...banners, first].
  // Real banner i lives at page index i+1; pages 0 and n+1 are the wrap clones.
  const pages = loop ? [banners[n - 1], ...banners, banners[0]] : banners;

  const scrollRef      = useRef<ScrollView>(null);
  const scrollPageRef  = useRef(loop ? 1 : 0);   // current page index within `pages`
  const pausedRef      = useRef(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [realIndex, setRealIndex] = useState(0);

  // One Animated.Value per dot for the active-stretch width animation.
  const dotWidths = useRef(banners.map((_, i) => new Animated.Value(i === 0 ? 22 : 6))).current;

  const scrollToPage = (page: number, animated: boolean) =>
    scrollRef.current?.scrollTo({ x: PAGE_W * page, y: 0, animated });

  // Animate dots whenever the visible real banner changes.
  useEffect(() => {
    banners.forEach((_, i) => {
      Animated.timing(dotWidths[i], {
        toValue: i === realIndex ? 22 : 6,
        duration: 250,
        useNativeDriver: false,
      }).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realIndex]);

  const scheduleResume = () => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => { pausedRef.current = false; }, 2500);
  };

  // Auto-advance every 5500ms (paused while the user is touching the carousel).
  // Advancing past the last real page lands on the wrap clone; onMomentumScrollEnd
  // silently snaps it back to the real page so the loop is seamless.
  useEffect(() => {
    if (!loop) return;
    const t = setInterval(() => {
      if (pausedRef.current) return;
      scrollToPage(scrollPageRef.current + 1, true);
    }, 5500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop]);

  useEffect(() => () => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
  }, []);

  // Normalize the wrap clones back to the real pages after each settle, so the
  // user can keep swiping infinitely in either direction.
  const onMomentumScrollEnd = (e: { nativeEvent: { contentOffset: { x: number } } }) => {
    let page = Math.round(e.nativeEvent.contentOffset.x / PAGE_W);
    if (loop) {
      if (page === 0)          { page = n; scrollToPage(n, false); }   // before-first → real last
      else if (page === n + 1) { page = 1; scrollToPage(1, false); }   // after-last → real first
      scrollPageRef.current = page;
      setRealIndex(page - 1);
    } else {
      scrollPageRef.current = page;
      setRealIndex(page);
    }
  };

  const renderBanner = (b: BannerItem) => (
    // Whole banner is tappable → same target as the CTA pill (Build #74 §5).
    // activeOpacity:1 so the full-bleed press doesn't flash the image; the
    // nested CTA TouchableOpacity keeps its own press feedback. Horizontal
    // swipes still page because the parent ScrollView wins the pan responder.
    <TouchableOpacity activeOpacity={1} onPress={b.onCtaPress} style={{ flex: 1 }}>
      <Image
        cachePolicy="memory-disk"
        source={{ uri: b.image }}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
      />
      {/* Bottom gradient scrim */}
      <LinearGradient
        colors={['rgba(0,0,0,0.4)', 'transparent', 'rgba(0,0,0,0.92)']}
        locations={[0, 0.25, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Copy + CTA */}
      <View style={styles.carouselCopy}>
        <Text style={[styles.carouselKicker, { color: theme.accent, fontFamily: MONO }]}>{b.kicker}</Text>
        <Text style={[styles.carouselHero, { color: theme.onImage, fontFamily: FONTS.display }]}>{b.hero}</Text>
        <Text style={[styles.carouselSub, { color: theme.onImageSoft, fontFamily: FONTS.body }]}>{b.sub}</Text>
        {/* CTA glass pill */}
        <BlurView intensity={24} tint="light" style={styles.carouselCtaBlur}>
          <TouchableOpacity activeOpacity={0.85} onPress={b.onCtaPress} style={styles.carouselCta}>
            <Text style={[styles.carouselCtaText, { color: theme.onImage, fontFamily: FONTS.medium }]}>{b.cta} →</Text>
          </TouchableOpacity>
        </BlurView>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.carouselContainer}>
      {/* Horizontal paging ScrollView — finger-following swipe + infinite loop */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        // Start on the first real banner (page 1) when looping.
        contentOffset={{ x: loop ? PAGE_W : 0, y: 0 }}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => { pausedRef.current = true; if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current); }}
        onScrollEndDrag={scheduleResume}
        onMomentumScrollEnd={onMomentumScrollEnd}
      >
        {pages.map((b, i) => (
          <View key={`page-${i}`} style={{ width: PAGE_W, height: 280 }}>
            {renderBanner(b)}
          </View>
        ))}
      </ScrollView>

      {/* Pagination dots — Instagram style (active stretches to 22×6 bar) */}
      <View style={styles.dotsRow} pointerEvents="box-none">
        {banners.map((_, i) => (
          <TouchableOpacity
            key={i}
            activeOpacity={0.8}
            onPress={() => {
              pausedRef.current = true;
              scrollToPage(loop ? i + 1 : i, true);
              scheduleResume();
            }}
          >
            <Animated.View
              style={[
                styles.dot,
                { width: dotWidths[i], backgroundColor: i === realIndex ? '#f4efe1' : 'rgba(244,239,225,0.45)' },
              ]}
            />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── StartHereShelf ───────────────────────────────────────────────────
// Horizontal scroller of compact venue cards (160px wide).
// Card: square photo on top; hours chip overlaid top-left (dark glass,
// 9px mono uppercase); price-tier chip overlaid bottom-right (parchment
// bg, paper-black text, 10px mono); body below = name (13/600) + neighborhood.
function StartHereShelf({
  starters, theme, onVenuePress,
}: {
  starters: VenueData[];
  theme: Theme;
  onVenuePress: (v: VenueData) => void;
}) {
  if (starters.length === 0) return null;
  return (
    <>
      <ShelfHeader
        kicker="FROM YOUR VIBES · OPEN TONIGHT"
        title="Where to start"
        theme={theme}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
      >
        {starters.map(v => {
          const imageUri = (v.media || [])[0]?.uri || `https://picsum.photos/seed/${v.id}/400/400`;
          const hours = v.openStatusHint || v.hoursText || undefined;
          const price = v.priceTier || undefined;
          return (
            <TouchableOpacity
              key={v.id}
              activeOpacity={0.9}
              onPress={() => onVenuePress(v)}
              style={[styles.startCard, { backgroundColor: theme.card, borderColor: theme.border }]}
            >
              {/* Square photo */}
              <View style={styles.startCardPhoto}>
                <Image
                  cachePolicy="memory-disk"
                  source={{ uri: imageUri }}
                  style={StyleSheet.absoluteFillObject}
                  contentFit="cover"
                />
                {/* Hours chip — top-left, dark glass */}
                {hours && (
                  <View style={styles.hoursChip}>
                    <Text style={[styles.hoursChipText, { fontFamily: MONO }]}>
                      {hours.toUpperCase()}
                    </Text>
                  </View>
                )}
                {/* Price tier chip — bottom-right, parchment */}
                {price && (
                  <View style={styles.priceChip}>
                    <Text style={[styles.priceChipText, { fontFamily: MONO }]}>
                      {price}
                    </Text>
                  </View>
                )}
              </View>
              {/* Body */}
              <View style={styles.startCardBody}>
                <Text style={[styles.startCardName, { color: theme.text, fontFamily: FONTS.medium }]} numberOfLines={1}>
                  {v.name}
                </Text>
                {v.neighborhood && (
                  <Text style={[styles.startCardNeighborhood, { color: theme.subtext, fontFamily: FONTS.body }]} numberOfLines={1}>
                    {v.neighborhood}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </>
  );
}

// ── Props ─────────────────────────────────────────────────────────────
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
  const [deals,      setDeals]      = useState<FSDeal[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const { getApprovedEvents, getApprovedVenues, getActiveDeals } =
        await import('../../firestoreService');

      // Larger pool (100) so the picks / weekend / where-to-start shelves
      // have room to slice from after vibe filtering. Deals stay capped at 5.
      const [liveEvents, liveVenues, liveDeals] = await Promise.all([
        getApprovedEvents(userVibes, 100),
        getApprovedVenues(userVibes, 100),
        getActiveDeals(userVibes, 5),
      ]);

      setEvents(liveEvents.length > 0 ? liveEvents : EVENTS.map(mockToFSEvent));
      setVenues(liveVenues.length > 0 ? liveVenues : VENUES.map(mockToFSVenue));
      setDeals(liveDeals.length   > 0 ? liveDeals  : DEALS.map(mockToFSDeal));
    } catch (e) {
      console.log('HomeScreen: Firestore fetch failed, using mock data', e);
      setEvents(EVENTS.map(mockToFSEvent));
      setVenues(VENUES.map(mockToFSVenue));
      setDeals(DEALS.map(mockToFSDeal));
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

  // ── Featured selection (Home is NEVER empty) ───────────────────────────
  // Preference chain so an editorial pick leads, but Home always has content:
  //   1. eventFeatured / venueFeatured  (new hand-promoted editorial flag)
  //   2. legacy isFeatured              (back-compat with pre-Batch-0 docs)
  //   3. soonest / first-N              (whatever the feed returned)
  // Hero is backed by the top featured event (real data) — no dedicated
  // editorial hero-image source exists, so we borrow the lead event's media.
  const editorialEvents = events.filter(e => (e as any).eventFeatured === true);
  const legacyFeaturedEvents = events.filter(e => (e as any).isFeatured === true);
  const heroSource =
    editorialEvents.length > 0 ? editorialEvents
    : legacyFeaturedEvents.length > 0 ? legacyFeaturedEvents
    : events;
  const heroEvent = heroSource[0] ? toEventData(heroSource[0]) : undefined;

  // Featured venues lead the "Where to start" shelf when promoted, else the
  // legacy isFeatured set, else the first-N the feed already returned.
  const editorialVenues = venues.filter(v => (v as any).venueFeatured === true);
  const legacyFeaturedVenues = venues.filter(v => (v as any).isFeatured === true);
  const starterSource =
    editorialVenues.length > 0 ? editorialVenues
    : legacyFeaturedVenues.length > 0 ? legacyFeaturedVenues
    : venues;

  const picks   = eventList.slice(0, 8);
  const weekend = eventList.slice(0, 6);
  const starters = starterSource.map(toVenueData).slice(0, 5);

  // Time-aware hero copy — computed once per render (cheap).
  // getDayBucket() is called here (not hardcoded) so the bucket switches
  // automatically when the user opens the screen in a different time of day.
  const bucket = getDayBucket();

  // "BECAUSE · [vibe]" reason for picks cards. Falls back to the bucket
  // kicker so the chip never reads blank for a no-vibe user.
  const picksReason = userVibes[0] ? `BECAUSE · ${userVibes[0].toUpperCase()}` : bucket.toUpperCase();

  // ── Build the 3-banner carousel data ──────────────────────────────────
  // Banner 1: time-aware (morning = BRUNCH HOUR, else TONIGHT). Backed by the
  // lead featured event image when available; brunch uses its own copy.
  // Banner 2: JUST OPENED — new venues/events this month.
  // Banner 3: WEEKEND HORIZON — itinerary teaser.
  //
  // CTAs route to real featured items when present; otherwise non-navigating.
  const heroBannerImage = heroEvent
    ? (heroEvent.media || [])[0]?.uri || 'https://picsum.photos/seed/homehero1/800/600'
    : 'https://picsum.photos/seed/homehero1/800/600';

  // Brunch banner always uses the brunch copy regardless of heroEvent.
  // CTA routes to first event with a brunch/morning vibe or the first event.
  const brunchEvent = eventList.find(e =>
    e.title.toLowerCase().includes('brunch') ||
    e.venue.toLowerCase().includes('brunch')
  ) || eventList[0];

  // For the time-aware first banner:
  const isMorning = bucket === 'morning';
  const firstBanner: BannerItem = isMorning
    ? {
        id: 'b-morning',
        image: brunchEvent
          ? (brunchEvent.media || [])[0]?.uri || 'https://picsum.photos/seed/homehero-brunch/800/600'
          : 'https://picsum.photos/seed/homehero-brunch/800/600',
        kicker: 'BRUNCH HOUR',
        hero: 'Brunch Nearby',
        sub: 'Where to start your day in Atlanta',
        cta: 'See brunch spots',
        onCtaPress: brunchEvent ? () => onEventPress(brunchEvent) : undefined,
      }
    : {
        id: 'b-tonight',
        image: heroBannerImage,
        kicker: bucket === 'lateNight' ? 'STILL OPEN' : 'TONIGHT',
        hero: bucket === 'lateNight' ? 'Still open near you' : "Tonight's scene",
        sub: bucket === 'afternoon'
          ? 'Picked for your vibes'
          : bucket === 'lateNight'
            ? 'Late-night spots from your vibes'
            : 'Venues, events, and dishes from your vibes',
        cta: bucket === 'lateNight' ? 'See late-night' : 'Start exploring',
        onCtaPress: heroEvent ? () => onEventPress(heroEvent) : undefined,
      };

  // "JUST OPENED" banner — backed by the 2nd featured event (or 2nd event).
  const justOpenedEvent = heroSource[1] ? toEventData(heroSource[1]) : eventList[1];
  const justOpenedBanner: BannerItem = {
    id: 'b-just-opened',
    image: justOpenedEvent
      ? (justOpenedEvent.media || [])[0]?.uri || 'https://picsum.photos/seed/homehero2/800/600'
      : 'https://picsum.photos/seed/homehero2/800/600',
    kicker: 'JUST OPENED',
    hero: 'New this month',
    sub: 'Fresh spots and events in Atlanta',
    cta: 'See what\'s new',
    onCtaPress: justOpenedEvent ? () => onEventPress(justOpenedEvent) : undefined,
  };

  // "WEEKEND HORIZON" banner — backed by the 3rd featured event (or 3rd).
  const weekendEvent = heroSource[2] ? toEventData(heroSource[2]) : eventList[2];
  const weekendBanner: BannerItem = {
    id: 'b-weekend',
    image: weekendEvent
      ? (weekendEvent.media || [])[0]?.uri || 'https://picsum.photos/seed/homehero3/800/600'
      : 'https://picsum.photos/seed/homehero3/800/600',
    kicker: 'WEEKEND HORIZON',
    hero: 'Plan your Saturday',
    sub: 'Brunch → bar → late-night routes',
    cta: 'See itineraries',
    onCtaPress: weekendEvent ? () => onEventPress(weekendEvent) : undefined,
  };

  const banners: BannerItem[] = [firstBanner, justOpenedBanner, weekendBanner];

  // ── Deals venue lookup (for onPress wiring) ───────────────────────────
  // Find the VenueData matching a deal's venueName for CTA routing.
  // Falls back to null if no match; card becomes non-navigating.
  const venueList = venues.map(toVenueData);
  function dealVenue(deal: FSDeal): VenueData | null {
    if (deal.venueId) {
      const byId = venueList.find(v => v.id === deal.venueId);
      if (byId) return byId;
    }
    // Fallback: fuzzy match on venue name
    return venueList.find(v =>
      v.name === deal.venueName ||
      v.name.includes(deal.venueName) ||
      deal.venueName.includes(v.name.split(' ')[0])
    ) || null;
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} size="large"/>
        <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, marginTop: 12 }}>Loading your feed...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Minimal header — wordmark + vibe summary. Camera icon removed (no
          stories at launch). onCameraPress prop kept for type compat. */}
      <SafeAreaView style={{ borderBottomWidth: 1, borderBottomColor: theme.divider, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: theme.accent, fontSize: 34, fontFamily: FONTS.display, letterSpacing: -1.4, lineHeight: 38 }}>wugi</Text>
        </View>
        {userVibes.length > 0 && (
          <Text style={{ color: theme.subtext, fontSize: 11, textAlign: 'center', marginTop: 6, fontFamily: MONO, letterSpacing: 0.4 }}>
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
        {/* Hero CAROUSEL — 3-banner auto-scroll, cross-fade, swipe, pagination */}
        <HomeHeroCarousel banners={banners} theme={theme}/>

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
                    <Text style={{ color: theme.onImage, fontSize: 9, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.5 }} numberOfLines={1}>{picksReason}</Text>
                  </View>
                  <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14 }}>
                    <Text style={{ color: theme.onImage, fontSize: 15, fontFamily: FONTS.display, letterSpacing: -0.2, lineHeight: 18, marginBottom: 3 }} numberOfLines={2}>{item.title}</Text>
                    <Text style={{ color: theme.onImageMuted, fontSize: 11, fontFamily: FONTS.body }} numberOfLines={1}>{item.venue}{item.time ? ` · ${item.time}` : ''}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        {/* Deals & Specials — real getActiveDeals data, wired to venue/event */}
        {deals.length > 0 && (
          <>
            <ShelfHeader kicker="LIMITED TIME" title="Deals & Specials" theme={theme}/>
            <FlatList
              data={deals} keyExtractor={i => i.id} horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item }) => {
                const targetVenue = dealVenue(item);
                const handlePress = targetVenue ? () => onVenuePress(targetVenue) : undefined;
                return (
                  <TouchableOpacity
                    style={{ width: 260, height: 150, borderRadius: 14, overflow: 'hidden' }}
                    activeOpacity={targetVenue ? 0.9 : 1}
                    onPress={handlePress}
                    disabled={!handlePress}
                  >
                    <Image cachePolicy="memory-disk" source={{ uri: item.image || 'https://picsum.photos/seed/deal/400/300' }} style={StyleSheet.absoluteFillObject} contentFit="cover"/>
                    <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: theme.overlayMedium }}/>
                    <View style={{ position: 'absolute', top: 10, left: 10, backgroundColor: DEAL_COLOR, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: theme.onImage, fontSize: 9, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.8 }}>DEAL</Text>
                    </View>
                    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14 }}>
                      <Text style={{ color: theme.onImage, fontSize: 15, fontFamily: FONTS.display, letterSpacing: -0.2, marginBottom: 2 }} numberOfLines={1}>{item.title}</Text>
                      <Text style={{ color: theme.onImageSoft, fontSize: 11, fontFamily: FONTS.body, marginBottom: 4 }} numberOfLines={1}>{item.venueName}</Text>
                      <Text style={{ color: theme.accent, fontSize: 11, fontFamily: FONTS.medium }} numberOfLines={1}>{item.detail}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </>
        )}

        {/* Where to start — StartHereShelf: horizontal venue cards */}
        <StartHereShelf starters={starters} theme={theme} onVenuePress={onVenuePress}/>

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
                    <Text style={{ color: theme.accent, fontSize: 9, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.6, marginBottom: 2 }} numberOfLines={1}>{item.date}</Text>
                    <Text style={{ color: theme.onImage, fontSize: 12, fontFamily: FONTS.display, lineHeight: 15 }} numberOfLines={2}>{item.title}</Text>
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

// ── StyleSheet ────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // HomeHeroCarousel
  carouselContainer: {
    height: 280,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#1a1612',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 36,
    elevation: 12,
  },
  carouselCopy: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 18,
    paddingBottom: 42, // leave room for pagination dots
    // No background — LinearGradient above handles the scrim.
  },
  carouselKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  carouselHero: {
    fontSize: 32,
    letterSpacing: -1,
    lineHeight: 34,
    marginBottom: 6,
  },
  carouselSub: {
    fontSize: 13,
    marginBottom: 14,
    lineHeight: 18,
  },
  // Outer BlurView wrapper — handles the backdrop blur + border-radius clip.
  carouselCtaBlur: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(244,239,225,0.25)',
  },
  // Inner tint overlay + padding — keeps the rgba(244,239,225,0.15) tint on
  // top of the blur, matching the design's glass specification.
  carouselCta: {
    backgroundColor: 'rgba(244,239,225,0.15)',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  carouselCtaText: {
    fontSize: 13,
  },
  // Pagination dots
  dotsRow: {
    position: 'absolute',
    bottom: 14,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
    zIndex: 10,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  // StartHereShelf cards
  startCard: {
    flexShrink: 0,
    width: 160,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
  },
  startCardPhoto: {
    width: 160,
    height: 160,
    position: 'relative',
  },
  hoursChip: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  hoursChipText: {
    color: '#f4efe1',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  priceChip: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(232,227,214,0.92)',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  priceChipText: {
    color: '#1a1612',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  startCardBody: {
    padding: 10,
    paddingBottom: 12,
  },
  startCardName: {
    fontSize: 13,
    letterSpacing: -0.1,
    lineHeight: 16,
    marginBottom: 2,
  },
  startCardNeighborhood: {
    fontSize: 11,
    lineHeight: 14,
  },
});
