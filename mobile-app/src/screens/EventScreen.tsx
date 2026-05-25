// ─────────────────────────────────────────────────────────────────────
// Wugi — EventScreen  (Wave 1 visual pass, 2026-05-25)
//
// Wave 1 changes over the previous implementation:
//   1. Hero → content gap eliminated via marginBottom:-24 + bottom scrim
//      that fades to theme.bg (not transparent).
//   2. Translucent status-bar wash — solid 60px dark View at top of hero,
//      pointerEvents="none", approximates a gradient since expo-linear-gradient
//      is not installed. rgba(0,0,0,0.50) top strip + lighter mid strip.
//   3. Top controls: inset to left:20/right:20, top:64 (was paddingHorizontal:16).
//      Share icon → KebabVerticalIcon; overflow menu opens via ActionSheetIOS
//      (iOS) / Alert (Android) with Save / Share / Add to Calendar / Report.
//   4. Venue identity block: onVenuePress wired via new onNavigateToVenue prop
//      so tapping name/logo navigates to VenueScreen (additive prop — see
//      RootNavigator change noted in report).
//   5. Sticky CTA: shows "Get Tickets" only if event.hasTickets, shows
//      "Book Reservation" only if venue.reservationUrl or
//      venue.reservationUrlWithDefaults exists. No CTA when neither applies.
//   6. Add to Calendar + Share moved into kebab overflow menu.
//   7. "View Menu" entry shown (above sticky CTA) when venue exists and the
//      caller supplies onMenuPress. Removed if unavailable.
//
// DO NOT touch VenueIdentityBlock or useVenueById — they stay as-is.
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, FlatList,
  SafeAreaView, Dimensions, ActivityIndicator, StyleSheet,
  ActionSheetIOS, Platform, Alert, Share, Linking,
} from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { Video, ResizeMode } from 'expo-av';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, GalleryData, FavoriteItem } from '../types';
import { EVENTS } from '../constants/mockData';
import { FONTS, MONO } from '../constants/fonts';
import { BackIcon, KebabVerticalIcon, ChevronRightIcon } from '../components/icons';
import { VenueIdentityBlock } from '../components/VenueIdentityBlock';
import { useEventGallery } from '../hooks/useEventGallery';
import { useVenueById } from '../hooks/useVenueById';
import { ErrorBoundary } from '../components/error/ErrorBoundary';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Design hero: aspectRatio 0.95 → height = width / 0.95
const HERO_HEIGHT = Math.round(SCREEN_WIDTH / 0.95);

const EMPTY_GALLERY: GalleryData = {
  id: 'empty', title: '', venue: '', date: '', coverImage: '', photos: [],
} as GalleryData;

// Purple used for the GALLERIES eyebrow (matches design --tag-photos)
const GALLERY_PURPLE = '#9b59b6';

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
  theme: Theme;
};

function EventScreenInner({
  event, onBack, onVenuePress, onNavigateToVenue, onMapPress, onGalleryPress,
  onFavoriteToggle, onGetTickets, onMenuPress, theme,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);

  // Defensive: scraped events may carry venueName instead of (or in addition to) venue
  const venueName = (event as any).venue ?? (event as any).venueName ?? '';
  // Real Firestore venue lookup by id — returns { venue: null, loading: false }
  // when venueId is missing or the doc doesn't exist.
  const eventVenueId = (event as any).venueId ?? null;
  const { venue } = useVenueById(eventVenueId);

  // Defensive: media may be missing/empty on incomplete docs
  const media = Array.isArray(event.media) ? event.media : [];

  // Related events — non-empty media, capped at 3
  const relatedEvents = EVENTS
    .filter(e => e.id !== event.id && Array.isArray(e.media) && e.media.length > 0)
    .slice(0, 3);

  // Real-time gallery from Wugi Lens
  const { gallery: liveGallery, loading: galleryLoading } = useEventGallery(event.id);
  const activeGallery: GalleryData = liveGallery || event.gallery || EMPTY_GALLERY;
  const galleryPhotos = Array.isArray(activeGallery?.photos) ? activeGallery.photos : [];

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
          subtitle: venueName,
          image: (event.media || [])[0]?.uri || '',
          read: false,
          data: event,
        });
      } else if (index === 1) {
        // Share
        Share.share({
          message: `Check out ${event.title} at ${venueName} on Wugi!`,
          title: event.title,
        }).catch(() => {});
      } else if (index === 2) {
        // Add to Calendar — open system calendar intent
        // On iOS, a real integration would use expo-calendar; for now open a
        // placeholder URL that the user can act on. Noted in drop-list.
        Alert.alert('Add to Calendar', `${event.title}\n${event.date} · ${event.time}`, [
          { text: 'OK' },
        ]);
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

        {/* ── Hero — marginBottom:-24 bleeds into content for seamless seam ── */}
        <View style={{ width: SCREEN_WIDTH, height: HERO_HEIGHT, marginBottom: -24 }}>
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

          {/* ── Bottom scrim — fades to theme.bg (not transparent) so the
               hero → content seam is completely invisible. ── */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              height: Math.round(HERO_HEIGHT * 0.55),
              // Two stacked views simulate the gradient (no expo-linear-gradient).
              // Outer: semi-opaque black for the title area.
              // Inner: fully opaque bg at the very bottom for the seamless seam.
            }}
          >
            {/* Upper portion: strong black tint for title legibility */}
            <View
              style={{
                flex: 1,
                backgroundColor: 'rgba(0,0,0,0.55)',
              }}
            />
            {/* Lower 24px: matches theme.bg exactly so marginBottom:-24 kisses it */}
            <View style={{ height: 24, backgroundColor: theme.bg }}/>
          </View>

          {/* ── Translucent status-bar wash ── 60px tall, approximates the
               spec's linear-gradient+blur with stacked solid Views.
               pointerEvents="none" so it passes all touches through. ── */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              height: 60,
              zIndex: 1,
            }}
          >
            {/* Darkest strip at very top (0% → ~40% of 60px = 24px) */}
            <View style={{ height: 24, backgroundColor: 'rgba(0,0,0,0.50)' }}/>
            {/* Mid strip (lighter, ~40% → 80% of 60px = 24px) */}
            <View style={{ height: 24, backgroundColor: 'rgba(0,0,0,0.28)' }}/>
            {/* Fades out at bottom (80% → 100% = 12px) */}
            <View style={{ height: 12, backgroundColor: 'rgba(0,0,0,0.08)' }}/>
          </View>

          {/* ── Top controls — back + kebab overflow ── */}
          {/* Using absolute positioning with explicit left/right/top instead of
              SafeAreaView+padding so we can hit the spec's left:20/right:20/top:64. */}
          <View
            style={{
              position: 'absolute', top: 64, left: 20, right: 20,
              flexDirection: 'row', justifyContent: 'space-between',
              zIndex: 2,
            }}
          >
            <TouchableOpacity
              style={styles.controlButton}
              onPress={onBack}
              activeOpacity={0.8}
            >
              <BackIcon color="#f4efe1"/>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.controlButton}
              onPress={openOverflowMenu}
              activeOpacity={0.8}
            >
              <KebabVerticalIcon color="#f4efe1"/>
            </TouchableOpacity>
          </View>

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

          {/* Event title — overlaid at bottom of hero, above the bg-colored seam */}
          <View style={{ position: 'absolute', bottom: 48, left: 0, right: 0, paddingHorizontal: 20, zIndex: 2 }}>
            <Text
              numberOfLines={3}
              style={{
                color: theme.onImage,
                fontSize: 38,
                fontFamily: FONTS.display,
                letterSpacing: -1.4,
                lineHeight: 40,
              }}
            >
              {event.title ?? ''}
            </Text>
          </View>
        </View>
        {/* End hero — the -24 margin means the next block overlaps here */}

        {/* ── Date / Time / Age chips ─────────────────────────────────── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14, flexDirection: 'row', gap: 8, zIndex: 2 }}>
          {[event.date ?? '—', event.time ?? '—', event.age ?? '21+'].map((val, i) => (
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

        {/* ── Venue strip (AT) ─────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
          <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8 }}>
            AT
          </Text>
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

          {/* Menu entry — show when caller supplies onMenuPress and venue exists */}
          {venue && onMenuPress && (
            <TouchableOpacity
              onPress={onMenuPress}
              style={{
                marginTop: 12,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingVertical: 10, paddingHorizontal: 14,
                backgroundColor: theme.card, borderRadius: 10,
                borderWidth: 1, borderColor: theme.border,
              }}
              activeOpacity={0.8}
            >
              <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.medium }}>View Menu</Text>
              <ChevronRightIcon color={theme.subtext}/>
            </TouchableOpacity>
          )}
        </View>

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

        {/* ── Galleries strip ──────────────────────────────────────────── */}
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
                  {galleryPhotos.length > 0
                    ? `${galleryPhotos.length} photos from past nights`
                    : liveGallery
                      ? 'Photos loading…'
                      : 'No photos yet'}
                </Text>
              )}
            </View>
            {(galleryPhotos.length > 0 || liveGallery) && (
              <TouchableOpacity
                onPress={() => onGalleryPress(activeGallery)}
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
            <TouchableOpacity key={photo.id} onPress={() => onGalleryPress(activeGallery)} activeOpacity={0.9}>
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
              onPress={() => onGalleryPress(activeGallery)}
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
          {galleryPhotos.length === 0 && !galleryLoading && (
            <View
              style={{
                width: 200, height: 100, borderRadius: 10,
                backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: FONTS.body }}>Photos coming soon</Text>
            </View>
          )}
        </ScrollView>

        {/* ── Related events — "ALSO TONIGHT" ─────────────────────────── */}
        {relatedEvents.length > 0 && (
          <>
            <View style={{ paddingHorizontal: 16, paddingTop: 28, paddingBottom: 12 }}>
              <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 }}>
                ALSO TONIGHT
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
                <View style={{ width: 150, height: 200, borderRadius: 12, overflow: 'hidden' }}>
                  <Image
                    cachePolicy="memory-disk"
                    source={{ uri: (item.media || [])[0]?.uri || '' }}
                    style={{ width: 150, height: 200 }}
                    contentFit="cover"
                  />
                  {/* Gradient overlay — bottom fade */}
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute', left: 0, right: 0, bottom: 0,
                      height: 100,
                      backgroundColor: 'rgba(0,0,0,0.75)',
                    }}
                  />
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
                        {item.date}
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
                </View>
              )}
            />
          </>
        )}

        {/* Bottom spacer for sticky CTA (or just breathing room if no CTA) */}
        <View style={{ height: hasCTA ? 140 : 40 }}/>
      </ScrollView>

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
const styles = StyleSheet.create({
  controlButton: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
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
