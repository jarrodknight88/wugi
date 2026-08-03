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
import type { EventData, VenueData, ForYouCard, FavoriteItem, FSDeal, GalleryDoc } from '../types';
import {
  getForYouFeed, getDealsBrowse, getApprovedGalleries, getMenuItemsBrowse, getVenueById,
  type FSEvent, type FSVenue, type MenuItemBrowseEntry,
} from '../../firestoreService';
import { ErrorState, EmptyState } from '../components/StateViews';
import { FONTS, MONO } from '../constants/fonts';
import { DEAL_COLOR } from '../components/DealCard';
import { dealTypeLabel, dealOffer, orderDealsForDisplay } from '../utils/deals';
import { formatEventDateShort } from '../utils/eventDateTime';
import { buildPhotoId } from '../utils/photoId';
import { getRemainingSuggestions, recordSuggestionShown, FOR_YOU_DAILY_CAP } from '../utils/forYouSuggestionCap';
import { logForYouInteraction } from '../analytics/analyticsService';

// Status-bar inset (expo-constants — the app doesn't depend on
// react-native-safe-area-context). Reused below as extra bottom clearance
// for the swipe CTA row so it never sits close to the TabBar (UAT-A2 #3).
const STATUS_BAR_H = Constants.statusBarHeight ?? 0;

// Content type as logged to analytics (UAT-W2D) — finer-grained than
// ForYouCard['type'] since Gallery Photos and Venue Photos share the card
// type ('gallery') but are distinct suggestion sources per the audit.
type ForYouContentType = 'event' | 'venue' | 'deal' | 'gallery_photo' | 'venue_photo' | 'food';

const GALLERY_PHOTO_COLOR = '#0891b2';
const VENUE_PHOTO_COLOR   = '#0e7490';
const FOOD_COLOR          = '#d4a85c';

function fsEventToCard(e: FSEvent): ForYouCard {
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
  };
}

// Deals render as swipe cards (NOT the DealCard) — deal type as the tag,
// venue + offer as title/subtitle. Non-navigating (data:null) like a teaser.
function fsDealToCard(d: FSDeal): ForYouCard {
  const offer = dealOffer(d);
  return {
    id: `deal_${d.id}`, type: 'deal',
    title: d.title,
    subtitle: offer ? `${d.venueName} · ${offer}` : d.venueName,
    image: d.image || `https://picsum.photos/seed/deal-${d.id}/600/900`,
    tag: dealTypeLabel(d.dealType), tagColor: DEAL_COLOR,
    data: null,
  };
}

// Gallery/Venue Photo suggestion cards (UAT-W2D audit — these two content
// types didn't feed For You before). Both read the same top-level
// `galleries` collection; the split is whether the gallery is linked to an
// event (Gallery Photo) or not (Venue Photo, e.g. venue ambiance shots).
// Card id is the synthetic `${galleryId}-${index}` photo id (see
// utils/photoId) at index 0 (the gallery's lead/cover photo) — swiping right
// favorites it as a 'photo' FavoriteItem, preserving the id contract that
// PhotoViewer/RootNavigator/spendFreeUnlock also rely on. Non-navigating
// (data:null), like deal cards — there's no photo-detail destination from a
// suggestion-card tap today.
function fsGalleryToCard(
  g: GalleryDoc,
  contentType: 'gallery_photo' | 'venue_photo',
  venueName: string,
): ForYouCard {
  const images = (g.images || []).filter(Boolean);
  const image = g.coverImage || images[0] || `https://picsum.photos/seed/gallery-${g.id}/600/900`;
  const dateLabel = formatEventDateShort(g.date);
  return {
    id: buildPhotoId(g.id, 0),
    type: 'gallery',
    title: g.title || venueName || 'Photo',
    subtitle: dateLabel ? `${venueName} · ${dateLabel}` : venueName,
    image,
    tag: contentType === 'gallery_photo' ? 'Gallery Photo' : 'Venue Photo',
    tagColor: contentType === 'gallery_photo' ? GALLERY_PHOTO_COLOR : VENUE_PHOTO_COLOR,
    data: null,
  };
}

// Food/Menu Item suggestion cards (UAT-W2D audit — new source, backed by the
// new getMenuItemsBrowse() collectionGroup fetcher). Non-navigating
// (data:null) — MenuItemScreen needs a venueId/venueName/MenuItem triple via
// NavEntry['menuItem'], which onEventPress/onVenuePress don't carry; adding a
// new nav callback is out of this screen's lane, so — like deal cards — the
// suggestion card itself is a teaser, not a tap-through.
function fsMenuItemToCard(entry: MenuItemBrowseEntry): ForYouCard {
  const { item, venueName } = entry;
  return {
    id: `food_${entry.venueId}_${item.id}`,
    type: 'food',
    title: item.name,
    subtitle: item.priceDisplay ? `${venueName} · ${item.priceDisplay}` : venueName,
    image: item.imageUrl || `https://picsum.photos/seed/food-${item.id}/600/900`,
    tag: 'Menu Pick', tagColor: FOOD_COLOR,
    data: null,
  };
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
      </View>
    </Animated.View>
  );
}

// ── Friendly end-states (UAT-W2D — the deck must never just go blank) ──
function CaughtUpEndState({ theme, onRestart }: { theme: Theme; onRestart: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
      <Text style={{ fontSize: 48, marginBottom: 16 }}>🎉</Text>
      <Text style={{ color: theme.text, fontSize: 22, fontFamily: FONTS.display, textAlign: 'center', marginBottom: 8 }}>You're all caught up!</Text>
      <Text style={{ color: theme.subtext, fontSize: 15, fontFamily: FONTS.body, textAlign: 'center', lineHeight: 22, marginBottom: 32 }}>Check back later for more Atlanta nightlife and dining recommendations.</Text>
      <TouchableOpacity style={{ backgroundColor: theme.accent, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 }} onPress={onRestart}>
        <Text style={{ color: '#fff', fontSize: 15, fontFamily: FONTS.medium }}>Start Over</Text>
      </TouchableOpacity>
    </View>
  );
}

function DailyCapEndState({ theme }: { theme: Theme }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
      <Text style={{ fontSize: 48, marginBottom: 16 }}>✨</Text>
      <Text style={{ color: theme.text, fontSize: 22, fontFamily: FONTS.display, textAlign: 'center', marginBottom: 8 }}>That's today's picks!</Text>
      <Text style={{ color: theme.subtext, fontSize: 15, fontFamily: FONTS.body, textAlign: 'center', lineHeight: 22 }}>
        You've hit today's {FOR_YOU_DAILY_CAP}-suggestion limit. Come back tomorrow for a fresh set of Atlanta nightlife picks.
      </Text>
    </View>
  );
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
  const [status, setStatus]         = useState<'loading' | 'ready' | 'error'>('loading');
  // 'pool'  — every fetched source is exhausted, but today's cap has room left.
  // 'cap'   — the daily suggestion cap is what ended the session, not content.
  const [endReason, setEndReason]   = useState<'pool' | 'cap'>('pool');
  const [dayCapped, setDayCapped]   = useState(false);

  // Per-card logging metadata (content type + venue category), keyed by
  // card.id. Kept alongside `cards` rather than on ForYouCard itself so the
  // Gallery Photo / Venue Photo split (same card `type`, different analytics
  // content_type) doesn't need a shared-type change.
  const cardMetaRef = useRef(new Map<string, { contentType: ForYouContentType; venueCategory: string | null }>());
  const lastLoggedIdRef = useRef<string | null>(null);

  // Real data only — a failed fetch surfaces the error state (with retry)
  // instead of silently substituting mock cards.
  const loadFeed = async () => {
    setStatus('loading');
    setDayCapped(false);
    setIsDone(false);

    // Cap check FIRST — a lightweight local read, so an already-exhausted day
    // never costs a Firestore fetch.
    const remainingAtLoad = await getRemainingSuggestions();
    if (remainingAtLoad <= 0) {
      cardMetaRef.current.clear();
      lastLoggedIdRef.current = null;
      setCards([]);
      setDayCapped(true);
      setStatus('ready');
      return;
    }

    try {
      const [{ events, venues }, rawDeals, galleries, menuItems] = await Promise.all([
        getForYouFeed(userVibes),
        getDealsBrowse(60).catch(() => [] as FSDeal[]),
        getApprovedGalleries(80).catch(() => [] as GalleryDoc[]),
        getMenuItemsBrowse(60).catch(() => [] as MenuItemBrowseEntry[]),
      ]);

      // Venue name/category lookup for gallery-sourced cards. Start from the
      // venues already fetched for the venue-card source, then resolve any
      // additional venueIds galleries reference but that fetch didn't cover
      // (galleries aren't limited to the same venue set) — bounded by the
      // number of distinct venues behind this session's galleries, not by
      // gallery count.
      const venueById = new Map<string, FSVenue>(venues.map(v => [v.id, v]));
      const missingVenueIds = Array.from(new Set(
        galleries.map(g => g.venueId).filter(id => id && !venueById.has(id))
      ));
      if (missingVenueIds.length > 0) {
        const fetched = await Promise.all(missingVenueIds.map(id => getVenueById(id).catch(() => null)));
        fetched.forEach((v, i) => { if (v) venueById.set(missingVenueIds[i], v); });
      }

      const meta = new Map<string, { contentType: ForYouContentType; venueCategory: string | null }>();

      const eventCards = events.map(e => {
        const card = fsEventToCard(e);
        meta.set(card.id, { contentType: 'event', venueCategory: (e.venueId && venueById.get(e.venueId)?.category) || null });
        return card;
      });

      const venueCards = venues.map(v => {
        const card = fsVenueToCard(v);
        meta.set(card.id, { contentType: 'venue', venueCategory: v.category || null });
        return card;
      });

      // Light deal preference: saved venues OR matching vibes; if nothing
      // matches, fall back to eligible deals so deals still appear. Cap
      // raised from 5 to 25 (continuous-suggestions pass) so this source
      // doesn't dry up well ahead of the others.
      const eligible = orderDealsForDisplay(rawDeals);
      const savedSet = new Set(savedVenueIds || []);
      const vibeSet  = new Set((userVibes || []).map(v => v.toLowerCase()));
      const preferred = eligible.filter(d =>
        (d.venueId && savedSet.has(d.venueId)) ||
        (d.vibes || []).some(v => vibeSet.has(v.toLowerCase()))
      );
      const dealPool = (preferred.length > 0 ? preferred : eligible).slice(0, 25);
      const dealCards = dealPool.map(d => {
        const card = fsDealToCard(d);
        meta.set(card.id, { contentType: 'deal', venueCategory: (d.venueId && venueById.get(d.venueId)?.category) || null });
        return card;
      });

      // Gallery Photos (event-linked) vs Venue Photos (not linked to any
      // event) — the audit's two missing photo sources, both backed by the
      // same top-level `galleries` collection, split on `eventId`.
      const galleryPhotoCards: ForYouCard[] = [];
      const venuePhotoCards: ForYouCard[] = [];
      galleries.forEach(g => {
        const images = (g.images || []).filter(Boolean);
        if (images.length === 0 && !g.coverImage) return; // nothing to show
        const venue = venueById.get(g.venueId);
        const venueName = venue?.name || 'Wugi';
        const contentType: 'gallery_photo' | 'venue_photo' = g.eventId ? 'gallery_photo' : 'venue_photo';
        const card = fsGalleryToCard(g, contentType, venueName);
        meta.set(card.id, { contentType, venueCategory: venue?.category || null });
        (contentType === 'gallery_photo' ? galleryPhotoCards : venuePhotoCards).push(card);
      });

      // Food/Menu Items — new source, backed by getMenuItemsBrowse().
      const foodCards = menuItems.map(entry => {
        const card = fsMenuItemToCard(entry);
        meta.set(card.id, { contentType: 'food', venueCategory: entry.venueCategory || null });
        return card;
      });

      // Round-robin interleave across all 6 sources so no single source
      // dominates the deck and the feed stays varied as sources deplete at
      // different rates (continuous-suggestions pass — replaces the old
      // fixed events/venues interleave + "inject a deal every 3rd").
      const sourceLists = [eventCards, venueCards, dealCards, galleryPhotoCards, venuePhotoCards, foodCards];
      const maxLen = Math.max(0, ...sourceLists.map(l => l.length));
      const built: ForYouCard[] = [];
      for (let i = 0; i < maxLen; i++) {
        for (const list of sourceLists) {
          if (list[i]) built.push(list[i]);
        }
      }

      cardMetaRef.current = meta;
      lastLoggedIdRef.current = null;

      if (built.length === 0) {
        setCards([]);
        setCurrentIndex(0);
        setStatus('ready');
        return;
      }

      // Cap enforcement: never show more than remainingAtLoad cards this
      // session. If that's fewer than the full pool, the eventual end-state
      // is the daily-cap message, not "you're all caught up".
      const sliceLen = Math.min(built.length, remainingAtLoad);
      setEndReason(remainingAtLoad < built.length ? 'cap' : 'pool');
      setCards(built.slice(0, sliceLen));
      setCurrentIndex(0);
      setStatus('ready');
    } catch (e) {
      console.log('ForYouScreen: feed fetch failed', e);
      setStatus('error');
    }
  };

  useEffect(() => {
    loadFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Log a 'view' + advance the daily cap counter exactly once per genuine
  // transition to a new top card (guarded by lastLoggedIdRef, not the index,
  // so a swiped-up card that reappears later at a different index re-logs a
  // fresh view rather than being silently skipped).
  useEffect(() => {
    if (status !== 'ready' || isDone || dayCapped) return;
    const card = cards[currentIndex];
    if (!card || lastLoggedIdRef.current === card.id) return;
    lastLoggedIdRef.current = card.id;
    const m = cardMetaRef.current.get(card.id);
    recordSuggestionShown();
    logForYouInteraction({ action: 'view', contentType: m?.contentType ?? 'event', venueCategory: m?.venueCategory ?? null });
  }, [currentIndex, cards, status, isDone, dayCapped]);

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

  if (dayCapped) {
    return <DailyCapEndState theme={theme}/>;
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
    if (currentIndex >= cards.length - 1) setIsDone(true);
    else setCurrentIndex(p => p + 1);
  };

  const logSwipe = (card: ForYouCard, action: 'like' | 'skip') => {
    const m = cardMetaRef.current.get(card.id);
    logForYouInteraction({ action, contentType: m?.contentType ?? 'event', venueCategory: m?.venueCategory ?? null });
  };

  const handleSwipeRight = () => {
    const card = cards[currentIndex];
    if (card) {
      if (card.data) {
        if (card.type === 'event') onFavoriteToggle({ id: card.id, type: 'event', title: card.title, subtitle: card.subtitle, image: card.image, read: false, data: card.data as EventData });
        else if (card.type === 'venue') onFavoriteToggle({ id: card.id, type: 'venue', title: card.title, subtitle: card.subtitle, image: card.image, read: false, data: card.data as VenueData });
      } else if (card.type === 'gallery') {
        // card.id is already the synthetic `${galleryId}-${index}` photo id —
        // preserve that contract for the Saved-tab / PhotoViewer hydration path.
        onFavoriteToggle({ id: card.id, type: 'photo', title: card.title, subtitle: card.subtitle, image: card.image, read: false });
      }
      logSwipe(card, 'like');
    }
    advance();
  };

  const handleSwipeLeft = () => {
    const card = cards[currentIndex];
    if (card) logSwipe(card, 'skip');
    advance();
  };

  const handleSwipeUp = () => {
    const card = cards[currentIndex];
    const newCards = [...cards];
    newCards.splice(currentIndex, 1);
    const insertAt = Math.min(currentIndex + 3, newCards.length);
    newCards.splice(insertAt, 0, card);
    setCards(newCards);
    if (currentIndex >= newCards.length) setIsDone(true);
  };

  const handleTap = () => {
    const card = cards[currentIndex];
    if (card.type === 'event' && card.data) onEventPress(card.data as EventData);
    else if (card.type === 'venue' && card.data) onVenuePress(card.data as VenueData);
  };

  // Re-checks the cap before allowing a restart — otherwise looping "Start
  // Over" on an exhausted-pool deck could quietly blow past the daily cap
  // across repeated passes through the same cards within one session.
  const handleRestart = async () => {
    const remaining = await getRemainingSuggestions();
    if (remaining <= 0) {
      setDayCapped(true);
      setIsDone(false);
      return;
    }
    lastLoggedIdRef.current = null;
    setCurrentIndex(0);
    setIsDone(false);
  };

  if (isDone) {
    return endReason === 'cap'
      ? <DailyCapEndState theme={theme}/>
      : <CaughtUpEndState theme={theme} onRestart={handleRestart}/>;
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
