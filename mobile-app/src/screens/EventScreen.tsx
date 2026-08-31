// ─────────────────────────────────────────────────────────────────────
// Wugi — EventScreen  (Wave 2 real gradient/blur + real calendar, 2026-05-25)
//
// Wave 1 changes (retained):
//   1. Hero → content gap eliminated via marginBottom:-24 + bottom scrim.
//   2. Static, darker status-bar wash pinned at the screen top.
//   3. Top controls: left:20/right:20/top:64, kebab overflow menu.
//   4. Venue identity block: onNavigateToVenue prop wired.
//   5. Sticky CTA: conditional Get Tickets / Book Reservation.
//   6. Add to Calendar + Share in kebab overflow.
//   7. "MENU" section (engrained like About: eyebrow + "View All" → MenuScreen).
//
// Wave 2 changes (retained):
//   1. Hero bottom scrim → real LinearGradient (transparent→rgba→theme.bg).
//   2. Status-bar wash → darker LinearGradient, pinned outside the ScrollView
//      (static — was a BlurView inside the hero that scrolled/parallaxed away).
//   3. Top glass buttons → real BlurView pill (intensity:20) replacing
//      solid rgba(0,0,0,0.5) backgrounds.
//   4. "Add to Calendar" → real expo-calendar write with permission handling
//      and best-effort date parsing from event.date/time string fields.
//
// UAT-W2B changes (this commit):
//   1. Status-bar wash is now theme-matched (theme.bg-derived, not hardcoded
//      black) and the back/kebab controls are genuinely sticky — both now
//      render as ScrollView siblings instead of living inside the hero.
//   2. Title moved off the hero image into its own block below the media,
//      above the date/time/age row (hero's bottom scrim still bridges the
//      seam into it).
//   3. "Get a ride" Uber deep link in the venue strip (hidden without venue
//      coordinates).
//   4. Hero video now measures its real aspect ratio on load (onReadyForDisplay)
//      instead of always cropping to the default flyer aspect ratio.
//
// DO NOT touch VenueIdentityBlock or useVenueById — they stay as-is.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, FlatList,
  SafeAreaView, Dimensions, ActivityIndicator, StyleSheet,
  ActionSheetIOS, Platform, Alert, Share, Linking,
  Image as RNImage,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as Calendar from 'expo-calendar';
import Svg, { Path } from 'react-native-svg';
import { Video, ResizeMode, Audio } from 'expo-av';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, GalleryData, FavoriteItem } from '../types';
import { getApprovedEvents, type FSEvent } from '../../firestoreService';
import { FONTS, MONO } from '../constants/fonts';
import { BackIcon, KebabVerticalIcon, ChevronRightIcon } from '../components/icons';
import { VenueIdentityBlock } from '../components/VenueIdentityBlock';
import { GetARideButton } from '../components/GetARideButton';
import { useEventGallery } from '../hooks/useEventGallery';
import { useEventGalleriesByEventId } from '../hooks/useEventGalleriesByEventId';
import { useEventGalleriesBySeriesId } from '../hooks/useEventGalleriesBySeriesId';
import { useVenueById } from '../hooks/useVenueById';
import { ErrorBoundary } from '../components/error/ErrorBoundary';
import { formatEventDateShort, formatEventTimeLabel } from '../utils/eventDateTime';
import { hexToRgba } from '../utils/color';
import { attachableImageUri, buildEventShareMessage } from '../utils/share';
import { getEventCardHero } from '../utils/eventMedia';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Design hero: default aspectRatio 0.95 → height = width / 0.95. Used for
// landscape/square flyers, and as the fallback until the real aspect ratio
// resolves (see heroAspectRatio state below).
const DEFAULT_HERO_ASPECT_RATIO = 0.95;
const DEFAULT_HERO_HEIGHT = Math.round(SCREEN_WIDTH / DEFAULT_HERO_ASPECT_RATIO);

// Purple used for the GALLERIES eyebrow (matches design --tag-photos)
const GALLERY_PURPLE = '#9b59b6';

// FSEvent → EventData for the related-events rail. Gallery is a bare stub —
// the rail cards never render it, and tapping through re-resolves galleries
// via the EventScreen hooks.
function toRelatedEventData(e: FSEvent): EventData {
  return {
    id: e.id,
    title: e.title || '',
    venue: e.venue || (e as any).venueName || '',
    venueId: e.venueId,
    seriesId: e.seriesId ?? null,
    date: e.date || '',
    time: e.time || '',
    age: e.age || '',
    about: e.about || '',
    media: e.media || [],
    hasTickets: (e as any).hasTickets === true,
    gallery: {
      id: e.id, title: e.title || '', venue: e.venue || (e as any).venueName || '',
      date: e.date || '', coverImage: '', photos: [],
    },
  };
}

type Props = {
  event: EventData;
  onBack: () => void;
  // Kept for backward-compat. Wired at the VenueIdentityBlock level.
  onVenuePress: () => void;
  // NEW (Wave 1, additive): called with the resolved VenueData so the navigator
  // can push VenueScreen with a proper venue object. Absent → falls back to
  // the legacy onVenuePress no-op.
  onNavigateToVenue?: (venue: VenueData) => void;
  onMapPress: (address: string, venueName: string) => void;
  onGalleryPress: (gallery: GalleryData) => void;
  onFavoriteToggle: (item: FavoriteItem) => void;
  onGetTickets?: () => void;
  // NEW (Wave 1, additive): called when user taps "View Menu" in the venue strip.
  // When omitted the menu row is hidden.
  onMenuPress?: () => void;
  // NEW (UAT-V3, additive): tapping a related "Also tonight" card pushes that
  // event onto the stack. Absent → the related cards render but don't navigate.
  onEventPress?: (event: EventData) => void;
  theme: Theme;
};

function EventScreenInner({
  event, onBack, onVenuePress, onNavigateToVenue, onMapPress, onGalleryPress,
  onFavoriteToggle, onGetTickets, onMenuPress, onEventPress, theme,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  // Detail-view video plays WITH sound by default (a mute toggle still lets
  // the user opt out) — unlike card/feed autoplay, which stays muted.
  const [isMuted, setIsMuted] = useState(false);

  // iOS routes media playback silent by default unless the audio session
  // opts in — without this, a video plays with no sound whenever the
  // ringer/silent switch is on, even with isMuted={false} above.
  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});
  }, []);

  // Defensive: scraped events may carry venueName instead of (or in addition to) venue
  const venueName = (event as any).venue ?? (event as any).venueName ?? '';
  // Real Firestore venue lookup by id — returns { venue: null, loading: false }
  // when venueId is missing or the doc doesn't exist.
  const eventVenueId = (event as any).venueId ?? null;
  const { venue } = useVenueById(eventVenueId);

  // Menu section description — real venue data only (menuDescription, else the
  // menuAttributes joined). Empty when neither exists → the description line is
  // dropped (no fabricated "N items" count, per the real-data-only rule).
  const menuDesc = venue
    ? (venue.menuDescription?.trim() || (venue.menuAttributes?.length ? venue.menuAttributes.join(' · ') : ''))
    : '';

  // Defensive: media may be missing/empty on incomplete docs
  const media = Array.isArray(event.media) ? event.media : [];

  // Dynamic hero sizing — portrait flyers (aspectRatio < 1, common in
  // nightlife) must display FULLY instead of being cropped by the fixed
  // default height. Landscape/square media keep the default crop (unchanged
  // visual). Only the first media item drives sizing — it's the primary
  // flyer for the carousel.
  const [heroAspectRatio, setHeroAspectRatio] = useState(DEFAULT_HERO_ASPECT_RATIO);
  useEffect(() => {
    const first = media[0];
    if (!first || first.type === 'video' || !first.uri) {
      setHeroAspectRatio(DEFAULT_HERO_ASPECT_RATIO);
      return;
    }
    let cancelled = false;
    RNImage.getSize(
      first.uri,
      (w, h) => { if (!cancelled && w > 0 && h > 0) setHeroAspectRatio(w / h); },
      () => { if (!cancelled) setHeroAspectRatio(DEFAULT_HERO_ASPECT_RATIO); },
    );
    return () => { cancelled = true; };
  }, [media[0]?.uri, media[0]?.type]);

  // Portrait: size the hero to the image's real aspect ratio so it renders
  // fully (no crop) and the chips row below sits clear of the image bounds.
  const isPortraitHero = heroAspectRatio < 1;
  const HERO_HEIGHT = isPortraitHero
    ? Math.round(SCREEN_WIDTH / heroAspectRatio)
    : DEFAULT_HERO_HEIGHT;

  // Related events — real approved events on the SAME date as this one
  // (excluding this event), non-empty media, capped at 6. While loading, on
  // error, or when nothing matches, the section is hidden entirely — it's
  // below the fold, so no skeleton and no mock fallback.
  const [relatedEvents, setRelatedEvents] = useState<EventData[]>([]);
  useEffect(() => {
    let cancelled = false;
    setRelatedEvents([]);
    (async () => {
      try {
        const live = await getApprovedEvents(undefined, 100);
        if (cancelled) return;
        setRelatedEvents(
          live
            .filter(e =>
              e.id !== event.id &&
              !!e.date && e.date === event.date &&
              Array.isArray(e.media) && e.media.length > 0
            )
            .slice(0, 6)
            .map(toRelatedEventData)
        );
      } catch (_) {
        // Leave empty — the rail stays hidden.
      }
    })();
    return () => { cancelled = true; };
  }, [event.id, event.date]);

  // Real-or-nothing display rule across THREE real sources (no mock/empty
  // fallback — when none resolve we render nothing for the photos section):
  //   • linkedGallery — top-level galleries/ linked by eventId (per-occurrence, most specific)
  //   • seriesGallery — top-level galleries/ linked by seriesId (whole series)
  //   • liveGallery   — Wugi Lens eventGalleries listener (live)
  // Precedence: the most specific curated link wins — eventId, then seriesId,
  // then the Lens live listener.
  const { gallery: linkedGallery, loading: linkedLoading } = useEventGalleriesByEventId(event.id);
  const { gallery: seriesGallery, loading: seriesLoading } = useEventGalleriesBySeriesId(event.seriesId ?? null);
  const { gallery: liveGallery, loading: liveLoading } = useEventGallery(event.id);
  // null when no real gallery is linked/live — the strip stays hidden.
  const resolvedGallery: GalleryData | null = linkedGallery || seriesGallery || liveGallery || null;
  // Keep the loading state only while nothing has resolved yet AND at least one
  // source is still in flight; once all sources settle empty, the strip hides.
  const galleryLoading = !resolvedGallery && (linkedLoading || seriesLoading || liveLoading);
  // Ensure a venueId rides along so the gallery/photo venue line is tappable
  // even when the resolved gallery didn't carry one.
  const activeGallery: GalleryData | null = resolvedGallery
    ? { ...resolvedGallery, venueId: resolvedGallery.venueId || eventVenueId || undefined }
    : null;
  const galleryPhotos = Array.isArray(activeGallery?.photos) ? activeGallery!.photos : [];

  // ── Venue press handler: prefer onNavigateToVenue(venue) if available ──
  const handleVenuePress = () => {
    if (venue && onNavigateToVenue) {
      onNavigateToVenue(venue as unknown as VenueData);
    } else {
      onVenuePress();
    }
  };

  // ── Kebab overflow menu ───────────────────────────────────────────────
  const openOverflowMenu = () => {
    const options = ['Save Event', 'Share', 'Add to Calendar', 'Report', 'Cancel'];
    const cancelIndex = options.length - 1;
    const destructiveIndex = options.indexOf('Report');

    const handleAction = (index: number) => {
      if (index === 0) {
        // Save
        onFavoriteToggle({
          id: event.id,
          type: 'event',
          title: event.title,
          subtitle: event.date ? `${venueName} · ${formatEventDateShort(event.date)}` : venueName,
          image: getEventCardHero(event.media) || '',
          read: false,
          data: event,
        });
      } else if (index === 1) {
        // Share — hero image (iOS only, see utils/share.ts) + blurb + about
        // text ending with "powered by @wugi" + link.
        (async () => {
          try {
            const heroUri = getEventCardHero(media) || '';
            const localImageUri = await attachableImageUri(heroUri, event.id);
            const message = buildEventShareMessage(event);
            await Share.share(
              localImageUri
                ? { message, url: localImageUri, title: event.title }
                : { message, title: event.title },
            );
          } catch (_) {
            // User cancelled or the share sheet failed to open — no-op,
            // matches this menu's other actions.
          }
        })();
      } else if (index === 2) {
        // Add to Calendar — real expo-calendar write
        (async () => {
          try {
            // 1. Request permission
            const { status } = await Calendar.requestCalendarPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert(
                'Calendar access needed',
                'Enable calendar access in Settings to add this event.',
              );
              return;
            }

            // 2. Get a writable calendar
            let calendarId: string | undefined;
            try {
              const defaultCal = await Calendar.getDefaultCalendarAsync();
              calendarId = defaultCal?.id;
            } catch (_) {
              // getDefaultCalendarAsync can throw on Android or when no default set
            }
            if (!calendarId) {
              const allCals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
              const writable = allCals.find(c => c.allowsModifications);
              calendarId = writable?.id;
            }
            if (!calendarId) {
              Alert.alert('Couldn\'t add', 'No writable calendar found on this device.');
              return;
            }

            // 3. Derive start date from event.date ("TUE JUN 9") + time ("5:00 PM")
            //    Best-effort: parse month + day, assume current year; roll to next
            //    year if the result is already in the past.
            let startDate: Date;
            try {
              const dateStr = `${event.date ?? ''} ${event.time ?? ''}`.trim();
              // Remove weekday prefix (e.g. "TUE ") — Date.parse handles "JUN 9 5:00 PM"
              const withoutWeekday = dateStr.replace(/^[A-Z]{2,3}\s+/i, '');
              const currentYear = new Date().getFullYear();
              const parsed = new Date(`${withoutWeekday} ${currentYear}`);
              if (isNaN(parsed.getTime())) throw new Error('unparseable');
              // Roll forward a year if the date is already in the past (> 1 day ago)
              const oneDayMs = 24 * 60 * 60 * 1000;
              if (parsed.getTime() < Date.now() - oneDayMs) {
                parsed.setFullYear(currentYear + 1);
              }
              startDate = parsed;
            } catch (_) {
              startDate = new Date(); // fallback: now
            }
            const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000); // +2h

            // Build notes that survive even if the timestamp is approximate
            const resolvedVenueName = venue?.name || venueName || '';
            const notes = [
              `${event.date ?? ''} · ${event.time ?? ''}`,
              resolvedVenueName ? `Venue: ${resolvedVenueName}` : '',
              'Added via Wugi (timestamp may be approximate — verify with venue)',
            ].filter(Boolean).join('\n');

            // 4. Write the event
            await Calendar.createEventAsync(calendarId, {
              title: event.title,
              startDate,
              endDate,
              location: resolvedVenueName || undefined,
              notes,
              timeZone: 'America/New_York',
            });

            Alert.alert('Added', 'This event was added to your calendar.');
          } catch (_) {
            Alert.alert('Couldn\'t add', 'Something went wrong adding this event.');
          }
        })();
      } else if (index === 3) {
        // Report
        Alert.alert('Report Event', 'Thank you — we\'ll review this event.', [{ text: 'OK' }]);
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: cancelIndex,
          destructiveButtonIndex: destructiveIndex,
          title: event.title,
        },
        handleAction,
      );
    } else {
      // Android: use Alert with options
      Alert.alert(event.title, 'Choose an action', [
        { text: 'Save Event',       onPress: () => handleAction(0) },
        { text: 'Share',            onPress: () => handleAction(1) },
        { text: 'Add to Calendar',  onPress: () => handleAction(2) },
        { text: 'Report',           onPress: () => handleAction(3), style: 'destructive' },
        { text: 'Cancel',           style: 'cancel' },
      ]);
    }
  };

  // ── Reservation CTA ───────────────────────────────────────────────────
  const reservationUrl = venue?.reservationUrlWithDefaults || venue?.reservationUrl;
  const showReservationCTA = !!reservationUrl;
  const showTicketsCTA = !!onGetTickets && event.hasTickets === true;
  const hasCTA = showTicketsCTA || showReservationCTA;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* ── Hero — marginBottom:-24 bleeds into content for seamless seam.
             Dropped for portrait flyers so the chips row never overlaps the
             fully-visible image. ── */}
        <View style={{ width: SCREEN_WIDTH, height: HERO_HEIGHT, marginBottom: isPortraitHero ? 0 : -24 }}>
          {/* Media carousel — empty state */}
          {media.length === 0 && (
            <View style={StyleSheet.absoluteFillObject}>
              <View style={{ flex: 1, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body }}>No media yet</Text>
              </View>
            </View>
          )}

          {/* Paged media carousel */}
          {media.length > 0 && (
            <FlatList
              data={media}
              keyExtractor={(_, i) => i.toString()}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={e => setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
              scrollEventThrottle={16}
              style={StyleSheet.absoluteFillObject}
              renderItem={({ item, index }) => (
                <View style={{ width: SCREEN_WIDTH, height: HERO_HEIGHT }}>
                  {item?.type === 'video' ? (
                    <Video
                      source={{ uri: item.uri }}
                      style={{ width: SCREEN_WIDTH, height: HERO_HEIGHT }}
                      resizeMode={ResizeMode.COVER}
                      shouldPlay={index === activeIndex}
                      isLooping
                      isMuted={isMuted}
                      // Only the first (primary) media item drives hero sizing —
                      // mirrors the RNImage.getSize measurement below for images.
                      // Video has no synchronous size like Image, so this fires
                      // after the player loads and the hero grows into place.
                      onReadyForDisplay={index === 0 ? (e: any) => {
                        const w = e?.naturalSize?.width;
                        const h = e?.naturalSize?.height;
                        if (w > 0 && h > 0) setHeroAspectRatio(w / h);
                      } : undefined}
                    />
                  ) : (
                    <Image
                      cachePolicy="memory-disk"
                      source={{ uri: item?.uri || '' }}
                      style={{ width: SCREEN_WIDTH, height: HERO_HEIGHT }}
                      contentFit="cover"
                    />
                  )}
                </View>
              )}
            />
          )}

          {/* ── Bottom scrim — real LinearGradient: transparent@0%→transparent@55%
               → mild dark tint@75% for title legibility → theme.bg@100% so the
               marginBottom:-24 seam blends straight into the title block
               below (title moved off the image per UAT-W2B — see below). ── */}
          <LinearGradient
            colors={['transparent', 'transparent', 'rgba(0,0,0,0.25)', theme.bg]}
            locations={[0, 0.55, 0.75, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          {/* Top controls (back + kebab) and the status-bar wash used to live
              here, but that meant they scrolled away with the hero instead of
              staying put. Both are now rendered as siblings of the ScrollView
              (below, outside this View) so they're genuinely sticky. */}

          {/* Mute toggle for video */}
          {media[activeIndex]?.type === 'video' && (
            <TouchableOpacity
              onPress={() => setIsMuted(p => !p)}
              style={{
                position: 'absolute', bottom: 70, right: 14,
                width: 34, height: 34, borderRadius: 17,
                backgroundColor: theme.overlayMedium,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                {isMuted
                  ? (<><Path d="M11 5L6 9H2v6h4l5 4V5z" stroke={theme.onImage} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Path d="M23 9l-6 6M17 9l6 6" stroke={theme.onImage} strokeWidth={1.8} strokeLinecap="round"/></>)
                  : (<><Path d="M11 5L6 9H2v6h4l5 4V5z" stroke={theme.onImage} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" stroke={theme.onImage} strokeWidth={1.8} strokeLinecap="round"/></>)
                }
              </Svg>
            </TouchableOpacity>
          )}

          {/* Dot indicators */}
          {media.length > 1 && (
            <View style={{ position: 'absolute', bottom: 54, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
              {media.map((_, i) => (
                <View
                  key={i}
                  style={{
                    width: i === activeIndex ? 18 : 6, height: 6, borderRadius: 3,
                    backgroundColor: i === activeIndex ? theme.onImage : theme.onImageMuted,
                  }}
                />
              ))}
            </View>
          )}

        </View>
        {/* End hero — the -24 margin means the next block overlaps here */}

        {/* ── Event title — below the media (UAT-W2B), sitting on the
             bg-colored tail of the hero's bottom scrim above, and above the
             date/time/age details row. ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
          <Text
            numberOfLines={3}
            style={{
              color: theme.text,
              fontSize: 30,
              fontFamily: FONTS.display,
              letterSpacing: -1.1,
              lineHeight: 33,
            }}
          >
            {event.title ?? ''}
          </Text>
        </View>

        {/* ── Date / Time / Age chips ─────────────────────────────────── */}
        {(event.date || event.time || event.age) && (
          <View style={{ paddingHorizontal: 16, paddingTop: 14, flexDirection: 'row', gap: 8, zIndex: 2 }}>
            {[formatEventDateShort(event.date) || '—', formatEventTimeLabel(event.time) || '—', event.age ?? '21+'].map((val, i) => (
              <View
                key={i}
                style={{
                  flex: 1, paddingVertical: 9, borderRadius: 10,
                  backgroundColor: theme.card,
                  borderWidth: 1, borderColor: theme.border,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    color: theme.text,
                    fontSize: 12,
                    fontFamily: MONO,
                    fontWeight: '600',
                    letterSpacing: 0.2,
                  }}
                  numberOfLines={1}
                >
                  {val}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Venue strip ──────────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
          {venue ? (
            <VenueIdentityBlock
              name={venue.name || venueName || 'Venue'}
              address={venue.address || ''}
              phone={venue.phone || ''}
              website={venue.website || ''}
              instagram={venue.instagram || ''}
              logoUrl={venue.logoUrl || ''}
              onAddressPress={() => onMapPress(venue.address || '', venue.name || venueName)}
              onVenuePress={handleVenuePress}
              theme={theme}
            />
          ) : venueName ? (
            // Venue not resolved yet (or no venueId) — show a minimal row
            <TouchableOpacity
              onPress={handleVenuePress}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
              activeOpacity={0.8}
            >
              <View
                style={{
                  width: 56, height: 56, borderRadius: 10,
                  backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{ color: theme.subtext, fontSize: 10, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.5 }}>
                  {(venueName as string).slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 16, fontFamily: FONTS.display, letterSpacing: -0.2 }} numberOfLines={1}>
                  {venueName}
                </Text>
              </View>
              <ChevronRightIcon color={theme.subtext}/>
            </TouchableOpacity>
          ) : null}

          {/* Menu is no longer a button here — it's an engrained "MENU" section
              below About (see Menu section), matching About's eyeline. */}
        </View>

        {/* ── Get a ride — Uber deep link (UAT-W2B). Hidden when the venue
             has no geocoded coordinates (useVenueById only carries `location`
             when the venue doc has one). ── */}
        {!!venue?.location && (
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <GetARideButton location={venue.location} venueName={venue.name || venueName} theme={theme}/>
          </View>
        )}

        {/* ── About ───────────────────────────────────────────────────── */}
        {!!event.about && (
          <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
            <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8 }}>
              ABOUT
            </Text>
            <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.body, lineHeight: 23 }}>
              {event.about}
            </Text>
          </View>
        )}

        {/* ── Menu ── engrained section matching About's eyeline. Header row:
             "MENU" eyebrow (left) + "View All →" link (right, → MenuScreen).
             Gated on menuDesc (not just venue+onMenuPress) — otherwise the
             header + View All row rendered with no content when the venue
             has no menuDescription/menuAttributes. ── */}
        {!!menuDesc && onMenuPress && (
          <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5 }}>
                MENU
              </Text>
              <TouchableOpacity onPress={onMenuPress} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text style={{ color: theme.accent, fontSize: 13, fontFamily: FONTS.medium }}>View All</Text>
                <ChevronRightIcon color={theme.accent}/>
              </TouchableOpacity>
            </View>
            {!!menuDesc && (
              <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.body, lineHeight: 23 }}>
                {menuDesc}
              </Text>
            )}
          </View>
        )}

        {/* ── Galleries strip ──────────────────────────────────────────── */}
        {(galleryLoading || galleryPhotos.length > 0) && (
          <>
            <View style={{ paddingHorizontal: 16, paddingTop: 24 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: GALLERY_PURPLE, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 }}>
                    GALLERIES
                  </Text>
                  {galleryLoading ? (
                    <ActivityIndicator size="small" color={theme.accent} style={{ alignSelf: 'flex-start', marginTop: 2 }}/>
                  ) : (
                    <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, letterSpacing: -0.3 }}>
                      {`${galleryPhotos.length} photos from past nights`}
                    </Text>
                  )}
                </View>
                {galleryPhotos.length > 0 && (
                  <TouchableOpacity
                    onPress={() => onGalleryPress(activeGallery!)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: theme.accent, fontSize: 12, fontFamily: FONTS.medium }}>All</Text>
                    <ChevronRightIcon color={theme.accent}/>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Gallery thumbnails row */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}
            >
              {galleryPhotos.slice(0, 5).map(photo => (
                <TouchableOpacity key={photo.id} onPress={() => onGalleryPress(activeGallery!)} activeOpacity={0.9}>
                  <Image
                    cachePolicy="memory-disk"
                    source={{ uri: photo.uri }}
                    style={{ width: 100, height: 100, borderRadius: 10 }}
                    contentFit="cover"
                  />
                </TouchableOpacity>
              ))}
              {galleryPhotos.length > 5 && (
                <TouchableOpacity
                  onPress={() => onGalleryPress(activeGallery!)}
                  style={{
                    width: 100, height: 100, borderRadius: 10,
                    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
                    alignItems: 'center', justifyContent: 'center',
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.display }}>+{galleryPhotos.length - 5}</Text>
                  <Text style={{ color: theme.subtext, fontSize: 10, fontFamily: FONTS.body, marginTop: 2 }}>more</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </>
        )}

        {/* ── Related events — "MORE ON THIS NIGHT" (same-date, real data) ── */}
        {relatedEvents.length > 0 && (
          <>
            <View style={{ paddingHorizontal: 16, paddingTop: 28, paddingBottom: 12 }}>
              <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 }}>
                MORE ON THIS NIGHT
              </Text>
              <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, letterSpacing: -0.3 }}>
                If this is your vibe
              </Text>
            </View>
            <FlatList
              data={relatedEvents}
              keyExtractor={e => e.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item }) => (
                // Tappable card → push the related event onto the stack.
                // Overlay matches the Home "Picks for you" pattern: a single
                // uniform `overlayMedium` fill across the full card (no hard
                // half-height edge). Title legibility comes from the uniform
                // dimming, not a partial scrim.
                <TouchableOpacity
                  style={{ width: 150, height: 200, borderRadius: 12, overflow: 'hidden' }}
                  activeOpacity={onEventPress ? 0.9 : 1}
                  onPress={onEventPress ? () => onEventPress(item) : undefined}
                  disabled={!onEventPress}
                >
                  <Image
                    cachePolicy="memory-disk"
                    source={{ uri: getEventCardHero(item.media) || '' }}
                    style={StyleSheet.absoluteFillObject}
                    contentFit="cover"
                  />
                  <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, backgroundColor: theme.overlayMedium }}/>
                  <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 }}>
                    {!!item.date && (
                      <Text
                        style={{
                          color: theme.accent,
                          fontSize: 9,
                          fontFamily: MONO,
                          fontWeight: '700',
                          letterSpacing: 0.6,
                          marginBottom: 3,
                        }}
                        numberOfLines={1}
                      >
                        {formatEventDateShort(item.date)}
                      </Text>
                    )}
                    <Text
                      style={{
                        color: theme.onImage,
                        fontSize: 13,
                        fontFamily: FONTS.display,
                        lineHeight: 16,
                      }}
                      numberOfLines={2}
                    >
                      {item.title}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        {/* Bottom spacer for sticky CTA (or just breathing room if no CTA) */}
        <View style={{ height: hasCTA ? 140 : 40 }}/>
      </ScrollView>

      {/* ── Status-bar wash — theme-matched semi-opaque bar (UAT-W2B): fades
           from theme.bg (black dark mode / beige light mode) down to
           transparent, instead of the old hardcoded dark tint, so the status
           bar reads correctly against the page background in both themes
           while hero media scrolls behind it. Pinned to the screen top
           (sibling of the ScrollView) so it never scrolls or parallaxes. ── */}
      <LinearGradient
        pointerEvents="none"
        colors={[hexToRgba(theme.bg, 0.92), hexToRgba(theme.bg, 0.55), hexToRgba(theme.bg, 0)]}
        locations={[0, 0.6, 1]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 60, zIndex: 50 }}
      />

      {/* ── Top controls — back + kebab overflow. STICKY: rendered as a
           sibling of the ScrollView (not inside the hero) so they stay
           pinned on screen through the whole scroll — previously they lived
           inside the hero and scrolled away with it. ── */}
      <View
        style={{
          position: 'absolute', top: 64, left: 20, right: 20,
          flexDirection: 'row', justifyContent: 'space-between',
          zIndex: 51,
        }}
      >
        <TouchableOpacity onPress={onBack} activeOpacity={0.8}>
          <BlurView intensity={20} tint="dark" style={styles.controlButton}>
            <LinearGradient
              colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.25)']}
              style={StyleSheet.absoluteFill}
            />
            <BackIcon color="#f4efe1"/>
          </BlurView>
        </TouchableOpacity>
        <TouchableOpacity onPress={openOverflowMenu} activeOpacity={0.8}>
          <BlurView intensity={20} tint="dark" style={styles.controlButton}>
            <LinearGradient
              colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.25)']}
              style={StyleSheet.absoluteFill}
            />
            <KebabVerticalIcon color="#f4efe1"/>
          </BlurView>
        </TouchableOpacity>
      </View>

      {/* ── Sticky CTA — conditional on available actions ─────────────── */}
      {hasCTA && (
        <View
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            backgroundColor: theme.bg,
            borderTopWidth: 1, borderTopColor: theme.divider,
            paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32,
          }}
        >
          {/* Get Tickets — only when event.hasTickets is true */}
          {showTicketsCTA && (
            <TouchableOpacity
              onPress={onGetTickets}
              style={{
                backgroundColor: theme.accent,
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: 'center',
                marginBottom: showReservationCTA ? 10 : 0,
                shadowColor: theme.accent,
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.4,
                shadowRadius: 12,
                elevation: 6,
              }}
              activeOpacity={0.88}
            >
              <Text style={{ color: theme.onAccent, fontSize: 16, fontFamily: FONTS.display, letterSpacing: -0.1 }}>
                Get Tickets
              </Text>
            </TouchableOpacity>
          )}

          {/* Book Reservation — only when venue has a reservation URL */}
          {showReservationCTA && (
            <TouchableOpacity
              onPress={() => Linking.openURL(reservationUrl!).catch(() => {})}
              style={{
                backgroundColor: showTicketsCTA ? theme.card : theme.accent,
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: 'center',
                borderWidth: showTicketsCTA ? 1.5 : 0,
                borderColor: theme.border,
                shadowColor: showTicketsCTA ? 'transparent' : theme.accent,
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: showTicketsCTA ? 0 : 0.4,
                shadowRadius: 12,
                elevation: showTicketsCTA ? 0 : 6,
              }}
              activeOpacity={0.88}
            >
              <Text style={{
                color: showTicketsCTA ? theme.text : theme.onAccent,
                fontSize: 16,
                fontFamily: FONTS.display,
                letterSpacing: -0.1,
              }}>
                {venue?.ctaPrimary || 'Book Reservation'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

// ── Shared button style for the dark-glass top controls ─────────────────
// BlurView must have overflow:'hidden' to clip to the borderRadius pill shape.
// backgroundColor removed — BlurView + inner LinearGradient provide the tint.
const styles = StyleSheet.create({
  controlButton: {
    width: 40, height: 40, borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(244,239,225,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
});

// Public export wraps the inner screen in an ErrorBoundary so any
// render-time exception (typically a null deref against a Firestore doc
// with an unexpected field shape) recovers to a Retry/Back UI instead of
// force-closing the app. VENUE-DATA-07 Deliverable C.
//
// VENUE-DATA-08 Deliverable B: pass screen+eventId so the ErrorBoundary
// can write a structured crash record to Firestore `crashes` collection
// for post-mortem.
export function EventScreen(props: Props) {
  return (
    <ErrorBoundary
      label="this event"
      screen="EventScreen"
      eventId={props.event?.id ?? null}
      onBack={props.onBack}
    >
      <EventScreenInner {...props} />
    </ErrorBoundary>
  );
}
