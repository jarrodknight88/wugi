// ─────────────────────────────────────────────────────────────────────
// Wugi — ForYouScreen
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, Animated, PanResponder, StyleSheet, Dimensions, ActivityIndicator,  } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { Video, ResizeMode } from 'expo-av';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, ForYouCard, FavoriteItem, FSDeal, GalleryDoc, MenuItem } from '../types';
import { getForYouFeed, getDealsBrowse, getApprovedGalleries, getMenuItemsBrowse, type FSEvent, type FSVenue } from '../../firestoreService';
import { ErrorState, EmptyState } from '../components/StateViews';
import { FONTS, MONO } from '../constants/fonts';
import { DEAL_COLOR } from '../components/DealCard';
import { dealTypeLabel, dealOffer, orderDealsForDisplay } from '../utils/deals';
import { buildPhotoId } from '../utils/photoId';
import { FOR_YOU_DAILY_CAP, getRemainingSuggestions, recordSuggestionsShown } from '../utils/forYouSuggestionCap';
import { logForYouInteraction } from '../analytics/analyticsService';

// ── Content-source audit (UAT-W2D) ─────────────────────────────────────
// Required set: Events, Gallery Photos, Venue Photos, Deals, Food/Menu Items.
//   Events            — pre-existing (fsEventToCard, getForYouFeed→getApprovedEvents)
//   Deals             — pre-existing (fsDealToCard, getDealsBrowse)
//   Venues            — pre-existing, kept (not in the required set, but
//                        already a working suggestion source with its own
//                        full-profile tap-through — no reason to remove it)
//   Gallery Photos    — ADDED: event-linked galleries (GalleryDoc.eventId
//                        truthy) via getApprovedGalleries, one card per photo
//   Venue Photos      — ADDED: venue-only galleries (GalleryDoc.eventId
//                        absent) via the same getApprovedGalleries call
//   Food/Menu Items   — ADDED: venues/{venueId}/menu subcollection via a new
//                        getMenuItemsBrowse collectionGroup query (no
//                        cross-venue "menu" fetcher existed before this)
// See PR description for the full before/after table.

const PER_GALLERY_PHOTO_CAP = 2;   // cards drawn from a single gallery doc
const GALLERY_BUCKET_CAP    = 24;  // total Gallery Photo cards per load
const VENUE_PHOTO_BUCKET_CAP = 24; // total Venue Photo cards per load
const FOOD_BUCKET_CAP       = 24;  // total Food/Menu cards per load
const DEAL_BUCKET_CAP       = 5;

function fsEventToCard(e: FSEvent): ForYouCard {
  return {
    id: e.id, type: 'event',
    title: e.title, subtitle: `${e.venue} · ${e.date}`,
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

// Gallery/venue photo cards are non-navigating teasers (data:null), like
// deals — but liking one must still produce the synthetic `${galleryId}-${index}`
// favorite id (utils/photoId.ts) so it lands correctly in Saved / PhotoViewer.
function galleryDocToPhotoCards(
  g: GalleryDoc,
  kind: 'gallery' | 'venuePhoto',
  venueName: string | undefined,
): ForYouCard[] {
  const images = (g.images || []).filter(Boolean).slice(0, PER_GALLERY_PHOTO_CAP);
  const tag      = kind === 'gallery' ? 'Gallery' : 'Venue Photo';
  const tagColor = kind === 'gallery' ? '#b8478f' : '#1f8fa3';
  return images.map((uri, i) => ({
    id: buildPhotoId(g.id, i),
    type: kind,
    title: g.title || (kind === 'gallery' ? 'Event Photos' : 'Venue Photos'),
    subtitle: venueName || g.date || 'Atlanta nightlife',
    image: uri,
    tag, tagColor,
    data: null,
  }));
}

// Food/menu cards are non-navigating teasers too — MenuItem isn't a
// ForYouCard.data payload type, and MenuScreen's own notes confirm most
// items have no per-item image yet, hence the placeholder fallback.
function menuItemToCard(item: MenuItem & { venueId: string }, venueName: string | undefined): ForYouCard {
  return {
    id: `food_${item.venueId}_${item.id}`,
    type: 'food',
    title: item.name,
    subtitle: [venueName, item.priceDisplay].filter(Boolean).join(' · ') || 'On the menu',
    image: item.imageUrl || `https://picsum.photos/seed/food-${item.venueId}-${item.id}/600/900`,
    tag: 'Food', tagColor: '#e08a1e',
    data: null,
  };
}

// Round-robin across every non-empty source bucket so the deck stays mixed
// regardless of which optional sources (galleries, menu items) are
// populated for a given catalog snapshot.
function interleaveBuckets(buckets: ForYouCard[][]): ForYouCard[] {
  const out: ForYouCard[] = [];
  const queues = buckets.map(b => [...b]);
  let hasMore = true;
  while (hasMore) {
    hasMore = false;
    for (const q of queues) {
      const next = q.shift();
      if (next) { out.push(next); hasMore = true; }
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
        {(card.type === 'gallery' || card.type === 'venuePhoto') && (
          <View style={{ marginTop: 10 }}>
            <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#fff', fontSize: 12, fontFamily: FONTS.medium }}>❤️ Swipe right to save</Text>
            </View>
          </View>
        )}
      </View>
    </Animated.View>
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
  const [dayCapped, setDayCapped]   = useState(false);
  const [status, setStatus]         = useState<'loading' | 'ready' | 'error'>('loading');

  // Local mirror of the persisted daily-cap counter (utils/forYouSuggestionCap).
  // A ref (not state) because it's read/written on every swipe and must never
  // trigger a re-render on its own — only isDone/dayCapped drive the UI.
  const remainingRef = useRef<number>(FOR_YOU_DAILY_CAP);
  // Best-effort card id → venue category, for interaction logging only.
  const cardCategoryRef = useRef<Map<string, string | null>>(new Map());

  // Real data only — a failed fetch surfaces the error state (with retry)
  // instead of silently substituting mock cards.
  const loadFeed = () => {
    setStatus('loading');
    setIsDone(false);
    setDayCapped(false);

    getRemainingSuggestions().then(remaining => {
      remainingRef.current = remaining;
      if (remaining <= 0) {
        setCards([]);
        setCurrentIndex(0);
        setDayCapped(true);
        setIsDone(true);
        setStatus('ready');
        return;
      }

      Promise.all([
        getForYouFeed(userVibes),
        getDealsBrowse(40).catch(() => [] as FSDeal[]),
        getApprovedGalleries(50).catch(() => [] as GalleryDoc[]),
        getMenuItemsBrowse(FOOD_BUCKET_CAP).catch(() => [] as (MenuItem & { venueId: string })[]),
      ])
        .then(([{ events, venues }, rawDeals, rawGalleries, rawMenuItems]) => {
          const venueById = new Map(venues.map(v => [v.id, v]));
          const categoryOf = (venueId: string | undefined | null): string | null =>
            (venueId && venueById.get(venueId)?.category) || null;
          const categoryMap = new Map<string, string | null>();

          const eventCards = events.map(e => {
            const card = fsEventToCard(e);
            categoryMap.set(card.id, categoryOf(e.venueId));
            return card;
          });
          const venueCards = venues.map(v => {
            const card = fsVenueToCard(v);
            categoryMap.set(card.id, v.category || null);
            return card;
          });

          // Light deal preference: saved venues OR matching vibes; if nothing
          // matches, fall back to a few eligible deals so deals still appear.
          const eligible = orderDealsForDisplay(rawDeals);
          const savedSet = new Set(savedVenueIds || []);
          const vibeSet  = new Set((userVibes || []).map(v => v.toLowerCase()));
          const preferred = eligible.filter(d =>
            (d.venueId && savedSet.has(d.venueId)) ||
            (d.vibes || []).some(v => vibeSet.has(v.toLowerCase()))
          );
          const dealPool = (preferred.length > 0 ? preferred : eligible).slice(0, DEAL_BUCKET_CAP);
          const dealCards = dealPool.map(d => {
            const card = fsDealToCard(d);
            categoryMap.set(card.id, categoryOf(d.venueId));
            return card;
          });

          // Gallery Photos = event-linked galleries; Venue Photos = the rest
          // (venue-only galleries, no eventId). Same source query, split
          // client-side — see the audit comment above.
          const galleryPhotoCards: ForYouCard[] = [];
          const venuePhotoCards: ForYouCard[] = [];
          for (const g of rawGalleries) {
            if (galleryPhotoCards.length >= GALLERY_BUCKET_CAP && venuePhotoCards.length >= VENUE_PHOTO_BUCKET_CAP) break;
            const venueName = g.venueId ? venueById.get(g.venueId)?.name : undefined;
            const kind = g.eventId ? 'gallery' : 'venuePhoto';
            const built = galleryDocToPhotoCards(g, kind, venueName);
            for (const c of built) {
              categoryMap.set(c.id, categoryOf(g.venueId));
              if (kind === 'gallery' && galleryPhotoCards.length < GALLERY_BUCKET_CAP) galleryPhotoCards.push(c);
              else if (kind === 'venuePhoto' && venuePhotoCards.length < VENUE_PHOTO_BUCKET_CAP) venuePhotoCards.push(c);
            }
          }

          const foodCards = rawMenuItems.slice(0, FOOD_BUCKET_CAP).map(item => {
            const card = menuItemToCard(item, venueById.get(item.venueId)?.name);
            categoryMap.set(card.id, categoryOf(item.venueId));
            return card;
          });

          cardCategoryRef.current = categoryMap;

          const built = interleaveBuckets([
            eventCards, venueCards, dealCards, galleryPhotoCards, venuePhotoCards, foodCards,
          ]);

          setCards(built);
          setCurrentIndex(0);
          setStatus('ready');
        })
        .catch(e => {
          console.log('ForYouScreen: feed fetch failed', e);
          setStatus('error');
        });
    });
  };

  useEffect(() => {
    loadFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logInteraction = (action: 'view' | 'like' | 'skip', card: ForYouCard) => {
    logForYouInteraction({
      action,
      contentType: card.type,
      contentId: card.id,
      venueCategory: cardCategoryRef.current.get(card.id) ?? null,
    });
  };

  // Fires once per card actually shown to the user (initial load + every
  // advance). Background-only: logs the "view" interaction and updates the
  // persisted daily-suggestion counter. Never itself changes what's
  // rendered — the cap is only enforced at the next swipe, in advance(),
  // so a card the user is actively looking at is never yanked away.
  useEffect(() => {
    if (status !== 'ready' || isDone) return;
    const card = cards[currentIndex];
    if (!card) return;
    logInteraction('view', card);
    recordSuggestionsShown(1).then(remaining => { remainingRef.current = remaining; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, cards, status, isDone]);

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

  // Successful fetch, but no cards to deal — honest empty state, no mock deck.
  // (Day-capped-with-zero-cards also lands here structurally but is caught by
  // the isDone branch below before this renders, since isDone is set first.)
  if (cards.length === 0 && !isDone) {
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
    if (remainingRef.current <= 0) { setDayCapped(true); setIsDone(true); return; }
    if (currentIndex >= cards.length - 1) { setIsDone(true); return; }
    setCurrentIndex(p => p + 1);
  };

  const handleSwipeRight = () => {
    const card = cards[currentIndex];
    if (card.type === 'event' && card.data) {
      onFavoriteToggle({ id: card.id, type: 'event', title: card.title, subtitle: card.subtitle, image: card.image, read: false, data: card.data as EventData });
    } else if (card.type === 'venue' && card.data) {
      onFavoriteToggle({ id: card.id, type: 'venue', title: card.title, subtitle: card.subtitle, image: card.image, read: false, data: card.data as VenueData });
    } else if (card.type === 'gallery' || card.type === 'venuePhoto') {
      // Preserve the synthetic ${galleryId}-${index} favorite id contract —
      // card.id was already built with buildPhotoId at construction time.
      onFavoriteToggle({ id: card.id, type: 'photo', title: card.title, subtitle: card.subtitle, image: card.image, read: false });
    }
    logInteraction('like', card);
    advance();
  };

  const handleSwipeLeft = () => {
    logInteraction('skip', cards[currentIndex]);
    advance();
  };

  const handleSwipeUp = () => {
    const card = cards[currentIndex];
    logInteraction('skip', card); // deferred (watch-later), not a like — logged as skip
    const newCards = [...cards];
    newCards.splice(currentIndex, 1);
    const insertAt = Math.min(currentIndex + 3, newCards.length);
    newCards.splice(insertAt, 0, card);
    setCards(newCards);
    if (remainingRef.current <= 0) { setDayCapped(true); setIsDone(true); return; }
    if (currentIndex >= newCards.length) setIsDone(true);
  };

  const handleTap = () => {
    const card = cards[currentIndex];
    if (card.type === 'event' && card.data) onEventPress(card.data as EventData);
    else if (card.type === 'venue' && card.data) onVenuePress(card.data as VenueData);
  };

  if (isDone) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>{dayCapped ? '⏳' : '🎉'}</Text>
        <Text style={{ color: theme.text, fontSize: 22, fontFamily: FONTS.display, textAlign: 'center', marginBottom: 8 }}>
          {dayCapped ? "That's today's suggestions!" : "You're all caught up!"}
        </Text>
        <Text style={{ color: theme.subtext, fontSize: 15, fontFamily: FONTS.body, textAlign: 'center', lineHeight: 22, marginBottom: 32 }}>
          {dayCapped
            ? `You've hit today's ${FOR_YOU_DAILY_CAP}-suggestion limit. Come back tomorrow for more Atlanta nightlife and dining recommendations.`
            : 'Check back later for more Atlanta nightlife and dining recommendations.'}
        </Text>
        {!dayCapped && (
          <TouchableOpacity style={{ backgroundColor: theme.accent, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 }} onPress={loadFeed}>
            <Text style={{ color: '#fff', fontSize: 15, fontFamily: FONTS.medium }}>Refresh</Text>
          </TouchableOpacity>
        )}
      </View>
    );
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

      <View style={{ alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: FONTS.body }}>↑ Swipe up to see later</Text>
      </View>

      <SafeAreaView style={{ paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 40 }}>
          <TouchableOpacity onPress={handleSwipeLeft} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#e74c3c', alignItems: 'center', justifyContent: 'center', shadowColor: '#e74c3c', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}>
            <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
              <Path d="M18 6L6 18M6 6l12 12" stroke="#fff" strokeWidth={2.5} strokeLinecap="round"/>
            </Svg>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSwipeRight} style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', shadowColor: theme.accent, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
            <Svg width={28} height={28} viewBox="0 0 24 24">
              <Path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" fill="#fff"/>
            </Svg>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}
