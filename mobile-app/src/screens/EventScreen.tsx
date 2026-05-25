// ─────────────────────────────────────────────────────────────────────
// Wugi — EventScreen
//
// Design fidelity pass (Path 3) against the Claude Design handoff:
//   hero (aspect ~0.95) → chips row → venue strip → about →
//   galleries strip → related events → sticky CTA
//
// Hierarchy matches EventScreen.jsx from the handoff exactly.
// Real-data-only: sections with no backing field are dropped cleanly
// (see DROPS in the companion note).
//
// Defensive against three event shapes per VENUE-DATA-07 Deliverable C.
// Wrapped in ErrorBoundary so render-time crashes recover instead of
// force-closing the app.
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, FlatList,
  SafeAreaView, Dimensions, ActivityIndicator, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { Video, ResizeMode } from 'expo-av';
import type { Theme } from '../constants/colors';
import type { EventData, GalleryData, FavoriteItem } from '../types';
import { EVENTS } from '../constants/mockData';
import { FONTS, MONO } from '../constants/fonts';
import { BackIcon, ShareIcon, CalendarIcon, ChevronRightIcon } from '../components/icons';
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
  onVenuePress: () => void;
  onMapPress: (address: string, venueName: string) => void;
  onGalleryPress: (gallery: GalleryData) => void;
  onFavoriteToggle: (item: FavoriteItem) => void;
  onGetTickets?: () => void;
  theme: Theme;
};

function EventScreenInner({
  event, onBack, onVenuePress, onMapPress, onGalleryPress, onGetTickets, theme,
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* ── Hero ────────────────────────────────────────────────── */}
        <View style={{ width: SCREEN_WIDTH, height: HERO_HEIGHT }}>
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

          {/* Gradient scrim — dark at top and bottom, no expo-linear-gradient dep */}
          {/* Top scrim */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              height: Math.round(HERO_HEIGHT * 0.32),
              backgroundColor: 'rgba(0,0,0,0.45)',
            }}
          />
          {/* Bottom scrim — heavier for title legibility */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              height: Math.round(HERO_HEIGHT * 0.55),
              backgroundColor: 'rgba(0,0,0,0.72)',
            }}
          />

          {/* Top controls — back + share */}
          <SafeAreaView style={{ position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 }}>
            <TouchableOpacity
              style={{
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: 'rgba(0,0,0,0.5)',
                borderWidth: 1, borderColor: 'rgba(244,239,225,0.15)',
                alignItems: 'center', justifyContent: 'center',
              }}
              onPress={onBack}
            >
              <BackIcon color={theme.onImage}/>
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: 'rgba(0,0,0,0.5)',
                borderWidth: 1, borderColor: 'rgba(244,239,225,0.15)',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <ShareIcon color={theme.onImage}/>
            </TouchableOpacity>
          </SafeAreaView>

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

          {/* Event title — overlaid at bottom of hero */}
          <View style={{ position: 'absolute', bottom: 24, left: 0, right: 0, paddingHorizontal: 20 }}>
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

        {/* ── Date / Time / Age chips — below the hero ────────────── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14, flexDirection: 'row', gap: 8 }}>
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

        {/* ── Venue strip (AT) — right under chips ────────────────── */}
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
              onVenuePress={onVenuePress}
              theme={theme}
            />
          ) : venueName ? (
            // Venue not resolved yet (or no venueId) — show a minimal row
            <TouchableOpacity
              onPress={onVenuePress}
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
        </View>

        {/* ── About ───────────────────────────────────────────────── */}
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

        {/* ── Galleries strip ──────────────────────────────────────── */}
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

        {/* ── Related events — "ALSO TONIGHT" ─────────────────────── */}
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

        {/* Bottom spacer for sticky CTA */}
        <View style={{ height: 140 }}/>
      </ScrollView>

      {/* ── Sticky CTA ──────────────────────────────────────────────── */}
      <View
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          backgroundColor: theme.bg,
          borderTopWidth: 1, borderTopColor: theme.divider,
          paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32,
        }}
      >
        {/* Primary: Get Tickets — only when event has tickets */}
        {onGetTickets && event.hasTickets === true && (
          <TouchableOpacity
            onPress={onGetTickets}
            style={{
              backgroundColor: theme.accent,
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: 'center',
              marginBottom: 10,
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

        {/* Secondary pair: Add to Calendar + Share */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            style={{
              flex: 1, borderRadius: 12, paddingVertical: 12,
              borderWidth: 1.5, borderColor: theme.border,
              backgroundColor: theme.card,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            activeOpacity={0.8}
          >
            <CalendarIcon color={theme.subtext}/>
            <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.medium }}>Add to Calendar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              flex: 1, borderRadius: 12, paddingVertical: 12,
              borderWidth: 1.5, borderColor: theme.border,
              backgroundColor: theme.card,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            activeOpacity={0.8}
          >
            <ShareIcon color={theme.subtext}/>
            <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.medium }}>Share</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

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
