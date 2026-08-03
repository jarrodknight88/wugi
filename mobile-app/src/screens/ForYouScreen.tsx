// ─────────────────────────────────────────────────────────────────────
// Wugi — ForYouScreen
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, Animated, PanResponder, StyleSheet, Dimensions, ActivityIndicator,  } from 'react-native';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import Svg, { Path } from 'react-native-svg';
import { Video, ResizeMode } from 'expo-av';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, ForYouCard, FavoriteItem, FSDeal, MenuItem, GalleryDoc } from '../types';
import {
  getForYouFeed, getDealsBrowse, getApprovedGalleries, getMenuItemsForVenues,
  type FSEvent, type FSVenue,
} from '../../firestoreService';
import { ErrorState, EmptyState } from '../components/StateViews';
import { FONTS, MONO } from '../constants/fonts';
import { DEAL_COLOR } from '../components/DealCard';
import { dealTypeLabel, dealOffer, orderDealsForDisplay } from '../utils/deals';
import { formatEventDateShort } from '../utils/eventDateTime';
import { buildPhotoId } from '../utils/photoId';
import { DAILY_SUGGESTION_CAP, getSuggestionCountToday, incrementSuggestionCount, hasReachedDailyCap } from '../utils/forYouSuggestionCap';
import { logForYouInteraction } from '../analytics/analyticsService';

const GALLERY_PHOTO_COLOR = '#0ea5b8';
const VENUE_PHOTO_COLOR   = '#2563eb';
const FOOD_COLOR          = '#d97706';

// Status-bar inset (expo-constants — the app doesn't depend on
// react-native-safe-area-context). Reused below as extra bottom clearance
// for the swipe CTA row so it never sits close to the TabBar (UAT-A2 #3).
const STATUS_BAR_H = Constants.statusBarHeight ?? 0;

function fsEventToCard(e: FSEvent, venueCategory: string | null): ForYouCard {
  return {
    id: e.id, type: 'event',
    title: e.title, subtitle: `${e.venue} · ${formatEventDateShort(e.date)}`,
    image: e.media?.[0]?.uri || `https://picsum.photos/seed/${e.id}/600/900`,
    tag: e.vibes?.[0] || 'Event', tagColor: '#2a7a5a',
    data: {
      id: e.id, title: e.title, venue: e.venue, venueId: e.venueId,
      seriesId: e.seriesId ?? null,
      date: e.date, time: e.time, age: e.age || '21+',
      about: e.about || '', vibes: e.vibes || [],
      media: e.media?.map(m => ({ type: m.type as 'image'|'video', uri: m.uri })) || [{ type: 'image', uri: `https://picsum.photos/seed/${e.id}/600/900` }],
      gallery: { id: e.id, title: e.title, venue: e.venue, date: e.date, coverImage: '', photos: [] },
      hasTickets: (e as any).hasTickets || false,
    } as EventData,
    contentType: 'event', venueCategory,
  };
}

function fsVenueToCard(v: FSVenue): ForYouCard {
  // Normalize legacy string-array media to {type, uri} objects so the
  // VenueData payload + the card's flat image field both read cleanly.
  const normalizedMedia = (v.media || []).map(m =>
    typeof m === 'string' ? { type: 'image', uri: m } : m
  );
  return {
    id: v.id, type: 'venue',
    title: v.name, subtitle: `${v.category || 'Venue'} · ${v.neighborhood || 'Atlanta'}`,
    image: normalizedMedia[0]?.uri || `https://picsum.photos/seed/${v.id}/600/900`,
    tag: v.vibes?.[0] || 'Venue', tagColor: '#7c3aed',
    data: {
      id: v.id, name: v.name, category: v.category || '',
      address: v.address || '', phone: v.phone || '',
      website: v.website || '', instagram: v.instagram || '',
      about: v.about || '', attributes: v.attributes || [],
      vibes: v.vibes || [], status: v.status,
      media: normalizedMedia, rating: v.rating || null, priceLevel: v.priceLevel || '',
      isClaimed: v.isClaimed || false, isFeatured: (v as any).isFeatured || false,
    } as VenueData,
    contentType: 'venue', venueCategory: v.category || null,
  };
}

// Deals render as swipe cards (NOT the DealCard) — deal type as the tag,
// venue + offer as title/subtitle. Non-navigating (data:null) like a teaser.
function fsDealToCard(d: FSDeal, venueCategory: string | null): ForYouCard {
  const offer = dealOffer(d);
  return {
    id: `deal_${d.id}`, type: 'deal',
    title: d.title,
    subtitle: offer ? `${d.venueName} · ${offer}` : d.venueName,
    image: d.image || `https://picsum.photos/seed/deal-${d.id}/600/900`,
    tag: dealTypeLabel(d.dealType), tagColor: DEAL_COLOR,
    data: null,
    contentType: 'deal', venueCategory,
  };
}

// Gallery Photos + Venue Photos suggestion sources (UAT-W2D audit — both
// were missing before this change). Both read the same top-level
// `galleries` collection; a gallery with an eventId is an event's photo
// set ("Gallery Photo"), one without is a general venue photo set
// ("Venue Photo"). Non-navigating teaser like deal cards (no photo-detail
// screen reachable from here), but the synthetic `${galleryId}-${index}`
// photoId is still attached so a right-swipe save produces a real,
// contract-compliant liked-photo favorite (see photoId.ts).
function fsGalleryToCard(g: GalleryDoc, venueCategory: string | null): ForYouCard {
  const isEventGallery = !!g.eventId;
  const photoId = buildPhotoId(g.id, 0);
  return {
    id: `photo_${photoId}`,
    type: 'gallery',
    title: g.title || (isEventGallery ? 'Event Gallery' : 'Venue Photos'),
    subtitle: g.date || '',
    image: g.images?.[0] || g.coverImage || `https://picsum.photos/seed/${g.id}/600/900`,
    tag: isEventGallery ? 'Gallery Photo' : 'Venue Photo',
    tagColor: isEventGallery ? GALLERY_PHOTO_COLOR : VENUE_PHOTO_COLOR,
    data: null,
    contentType: isEventGallery ? 'galleryPhoto' : 'venuePhoto',
    venueCategory,
    photoId,
  };
}

// Food/Menu Items suggestion source (UAT-W2D audit — missing before this
// change; see getMenuItemsForVenues for why this reads per-venue instead
// of a collectionGroup query). Non-navigating teaser, like deals.
function fsMenuItemToCard(item: MenuItem & { venueId: string }, venueName: string, venueCategory: string | null): ForYouCard {
  const priceOrVenue = item.priceDisplay ? `${venueName} · ${item.priceDisplay}` : venueName;
  return {
    id: `food_${item.venueId}_${item.id}`,
    type: 'food',
    title: item.name,
    subtitle: priceOrVenue,
    image: item.imageUrl || `https://picsum.photos/seed/food-${item.venueId}-${item.id}/600/900`,
    tag: 'Menu Item', tagColor: FOOD_COLOR,
    data: null,
    contentType: 'foodItem', venueCategory,
  };
}

// Interleaves N source buckets round-robin (one card from each bucket per
// pass) instead of a fixed "every 3rd card" injection — the mechanism that
// lets a small source (e.g. 4 menu items) still surface early and often
// rather than being buried behind 40 events.
function roundRobin<T>(buckets: T[][]): T[] {
  const out: T[] = [];
  const cursors = new Array(buckets.length).fill(0);
  let remaining = buckets.reduce((n, b) => n + b.length, 0);
  while (remaining > 0) {
    for (let b = 0; b < buckets.length; b++) {
      if (cursors[b] < buckets[b].length) {
        out.push(buckets[b][cursors[b]++]);
        remaining--;
      }
    }
  }
  return out;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── ForYouCard component ──────────────────────────────────────────────
function ForYouCardComponent({ card, onSwipeLeft, onSwipeRight, onSwipeUp, onTap, isTop }: {
  card: ForYouCard;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onSwipeUp: () => void;
  onTap: () => void;
  isTop: boolean;
}) {
  const position     = useRef(new Animated.ValueXY()).current;
  const [isMuted, setIsMuted] = useState(true);
  const swipeStarted = useRef(false);

  const rotate      = position.x.interpolate({ inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2], outputRange: ['-8deg', '0deg', '8deg'], extrapolate: 'clamp' });
  const likeOpacity = position.x.interpolate({ inputRange: [0, 80],  outputRange: [0, 1], extrapolate: 'clamp' });
  const passOpacity = position.x.interpolate({ inputRange: [-80, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  const resetPosition = () => Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.sqrt(g.dx * g.dx + g.dy * g.dy) > 8,
    onPanResponderGrant: () => { swipeStarted.current = false; },
    onPanResponderMove: (_, g) => {
      if (Math.sqrt(g.dx * g.dx + g.dy * g.dy) > 10) swipeStarted.current = true;
      position.setValue({ x: g.dx, y: g.dy * 0.4 });
    },
    onPanResponderRelease: (_, g) => {
      const dist = Math.sqrt(g.dx * g.dx + g.dy * g.dy);
      if (!swipeStarted.current || dist < 8) { resetPosition(); onTap(); return; }
      if (g.dy < -80 && Math.abs(g.dy) > Math.abs(g.dx)) {
        Animated.timing(position, { toValue: { x: 0, y: -SCREEN_HEIGHT }, duration: 280, useNativeDriver: false }).start(onSwipeUp);
        return;
      }
      if (g.dx > 100) { Animated.timing(position, { toValue: { x: SCREEN_WIDTH + 100, y: 0 }, duration: 280, useNativeDriver: false }).start(onSwipeRight); return; }
      if (g.dx < -100) { Animated.timing(position, { toValue: { x: -SCREEN_WIDTH - 100, y: 0 }, duration: 280, useNativeDriver: false }).start(onSwipeLeft); return; }
      resetPosition();
    },
  })).current;

  return (
    <Animated.View
      {...(isTop ? panResponder.panHandlers : {})}
      style={{
        position: 'absolute',
        width: SCREEN_WIDTH - 32,
        height: SCREEN_HEIGHT * 0.65,
        borderRadius: 20,
        overflow: 'hidden',
        transform: isTop ? [{ translateX: position.x }, { translateY: position.y }, { rotate }] : [{ scale: 0.93 }],
        opacity: isTop ? 1 : 0.7,
        shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: isTop ? 10 : 5,
      }}
    >
      {card.type === 'video' ? (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <Video source={{ uri: card.videoUri || card.image }} style={{ width: '100%', height: '100%' }} resizeMode={ResizeMode.COVER} shouldPlay={isTop} isLooping isMuted={isMuted}/>
          <TouchableOpacity onPress={() => setIsMuted(p => !p)} style={{ position: 'absolute', bottom: 80, right: 14, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              {isMuted
                ? (<><Path d="M11 5L6 9H2v6h4l5 4V5z" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Path d="M23 9l-6 6M17 9l6 6" stroke="#fff" strokeWidth={1.8} strokeLinecap="round"/></>)
                : (<><Path d="M11 5L6 9H2v6h4l5 4V5z" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" stroke="#fff" strokeWidth={1.8} strokeLinecap="round"/></>)
              }
            </Svg>
          </TouchableOpacity>
        </View>
      ) : (
        <Image cachePolicy="memory-disk" source={{ uri: card.image }} style={StyleSheet.absoluteFillObject} contentFit="cover"/>
      )}

      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.2)' }}/>
      {isTop && <Animated.View style={{ position: 'absolute', top: 40, left: 20, opacity: likeOpacity, transform: [{ rotate: '-15deg' }] }}><View style={{ borderWidth: 3, borderColor: '#2a7a5a', borderRadius: 8, padding: 8 }}><Text style={{ color: '#2a7a5a', fontSize: 28, fontFamily: FONTS.display, letterSpacing: 2 }}>SAVE</Text></View></Animated.View>}
      {isTop && <Animated.View style={{ position: 'absolute', top: 40, right: 20, opacity: passOpacity, transform: [{ rotate: '15deg' }] }}><View style={{ borderWidth: 3, borderColor: '#e74c3c', borderRadius: 8, padding: 8 }}><Text style={{ color: '#e74c3c', fontSize: 28, fontFamily: FONTS.display, letterSpacing: 2 }}>PASS</Text></View></Animated.View>}

      <View style={{ position: 'absolute', top: 16, right: 16, backgroundColor: card.tagColor, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 }}>
        <Text style={{ color: '#fff', fontSize: 11, fontFamily: FONTS.medium, letterSpacing: 0.5 }}>{card.tag}</Text>
      </View>
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20 }}>
        <Text style={{ color: '#fff', fontSize: 24, fontFamily: FONTS.display, letterSpacing: -0.5, marginBottom: 4 }}>{card.title}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, fontFamily: FONTS.body }}>{card.subtitle}</Text>
        {(card.type === 'event' || card.type === 'venue') && card.data && (
          <View style={{ marginTop: 10 }}>
            <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#fff', fontSize: 12, fontFamily: FONTS.medium }}>Tap to view →</Text>
            </View>
          </View>
        )}
        {card.type === 'deal' && (
          <View style={{ marginTop: 10 }}>
            <View style={{ alignSelf: 'flex-start', backgroundColor: DEAL_COLOR, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#fff', fontSize: 12, fontFamily: FONTS.medium }}>🔥 Limited-time deal</Text>
            </View>
          </View>
        )}
        {card.type === 'gallery' && (
          <View style={{ marginTop: 10 }}>
            <View style={{ alignSelf: 'flex-start', backgroundColor: card.tagColor, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#fff', fontSize: 12, fontFamily: FONTS.medium }}>📸 Swipe right to save</Text>
            </View>
          </View>
        )}
        {card.type === 'food' && (
          <View style={{ marginTop: 10 }}>
            <View style={{ alignSelf: 'flex-start', backgroundColor: FOOD_COLOR, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#fff', fontSize: 12, fontFamily: FONTS.medium }}>🍽️ On the menu</Text>
            </View>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// Dynamic-import pattern (mirrors FavoritesScreen/analyticsService) so the
// auth native module is only touched from screens that need it. Falls back
// to a shared 'guest' bucket for signed-out browsing — the day cap is a
// soft per-device guardrail, not a per-account entitlement.
async function resolveForYouUserId(): Promise<string> {
  try {
    const { getAuth } = await import('@react-native-firebase/auth');
    return getAuth().currentUser?.uid || 'guest';
  } catch {
    return 'guest';
  }
}

// ── ForYouScreen ──────────────────────────────────────────────────────
type Props = {
  theme: Theme;
  onEventPress: (event: EventData) => void;
  onVenuePress: (venue: VenueData) => void;
  onFavoriteToggle: (item: FavoriteItem) => void;
  // Light personalization for injected deal cards (no recommendation engine):
  // prefer deals at saved venues or matching the user's vibes. Optional.
  userVibes?: string[];
  savedVenueIds?: string[];
};

export function ForYouScreen({ theme, onEventPress, onVenuePress, onFavoriteToggle, userVibes, savedVenueIds }: Props) {
  const [cards, setCards]           = useState<ForYouCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDone, setIsDone]         = useState(false);
  const [endReason, setEndReason]   = useState<'poolExhausted' | 'dayCap' | null>(null);
  const [status, setStatus]         = useState<'loading' | 'ready' | 'error'>('loading');

  // Resolved once per loadFeed() call — used for the day-cap counter key
  // and attached to nothing else (no PII beyond what's already the app's
  // own auth uid).
  const userIdRef      = useRef<string>('guest');
  // Set true the moment a view increments the counter past the cap; the
  // NEXT advance() (i.e. after the user acts on that last card) ends the
  // session instead of showing another suggestion.
  const capReachedRef  = useRef(false);
  // Guards the view-logging effect against re-firing for the same card on
  // re-render — tracks by card id (not index) so a loadFeed() reset back
  // to index 0 with fresh cards still logs the new card at that index.
  const loggedCardIdRef = useRef<string | null>(null);

  // Real data only — a failed fetch surfaces the error state (with retry)
  // instead of silently substituting mock cards.
  const loadFeed = () => {
    setStatus('loading');
    setIsDone(false);
    setEndReason(null);
    capReachedRef.current = false;
    loggedCardIdRef.current = null;

    resolveForYouUserId().then(async userId => {
      userIdRef.current = userId;
      if (await hasReachedDailyCap(userId)) {
        setCards([]);
        setCurrentIndex(0);
        setIsDone(true);
        setEndReason('dayCap');
        setStatus('ready');
        return;
      }

      try {
        const [{ events, venues }, rawDeals, galleries] = await Promise.all([
          getForYouFeed(userVibes),
          getDealsBrowse(40).catch(() => [] as FSDeal[]),
          getApprovedGalleries(30).catch(() => [] as GalleryDoc[]),
        ]);
        const menuItems = await getMenuItemsForVenues(venues.map(v => v.id), 2).catch(() => []);

        const categoryByVenueId = new Map(venues.map(v => [v.id, v.category || null]));
        const venueNameById     = new Map(venues.map(v => [v.id, v.name]));

        const eventCards = events.map(e => fsEventToCard(e, categoryByVenueId.get(e.venueId) ?? null));
        const venueCards = venues.map(fsVenueToCard);

        // Light deal preference: saved venues OR matching vibes; if nothing
        // matches, fall back to eligible deals so deals still appear.
        const eligible = orderDealsForDisplay(rawDeals);
        const savedSet = new Set(savedVenueIds || []);
        const vibeSet  = new Set((userVibes || []).map(v => v.toLowerCase()));
        const preferred = eligible.filter(d =>
          (d.venueId && savedSet.has(d.venueId)) ||
          (d.vibes || []).some(v => vibeSet.has(v.toLowerCase()))
        );
        const dealPool  = (preferred.length > 0 ? preferred : eligible).slice(0, 15);
        const dealCards = dealPool.map(d => fsDealToCard(d, categoryByVenueId.get(d.venueId) ?? null));

        const galleryCards = galleries.map(g => fsGalleryToCard(g, categoryByVenueId.get(g.venueId) ?? null));
        const foodCards    = menuItems.map(item =>
          fsMenuItemToCard(item, venueNameById.get(item.venueId) || 'Venue', categoryByVenueId.get(item.venueId) ?? null)
        );

        // Continuous suggestions: round-robin ALL 6 sources into one deep
        // pool instead of a fixed "every 3rd card" injection, so a small
        // source (a handful of menu items) still surfaces early rather
        // than being buried behind 30 events. The real stopping point is
        // the day cap below, not this pool's size.
        const pool = roundRobin([eventCards, venueCards, dealCards, galleryCards, foodCards]);

        const alreadyShown       = await getSuggestionCountToday(userId);
        const remainingAllowance = Math.max(0, DAILY_SUGGESTION_CAP - alreadyShown);
        const built = pool.slice(0, remainingAllowance);

        setCards(built);
        setCurrentIndex(0);
        setIsDone(false);
        setEndReason(null);
        setStatus('ready');
      } catch (e) {
        console.log('ForYouScreen: feed fetch failed', e);
        setStatus('error');
      }
    });
  };

  useEffect(() => {
    loadFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Log a 'view' + bump the daily counter exactly once per distinct card
  // shown as the top card — the raw signal Picks personalization (a
  // separate task) will train on.
  useEffect(() => {
    if (status !== 'ready' || isDone) return;
    const card = cards[currentIndex];
    if (!card || loggedCardIdRef.current === card.id) return;
    loggedCardIdRef.current = card.id;
    logForYouInteraction({ action: 'view', contentType: card.contentType || card.type, contentId: card.id, venueCategory: card.venueCategory ?? null });
    incrementSuggestionCount(userIdRef.current).then(count => {
      if (count >= DAILY_SUGGESTION_CAP) capReachedRef.current = true;
    });
  }, [cards, currentIndex, status, isDone]);

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} size="large"/>
        <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, marginTop: 12 }}>Loading for you...</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center' }}>
        <ErrorState theme={theme} onRetry={loadFeed}/>
      </View>
    );
  }

  // Continuous suggestions still need a real end — day cap hit (persists
  // for the rest of the day, no restart offered) or the fetched pool ran
  // dry (offers a Refresh, which re-fetches rather than replaying the
  // same deck). Checked BEFORE the "no content at all" empty state below
  // since a day-cap end can happen with an empty `cards` array too (cap
  // already hit before this load even fetched anything).
  if (isDone) {
    if (endReason === 'dayCap') {
      return (
        <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center' }}>
          <EmptyState
            theme={theme}
            title="That's today's picks!"
            message={`You've hit today's ${DAILY_SUGGESTION_CAP}-suggestion limit. Come back tomorrow for a fresh set of Atlanta nightlife and dining picks.`}
          />
        </View>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🎉</Text>
        <Text style={{ color: theme.text, fontSize: 22, fontFamily: FONTS.display, textAlign: 'center', marginBottom: 8 }}>You're all caught up!</Text>
        <Text style={{ color: theme.subtext, fontSize: 15, fontFamily: FONTS.body, textAlign: 'center', lineHeight: 22, marginBottom: 32 }}>Check back later for more Atlanta nightlife and dining recommendations.</Text>
        <TouchableOpacity style={{ backgroundColor: theme.accent, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 }} onPress={loadFeed}>
          <Text style={{ color: '#fff', fontSize: 15, fontFamily: FONTS.medium }}>Refresh</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Successful fetch, but no cards to deal — honest empty state, no mock deck.
  if (cards.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center' }}>
        <EmptyState
          theme={theme}
          title="You're early"
          message="Your personalized picks will appear as Atlanta venues add events."
        />
      </View>
    );
  }

  const advance = () => {
    if (capReachedRef.current) { setIsDone(true); setEndReason('dayCap'); return; }
    if (currentIndex >= cards.length - 1) { setIsDone(true); setEndReason('poolExhausted'); }
    else setCurrentIndex(p => p + 1);
  };

  const handleSwipeRight = () => {
    const card = cards[currentIndex];
    if (card.data) {
      if (card.type === 'event') onFavoriteToggle({ id: card.id, type: 'event', title: card.title, subtitle: card.subtitle, image: card.image, read: false, data: card.data as EventData });
      else if (card.type === 'venue') onFavoriteToggle({ id: card.id, type: 'venue', title: card.title, subtitle: card.subtitle, image: card.image, read: false, data: card.data as VenueData });
    } else if (card.photoId) {
      // Gallery/venue-photo card save — synthetic id must match the
      // `${galleryId}-${index}` contract other liked-photo flows rely on.
      onFavoriteToggle({ id: card.photoId, type: 'photo', title: card.title, subtitle: card.subtitle, image: card.image, read: false });
    }
    logForYouInteraction({ action: 'like', contentType: card.contentType || card.type, contentId: card.id, venueCategory: card.venueCategory ?? null });
    advance();
  };

  const handleSwipeLeft = () => {
    const card = cards[currentIndex];
    if (card) logForYouInteraction({ action: 'skip', contentType: card.contentType || card.type, contentId: card.id, venueCategory: card.venueCategory ?? null });
    advance();
  };

  const handleSwipeUp = () => {
    const card = cards[currentIndex];
    const newCards = [...cards];
    newCards.splice(currentIndex, 1);
    const insertAt = Math.min(currentIndex + 3, newCards.length);
    newCards.splice(insertAt, 0, card);
    setCards(newCards);
    if (currentIndex >= newCards.length) { setIsDone(true); setEndReason('poolExhausted'); }
  };

  const handleTap = () => {
    const card = cards[currentIndex];
    if (card.type === 'event' && card.data) onEventPress(card.data as EventData);
    else if (card.type === 'venue' && card.data) onVenuePress(card.data as VenueData);
  }

  const currentCard = cards[currentIndex];
  const nextCard    = cards[currentIndex + 1];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 36 }}/>
          <Text style={{ color: theme.accent, fontSize: 34, fontFamily: FONTS.display, letterSpacing: -1.4, lineHeight: 38 }}>wugi</Text>
          <View style={{ width: 36 }}/>
        </View>
        <View style={{ height: 3, backgroundColor: theme.divider, borderRadius: 2, marginTop: 10 }}>
          <View style={{ height: 3, backgroundColor: theme.accent, borderRadius: 2, width: `${(currentIndex / cards.length) * 100}%` as any }}/>
        </View>
        <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, textAlign: 'center', marginTop: 4 }}>{currentIndex + 1} of {cards.length}</Text>
      </SafeAreaView>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 20 }}>
        {nextCard && <ForYouCardComponent key={nextCard.id + '_next'} card={nextCard} isTop={false} onSwipeLeft={() => {}} onSwipeRight={() => {}} onSwipeUp={() => {}} onTap={() => {}}/>}
        {currentCard && <ForYouCardComponent key={currentCard.id} card={currentCard} isTop={true} onSwipeLeft={handleSwipeLeft} onSwipeRight={handleSwipeRight} onSwipeUp={handleSwipeUp} onTap={handleTap}/>}
      </View>

      <View style={{ alignItems: 'center', marginBottom: 10 }}>
        <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: FONTS.body }}>↑ Swipe up to see later</Text>
      </View>

      {/* Extra bottom padding (beyond SafeAreaView's own inset) so the X/heart
          CTAs fully clear the TabBar below instead of crowding it (UAT-A2 #3). */}
      <SafeAreaView style={{ paddingBottom: 24 + STATUS_BAR_H }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 48 }}>
          <TouchableOpacity onPress={handleSwipeLeft} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#e74c3c', alignItems: 'center', justifyContent: 'center', shadowColor: '#e74c3c', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}>
            <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
              <Path d="M18 6L6 18M6 6l12 12" stroke="#fff" strokeWidth={2.5} strokeLinecap="round"/>
            </Svg>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSwipeRight} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', shadowColor: theme.accent, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
            <Svg width={28} height={28} viewBox="0 0 24 24">
              <Path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" fill="#fff"/>
            </Svg>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}
