// ─────────────────────────────────────────────────────────────────────
// Wugi — VenueScreen   (v2 — sectional rebuild against the kit JSX)
//
// Ported from ui_kits/consumer-app/VenueScreen.jsx in wugi-design-system.
// The diagnostic established this screen had its Path 3 baseline + UAT-V3
// polish but never received the structural visual pass EventScreen got;
// this commit closes that gap.
//
// Sectional structure (top → bottom):
//   1. Hero — paged carousel + parchment venue name overlay
//   2. Category line (the stats trio was removed to match the design —
//      see the note by the amenityList derivation; data still on venue).
//   3. VenueContactBlock — "FIND US" · 64×64 logo/initials · underlined
//      accent address + phone · chevron that expands hours / website /
//      instagram inline (mirrors EventScreen's VenueIdentityBlock idiom;
//      replaces the old standalone HOURS & INFO block).
//   4. VenueAboutBlock — "ABOUT THE PLACE" · paragraph only
//   5. VenueMenuBlock — "MENU" eyebrow + "View All" link + real-data
//      teaser (engrained section, matches Event's 803d69a pattern).
//   6. VenueAttributesStrip — "WHAT TO EXPECT" · inline middot-separated
//      text strip built from venue.amenities (or attributes fallback).
//   7. VenueUpcomingEventsBlock — "HAPPENING HERE · N UPCOMING"
//      horizontal scroller of 200-wide cards with date-badge top-left.
//   8. VenueGalleriesGrid — "GALLERIES · N NIGHTS" · 2-col aspect-1
//      grid; "All →" link when >4 galleries pushes the new
//      VenueGalleriesListScreen via onAllGalleries.
//   9. Sticky CTAs — Get Tickets (when active event) over Directions +
//      Reserve (when reservation URL present).
//
// Type via FONTS.* (PP Neue Montreal); MONO for eyebrows.
// Real-data-only: any section with no backing data is omitted.
//
// VenueIdentityBlock and useVenueById are intentionally NOT touched here.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, FlatList, Dimensions, Linking, NativeSyntheticEvent, NativeScrollEvent, ActionSheetIOS, Platform, Alert, Share } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, GalleryData, GalleryDoc, FavoriteItem } from '../types';
import { BackIcon, ChevronRightIcon, ChevronDownIcon, GlobeIcon, InstagramIcon, LocationIcon, KebabVerticalIcon } from '../components/icons';
import { FONTS, MONO } from '../constants/fonts';
import { makeGallery } from '../constants/mockData';
// Reuse the SAME series-collapse the marquee uses (one card per series, soonest
// eligible, expired dropped) — do not reimplement. Exported from firestoreService.
import { computeSeriesFeed } from '../../firestoreService';
// Shared event card — the SAME card as the home "Picks for you" feed.
import { VibeEventCard } from '../components/VibeEventCard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = Math.round(SCREEN_WIDTH / 1.2);
const GALLERY_PURPLE = '#9b59b6';
const GALLERIES_INLINE_MAX = 4;
const UPCOMING_INLINE_MAX = 5;
const UPCOMING_CARD_W = SCREEN_WIDTH - 32;
const GALLERY_GRID_GUTTER  = 16;
const GALLERY_GRID_GAP     = 8;
const GALLERY_CARD_W = (SCREEN_WIDTH - GALLERY_GRID_GUTTER * 2 - GALLERY_GRID_GAP) / 2;

// Clock glyph for the FIND US "hours" expansion row (15×15, viewBox 24) —
// the only amenity SVG still needed now that WHAT TO EXPECT is a text strip.
const CLOCK_PATH = 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z';

type ActiveTicketEvent = {
  id: string;
  name: string;
  date: string;
  time: string;
};

type Props = {
  venue: VenueData;
  onBack: () => void;
  onEventPress: (event: EventData) => void;
  onMapPress: () => void;
  onGalleryPress: (gallery: GalleryData) => void;
  onMenuPress?: () => void;
  onGetTickets?: (event: ActiveTicketEvent) => void;
  // UAT-V3 follow-up A (additive): "Save Venue" inside the kebab overflow
  // menu calls this with a FavoriteItem so the navigator can toggle favorites
  // using the same store EventScreen / FavoritesScreen use. Absent → Save
  // option is omitted from the menu (no parallel persistence path).
  onFavoriteToggle?: (item: FavoriteItem) => void;
  // Venue v2 (additive): "All →" link on the Galleries section pushes the
  // VenueGalleriesListScreen. Hidden if the prop is absent or there are
  // ≤ GALLERIES_INLINE_MAX galleries (no overflow to link to).
  onAllGalleries?: (venueId: string) => void;
  // UAT V10 Venue #1/#2 (additive): "View all" link on the upcoming-events
  // section pushes the VenueEventsListScreen. Hidden if absent or there are
  // ≤ UPCOMING_INLINE_MAX collapsed cards (nothing to overflow to).
  onAllEvents?: (venueId: string) => void;
  theme: Theme;
};

// ── Section sub-components ────────────────────────────────────────────

// "FIND US" — 64×64 logo (or initials fallback) + name + underlined accent
// address (tap → maps) + phone (tap → tel:) + chevron. Tapping the chevron
// expands hours / website / instagram inline, mirroring EventScreen's
// VenueIdentityBlock idiom (chevron swaps Right↔Down, conditional render, no
// animation). This is where that data lives now — the old HOURS & INFO block
// was removed to match the design.
function VenueContactBlock({ venue, theme, onMapPress }: { venue: VenueData; theme: Theme; onMapPress: () => void }) {
  const [expanded, setExpanded] = useState(false);
  if (!venue.address && !venue.phone) return null;
  const initials = (venue.name || '').slice(0, 2).toUpperCase();
  const onPhonePress = () => {
    if (venue.phone) Linking.openURL(`tel:${venue.phone}`).catch(() => {});
  };
  const websiteLabel = venue.website ? venue.website.replace(/^https?:\/\//, '') : '';
  const igHandle = venue.instagram ? venue.instagram.replace('@', '') : '';
  const hasExtra = !!(venue.hoursText || venue.website || venue.instagram);
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
      <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8 }}>
        FIND US
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
        <View style={{
          width: 64, height: 64, borderRadius: 12,
          backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
          alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden',
        }}>
          {venue.logoUrl ? (
            <Image cachePolicy="memory-disk" source={{ uri: venue.logoUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover"/>
          ) : (
            <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.5 }}>{initials}</Text>
          )}
        </View>
        <View style={{ flex: 1, paddingTop: 2 }}>
          <Text style={{ color: theme.text, fontSize: 16, fontFamily: FONTS.display, letterSpacing: -0.2, marginBottom: 4 }} numberOfLines={2}>{venue.name}</Text>
          {!!venue.address && (
            <TouchableOpacity onPress={onMapPress} activeOpacity={0.7}>
              <Text style={{ color: theme.accent, fontSize: 13, fontFamily: FONTS.body, lineHeight: 19, textDecorationLine: 'underline' }} numberOfLines={2}>{venue.address}</Text>
            </TouchableOpacity>
          )}
          {!!venue.phone && (
            <TouchableOpacity onPress={onPhonePress} activeOpacity={0.7}>
              <Text style={{ color: theme.accent, fontSize: 13, fontFamily: FONTS.body, lineHeight: 19, textDecorationLine: 'underline', marginTop: 2 }}>{venue.phone}</Text>
            </TouchableOpacity>
          )}
        </View>
        {hasExtra ? (
          <TouchableOpacity onPress={() => setExpanded(v => !v)} activeOpacity={0.7} style={{ paddingTop: 4, paddingLeft: 4 }}>
            {expanded ? <ChevronDownIcon color={theme.subtext}/> : <ChevronRightIcon color={theme.subtext}/>}
          </TouchableOpacity>
        ) : (
          <View style={{ paddingTop: 4 }}>
            <ChevronRightIcon color={theme.subtext}/>
          </View>
        )}
      </View>

      {/* Expanded: website / instagram / hours — only rows with data, aligned
          under the text column (64 logo + 14 gap). Order per UAT V5. */}
      {expanded && hasExtra && (
        <View style={{ marginTop: 14, paddingLeft: 78, gap: 12 }}>
          {!!venue.website && (
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              onPress={() => Linking.openURL(venue.website.startsWith('http') ? venue.website : `https://${venue.website}`).catch(() => {})}>
              <GlobeIcon color={theme.accent}/>
              <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.body }}>{websiteLabel}</Text>
            </TouchableOpacity>
          )}
          {!!venue.instagram && (
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              onPress={() => Linking.openURL(`https://instagram.com/${igHandle}`).catch(() => {})}>
              <InstagramIcon color={theme.accent}/>
              <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.body }}>{venue.instagram}</Text>
            </TouchableOpacity>
          )}
          {!!venue.hoursText && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                <Path d={CLOCK_PATH} stroke={theme.accent} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"/>
              </Svg>
              <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.body, flexShrink: 1 }}>{venue.hoursText}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// "ABOUT THE PLACE" — paragraph only, separated from the contact strip.
function VenueAboutBlock({ venue, theme }: { venue: VenueData; theme: Theme }) {
  if (!venue.about) return null;
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
      <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8 }}>
        ABOUT THE PLACE
      </Text>
      <Text style={{ color: theme.text, fontSize: 14, fontFamily: FONTS.body, lineHeight: 22 }}>
        {venue.about}
      </Text>
    </View>
  );
}

// "MENU" — engrained section like Event's 803d69a: eyebrow + "View All →"
// link + a real-data teaser (menuDescription, else menuAttributes joined,
// else a neutral prompt — never fabricated content).
function VenueMenuBlock({ venue, theme, onMenuPress }: { venue: VenueData; theme: Theme; onMenuPress: () => void }) {
  const desc = (venue.menuDescription && venue.menuDescription.trim()) || '';
  const attrs = (venue.menuAttributes && venue.menuAttributes.length > 0) ? venue.menuAttributes.join(' · ') : '';
  const teaser = desc || attrs || 'Browse the full menu — bar, kitchen, and signature items.';
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5 }}>MENU</Text>
        <TouchableOpacity onPress={onMenuPress} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text style={{ color: theme.accent, fontSize: 13, fontFamily: FONTS.medium }}>View All</Text>
          <ChevronRightIcon color={theme.accent}/>
        </TouchableOpacity>
      </View>
      <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.body, lineHeight: 23 }}>
        {teaser}
      </Text>
    </View>
  );
}

// "WHAT TO EXPECT" — inline middot-separated text strip (per design). Reads
// venue.amenities[] (or attributes[] legacy fallback); wraps naturally.
function VenueAttributesStrip({ items, theme }: { items: string[]; theme: Theme }) {
  if (!items || items.length === 0) return null;
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
      <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8 }}>
        WHAT TO EXPECT
      </Text>
      <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, lineHeight: 20 }}>
        {items.join(' · ')}
      </Text>
    </View>
  );
}

// "HAPPENING HERE" — refit per kit: 200-wide cards with date-badge top-left,
// soft scrim, title + time below.
function VenueUpcomingEventsBlock({ events, venueId, theme, onEventPress, onAllEvents }: {
  events: EventData[]; venueId: string; theme: Theme;
  onEventPress: (e: EventData) => void;
  onAllEvents?: (venueId: string) => void;
}) {
  if (events.length === 0) return null;
  const showAllLink = !!onAllEvents && events.length > UPCOMING_INLINE_MAX;
  const visible = events.slice(0, UPCOMING_INLINE_MAX);
  return (
    <>
      <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 }}>
            HAPPENING HERE · {events.length} UPCOMING
          </Text>
          <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, letterSpacing: -0.3 }}>What's on the calendar</Text>
        </View>
        {showAllLink && (
          <TouchableOpacity onPress={() => onAllEvents!(venueId)} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Text style={{ color: theme.accent, fontSize: 13, fontFamily: FONTS.medium }}>View all</Text>
            <ChevronRightIcon color={theme.accent}/>
          </TouchableOpacity>
        )}
      </View>
      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        {visible.map(item => (
          <VibeEventCard key={item.id} event={item} label={item.date} theme={theme} onPress={() => onEventPress(item)} width={UPCOMING_CARD_W} height={220}/>
        ))}
      </View>
    </>
  );
}

// "GALLERIES · N NIGHTS" — 2-col aspect-1 grid (first 4 inline). "All →"
// only renders when there are >4 galleries AND onAllGalleries is wired.
function VenueGalleriesGrid({ galleries, venueId, theme, onGalleryPress, onAllGalleries, toGalleryData }: {
  galleries: GalleryDoc[]; venueId: string; theme: Theme;
  onGalleryPress: (g: GalleryData) => void;
  onAllGalleries?: (venueId: string) => void;
  toGalleryData: (g: GalleryDoc) => GalleryData;
}) {
  if (galleries.length === 0) return null;
  const showAllLink = !!onAllGalleries && galleries.length > GALLERIES_INLINE_MAX;
  const visible = galleries.slice(0, GALLERIES_INLINE_MAX);
  return (
    <>
      <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ color: GALLERY_PURPLE, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 }}>
            GALLERIES · {galleries.length} {galleries.length === 1 ? 'NIGHT' : 'NIGHTS'}
          </Text>
          <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, letterSpacing: -0.3 }}>Nights here, captured</Text>
        </View>
        {showAllLink && (
          <TouchableOpacity onPress={() => onAllGalleries!(venueId)} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Text style={{ color: theme.accent, fontSize: 13, fontFamily: FONTS.medium }}>All</Text>
            <ChevronRightIcon color={theme.accent}/>
          </TouchableOpacity>
        )}
      </View>
      <View style={{ paddingHorizontal: GALLERY_GRID_GUTTER, flexDirection: 'row', flexWrap: 'wrap', gap: GALLERY_GRID_GAP }}>
        {visible.map(g => (
          <TouchableOpacity key={g.id} activeOpacity={0.9} onPress={() => onGalleryPress(toGalleryData(g))}
            style={{ width: GALLERY_CARD_W, height: GALLERY_CARD_W, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.card }}>
            <Image cachePolicy="memory-disk" source={{ uri: g.coverImage }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover"/>
            <LinearGradient
              pointerEvents="none"
              colors={['transparent', 'transparent', 'rgba(0,0,0,0.85)']}
              locations={[0, 0.5, 1]}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 12, paddingVertical: 10 }}>
              <Text style={{ color: theme.onImage, fontSize: 14, fontFamily: FONTS.display, letterSpacing: -0.1 }} numberOfLines={1}>{g.photoCount} photos</Text>
              <Text style={{ color: 'rgba(244,239,225,0.6)', fontSize: 10, fontFamily: MONO, letterSpacing: 0.4 }} numberOfLines={1}>{g.date}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}

// ── Main screen ────────────────────────────────────────────────────────
export function VenueScreen({ venue, onBack, onEventPress, onMapPress, onGalleryPress, onMenuPress, onGetTickets, onFavoriteToggle, onAllGalleries, onAllEvents, theme }: Props) {
  const [heroIndex, setHeroIndex] = useState(0);
  const [upcoming, setUpcoming] = useState<EventData[]>([]);
  const [galleries, setGalleries] = useState<GalleryDoc[]>([]);
  const [activeTicketEvent, setActiveTicketEvent] = useState<ActiveTicketEvent | null>(null);

  // Map a top-level gallery doc to the GalleryData shape the gallery viewer
  // expects (consumer app is read-only against the galleries collection).
  const toGalleryData = (g: GalleryDoc): GalleryData => ({
    id: g.id,
    title: g.title,
    venue: venue.name,
    date: g.date,
    coverImage: g.coverImage,
    photos: (g.images || []).map((uri, i) => ({ id: `${g.id}-${i}`, uri, height: 1000 })),
    venueId: g.venueId || venue.id,
  });
  const heroRef = useRef<FlatList<{ type: string; uri: string }>>(null);
  const heroMedia = venue.media.length > 0 ? venue.media : [{ type: 'image', uri: '' }];
  const hasMultiHero = heroMedia.length > 1;

  // Real events at this venue — drives Upcoming Events + the Get Tickets CTA.
  // Query by venueId only (single-field, no composite index needed); filter
  // approved + derive the ticketed event in JS.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const { getFirestore, collection, getDocs, query, where } =
          await import('@react-native-firebase/firestore');
        const db = getFirestore();
        const snap = await getDocs(query(collection(db, 'events'), where('venueId', '==', venue.id)));
        const approved = snap.docs.filter((d: any) => d.data().status === 'approved');
        // Collapse to ONE card per series (soonest eligible, expired dropped) via
        // the SAME computeSeriesFeed the marquee uses, then order soonest-first.
        // Non-series one-offs pass through. Fixes UAT V10 Venue #2 (Friday Happy
        // Hour showing once per Friday).
        const raw = approved.map((d: any) => ({ id: d.id, ...(d.data() as object) }));
        const evs: EventData[] = computeSeriesFeed(raw as any)
          .slice()
          .sort((a: any, b: any) => {
            const ad = a.dateISO || '9999-99-99', bd = b.dateISO || '9999-99-99';
            return ad < bd ? -1 : ad > bd ? 1 : 0; // soonest first; undated last
          })
          .map((e: any) => ({
            id: e.id, title: e.title || e.name || '', venue: venue.name, venueId: venue.id,
            seriesId: e.seriesId ?? null,
            date: e.date || '', time: e.time || '', age: e.age || venue.age || '', about: e.about || '',
            media: (e.media || []).map((m: any) => typeof m === 'string' ? { type: 'image', uri: m } : m),
            hasTickets: e.hasTickets === true,
            gallery: makeGallery(e.id, e.title || e.name || '', venue.name, e.date || '', ['gp1','gp2','gp3','gp4']),
          }));
        const ticketDoc = approved.find((d: any) => d.data().hasTickets === true);

        // Galleries — top-level collection, queried by venueId only (single
        // field, no composite index) and sorted by createdAt desc client-side.
        const gsnap = await getDocs(query(collection(db, 'galleries'), where('venueId', '==', venue.id)));
        const gdocs: GalleryDoc[] = gsnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as object) }) as GalleryDoc);
        gdocs.sort((a, b) => {
          const ta = (a.createdAt as any)?.toMillis ? (a.createdAt as any).toMillis() : 0;
          const tb = (b.createdAt as any)?.toMillis ? (b.createdAt as any).toMillis() : 0;
          return tb - ta;
        });

        if (!cancelled) {
          setUpcoming(evs);
          setGalleries(gdocs);
          if (ticketDoc) {
            const ev = ticketDoc.data();
            setActiveTicketEvent({ id: ticketDoc.id, name: ev.name ?? ev.title ?? venue.name, date: ev.date ?? '', time: ev.time ?? '' });
          }
        }
      } catch (e) {
        // No events/galleries or query failed — those sections stay hidden
      }
    };
    run();
    return () => { cancelled = true; };
  }, [venue.id]);

  // Stats trio (open status · rating · price) intentionally not rendered —
  // aligned to the design. The data is still on venue (openStatusHint /
  // rating / priceTier) and can be resurfaced once there's a defined source
  // of truth for open-status.

  // Amenities for the inline strip — prefer phase-2 amenities[], fall back to
  // legacy attributes[] (same precedence the old pill list used).
  const amenityList = (venue.amenities && venue.amenities.length > 0) ? venue.amenities : (venue.attributes || []);

  // Sticky CTA wiring
  const reservationHref = venue.reservationProvider === 'opentable'
    ? (venue.reservationUrlWithDefaults || venue.reservationUrl)
    : venue.reservationUrl;
  const reserveLabel = venue.ctaPrimary || (venue.reservationProvider === 'direct' ? 'Reserve a Section' : 'Reserve a table');
  const directionsLabel = venue.ctaSecondary || 'Directions';
  const showReserve = !!reservationHref;
  const showTicketCTA = !!(onGetTickets && activeTicketEvent);
  const stickyHeight = (showReserve ? 60 : 0) + (showTicketCTA ? 60 : 0) + (showReserve || showTicketCTA ? 32 : 0);

  const onHeroScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (i !== heroIndex) setHeroIndex(i);
  };
  const jumpHero = (i: number) => {
    setHeroIndex(i);
    heroRef.current?.scrollToOffset({ offset: i * SCREEN_WIDTH, animated: true });
  };
  const openReserve = () => { if (reservationHref) Linking.openURL(reservationHref).catch(() => {}); };

  // Kebab overflow menu — mirrors EventScreen.openOverflowMenu exactly. Save
  // Venue is omitted when onFavoriteToggle isn't supplied; Share/Report are
  // always available.
  const openOverflowMenu = () => {
    const hasSave = !!onFavoriteToggle;
    const options = (hasSave ? ['Save Venue', 'Share', 'Report', 'Cancel'] : ['Share', 'Report', 'Cancel']);
    const cancelIndex = options.length - 1;
    const destructiveIndex = options.indexOf('Report');

    const venueImage = (() => {
      const first = venue.media?.[0] as any;
      if (!first) return '';
      return typeof first === 'string' ? first : (first.uri || '');
    })();

    const doSave = () => {
      if (!onFavoriteToggle) return;
      onFavoriteToggle({
        id: venue.id,
        type: 'venue',
        title: venue.name,
        subtitle: venue.category || venue.neighborhood || '',
        image: venueImage,
        read: false,
        data: venue,
      });
    };
    const doShare = () => {
      Share.share({ message: `Check out ${venue.name} on Wugi!`, title: venue.name }).catch(() => {});
    };
    const doReport = () => {
      Alert.alert('Report Venue', 'Thank you — we\'ll review this venue.', [{ text: 'OK' }]);
    };

    const handleAction = (index: number) => {
      if (hasSave) {
        if (index === 0) doSave();
        else if (index === 1) doShare();
        else if (index === 2) doReport();
      } else {
        if (index === 0) doShare();
        else if (index === 1) doReport();
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIndex, destructiveButtonIndex: destructiveIndex, title: venue.name },
        handleAction,
      );
    } else {
      const buttons: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [];
      if (hasSave) buttons.push({ text: 'Save Venue', onPress: doSave });
      buttons.push({ text: 'Share',  onPress: doShare });
      buttons.push({ text: 'Report', onPress: doReport, style: 'destructive' });
      buttons.push({ text: 'Cancel', style: 'cancel' });
      Alert.alert(venue.name, 'Choose an action', buttons);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* 1. Hero — paged carousel with venue name overlaid */}
        <View style={{ width: SCREEN_WIDTH, height: HERO_HEIGHT, position: 'relative' }}>
          <FlatList
            ref={heroRef}
            data={heroMedia}
            keyExtractor={(_, i) => `hero-${i}`}
            horizontal
            pagingEnabled
            scrollEnabled={hasMultiHero}
            showsHorizontalScrollIndicator={false}
            onScroll={onHeroScroll}
            scrollEventThrottle={16}
            renderItem={({ item }) => (
              <Image cachePolicy="memory-disk" source={{ uri: item.uri }} style={{ width: SCREEN_WIDTH, height: HERO_HEIGHT }} contentFit="cover"/>
            )}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['transparent', 'transparent', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.85)']}
            locations={[0, 0.45, 0.78, 1]}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          />
          {/* Top controls — back + kebab, same glass-blur pattern as Event */}
          <View
            style={{
              position: 'absolute', top: 64, left: 20, right: 20,
              flexDirection: 'row', justifyContent: 'space-between',
              zIndex: 2,
            }}
          >
            <TouchableOpacity onPress={onBack} activeOpacity={0.8}>
              <BlurView intensity={20} tint="dark" style={{ width: 40, height: 40, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(244,239,225,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <LinearGradient colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.25)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}/>
                <BackIcon color="#f4efe1"/>
              </BlurView>
            </TouchableOpacity>
            <TouchableOpacity onPress={openOverflowMenu} activeOpacity={0.8}>
              <BlurView intensity={20} tint="dark" style={{ width: 40, height: 40, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(244,239,225,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <LinearGradient colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.25)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}/>
                <KebabVerticalIcon color="#f4efe1"/>
              </BlurView>
            </TouchableOpacity>
          </View>
          {/* Venue name overlay */}
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 30, paddingHorizontal: 20 }}>
            <Text style={{ color: theme.onImage, fontSize: 34, fontFamily: FONTS.display, letterSpacing: -1.2, lineHeight: 36 }} numberOfLines={3}>
              {venue.name}
            </Text>
          </View>
          {/* Carousel dots */}
          {hasMultiHero && (
            <View style={{ position: 'absolute', bottom: 14, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
              {heroMedia.map((_, i) => (
                <TouchableOpacity key={`dot-${i}`} onPress={() => jumpHero(i)} style={{ width: i === heroIndex ? 22 : 6, height: 6, borderRadius: 3, backgroundColor: i === heroIndex ? theme.onImage : theme.onImageMuted }}/>
              ))}
            </View>
          )}
        </View>

        {/* 2. Category line */}
        {!!venue.category && (
          <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
            <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body }}>{venue.category}</Text>
          </View>
        )}

        {/* 3. FIND US (hours / website / instagram expand from the chevron) */}
        <VenueContactBlock venue={venue} theme={theme} onMapPress={onMapPress}/>

        {/* 4. ABOUT THE PLACE */}
        <VenueAboutBlock venue={venue} theme={theme}/>

        {/* 5. MENU — engrained */}
        {onMenuPress && (
          <VenueMenuBlock venue={venue} theme={theme} onMenuPress={onMenuPress}/>
        )}

        {/* 6. WHAT TO EXPECT — inline amenity strip */}
        <VenueAttributesStrip items={amenityList} theme={theme}/>

        {/* 8. HAPPENING HERE — upcoming events */}
        <VenueUpcomingEventsBlock events={upcoming} venueId={venue.id} theme={theme} onEventPress={onEventPress} onAllEvents={onAllEvents}/>

        {/* 9. GALLERIES — 2-col grid + "All →" */}
        <VenueGalleriesGrid
          galleries={galleries}
          venueId={venue.id}
          theme={theme}
          onGalleryPress={onGalleryPress}
          onAllGalleries={onAllGalleries}
          toGalleryData={toGalleryData}
        />

        <View style={{ height: stickyHeight + 16 }}/>
      </ScrollView>

      {/* 10. Sticky CTAs: Get Tickets (if active) over Directions + Reserve */}
      {(showTicketCTA || showReserve) && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.divider, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 10 }}>
          {showTicketCTA && (
            <TouchableOpacity onPress={() => onGetTickets!(activeTicketEvent!)} style={{ backgroundColor: theme.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}>
              <Text style={{ color: theme.onAccent, fontSize: 16, fontFamily: FONTS.display, letterSpacing: 0.3 }}>Get Tickets</Text>
            </TouchableOpacity>
          )}
          {showReserve && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={onMapPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 22 }}>
                <LocationIcon color={theme.subtext}/>
                <Text style={{ color: theme.text, fontSize: 14, fontFamily: FONTS.medium }}>{directionsLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={openReserve} style={{ flex: 1, backgroundColor: theme.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', shadowColor: theme.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6 }}>
                <Text style={{ color: theme.onAccent, fontSize: 16, fontFamily: FONTS.display, letterSpacing: -0.1 }}>{reserveLabel}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
