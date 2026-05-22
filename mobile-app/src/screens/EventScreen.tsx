// ─────────────────────────────────────────────────────────────────────
// Wugi — EventScreen
//
// Defensive against three event shapes (per VENUE-DATA-07 Deliverable C):
//   - hand-seeded mock events: full venue field, full gallery
//   - scraped SerpAPI events: venueId + venueName, no legacy gallery
//   - future series-anchor events (post VENUE-DATA-05)
// All field reads use ?. / ?? defaults; arrays default to []; missing
// gallery falls back to an inline empty shape. Wrapped in ErrorBoundary
// at the export so a render-time crash recovers instead of force-closing.
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, FlatList, SafeAreaView, StyleSheet, Dimensions, ActivityIndicator,  } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { Video, ResizeMode } from 'expo-av';
import type { Theme } from '../constants/colors';
import type { EventData, GalleryData, FavoriteItem } from '../types';
import { EVENTS } from '../constants/mockData';
import { BackIcon, ShareIcon, CalendarIcon, ChevronRightIcon } from '../components/icons';
import { VenueIdentityBlock } from '../components/VenueIdentityBlock';
import { useEventGallery } from '../hooks/useEventGallery';
import { useVenueById } from '../hooks/useVenueById';
import { ErrorBoundary } from '../components/error/ErrorBoundary';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const EMPTY_GALLERY: GalleryData = {
  id: 'empty', title: '', venue: '', date: '', coverImage: '', photos: [],
} as GalleryData;

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

function EventScreenInner({ event, onBack, onVenuePress, onMapPress, onGalleryPress, onGetTickets, theme }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);

  // Defensive: scraped events may carry venueName instead of (or in addition to) venue
  const venueName = (event as any).venue ?? (event as any).venueName ?? '';
  // Real Firestore venue lookup by id (replaces the 3-mock-venue getVenueByName
  // call that returned null for every scraped event). Hook returns { venue: null,
  // loading: false } when venueId is missing or doc doesn't exist.
  const eventVenueId = (event as any).venueId ?? null;
  const { venue } = useVenueById(eventVenueId);

  // Defensive: media may be missing/empty on incomplete docs
  const media = Array.isArray(event.media) ? event.media : [];
  // Related events: only those with non-empty media (avoids item.media[0].uri null-deref)
  const relatedEvents = EVENTS
    .filter(e => e.id !== event.id && Array.isArray(e.media) && e.media.length > 0)
    .slice(0, 3);

  // Real-time gallery from Wugi Lens
  const { gallery: liveGallery, loading: galleryLoading } = useEventGallery(event.id);
  // Defensive: scraped events do not have event.gallery; fall back to empty shape
  const activeGallery: GalleryData = liveGallery || event.gallery || EMPTY_GALLERY;
  const galleryPhotos = Array.isArray(activeGallery?.photos) ? activeGallery.photos : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Hero media */}
        <View style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.25 }}>
          {media.length === 0 && (
            <View style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.25, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: theme.subtext, fontSize: 13 }}>No media yet</Text>
            </View>
          )}
          <FlatList
            data={media}
            keyExtractor={(_, i) => i.toString()}
            horizontal pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={e => setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
            scrollEventThrottle={16}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            renderItem={({ item, index }) => (
              <View style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.25 }}>
                {item?.type === 'video' ? (
                  <Video
                    source={{ uri: item.uri }}
                    style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.25 }}
                    resizeMode={ResizeMode.COVER}
                    shouldPlay={index === activeIndex}
                    isLooping
                    isMuted={isMuted}
                  />
                ) : (
                  <Image cachePolicy="memory-disk" source={{ uri: item?.uri || '' }} style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.25 }} contentFit="cover"/>
                )}
              </View>
            )}
          />

          {/* Top controls */}
          <SafeAreaView style={{ position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 }}>
            <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.overlayMedium, alignItems: 'center', justifyContent: 'center' }} onPress={onBack}>
              <BackIcon color={theme.onImage}/>
            </TouchableOpacity>
            <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.overlayMedium, alignItems: 'center', justifyContent: 'center' }}>
              <ShareIcon color={theme.onImage}/>
            </TouchableOpacity>
          </SafeAreaView>

          {/* Mute toggle for video */}
          {media[activeIndex]?.type === 'video' && (
            <TouchableOpacity
              onPress={() => setIsMuted(p => !p)}
              style={{ position: 'absolute', bottom: 56, right: 14, width: 34, height: 34, borderRadius: 17, backgroundColor: theme.overlayMedium, alignItems: 'center', justifyContent: 'center' }}
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
            <View style={{ position: 'absolute', bottom: 44, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
              {media.map((_, i) => (
                <View key={i} style={{ width: i === activeIndex ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === activeIndex ? theme.onImage : theme.onImageMuted }}/>
              ))}
            </View>
          )}

          {/* Info strip — defensive ?? '—' for missing fields on scraped events */}
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.overlayStrong, flexDirection: 'row' }}>
            {[event.date ?? '—', event.time ?? '—', event.age ?? '—'].map((val, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderLeftWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderLeftColor: theme.onImageMuted }}>
                <Text style={{ color: theme.onImage, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>{val}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Event title — page H1 (was missing pre-2026-05-08; users saw a blank screen below the hero) */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <Text
            numberOfLines={2}
            style={{ color: theme.text, fontSize: 22, fontWeight: '800', lineHeight: 28 }}
          >
            {event.title ?? ''}
          </Text>
        </View>

        {/* Venue identity — only renders when the Firestore venue lookup resolved.
            For events whose venueId points at a missing doc (orphans) or while the
            lookup is in flight, the block is skipped so users don't see empty
            address/phone/website lines and the placeholder `??` logo box. The
            event title + date/time/age strip carry the screen on their own. */}
        {venue && (
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
        )}

        {/* About */}
        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }}/>
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 8 }}>About</Text>
          <Text style={{ color: theme.subtext, fontSize: 14, lineHeight: 20 }}>{event.about ?? ''}</Text>
        </View>

        {/* Gallery strip */}
        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }}/>
        <TouchableOpacity
          style={{ paddingHorizontal: 16, paddingTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}
          onPress={() => onGalleryPress(activeGallery)}
        >
          <View>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Gallery</Text>
            {galleryLoading
              ? <ActivityIndicator size="small" color={theme.accent} style={{ marginTop: 4 }}/>
              : <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 2 }}>
                  {galleryPhotos.length > 0 ? `${galleryPhotos.length} photos` : liveGallery ? 'Live — photos loading' : 'No photos yet'}
                </Text>
            }
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {liveGallery && <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: theme.accent }}/>}
            <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '600' }}>{liveGallery ? 'Live' : 'View all'}</Text>
            <ChevronRightIcon color={theme.accent}/>
          </View>
        </TouchableOpacity>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {galleryPhotos.slice(0, 5).map(photo => (
            <TouchableOpacity key={photo.id} onPress={() => onGalleryPress(activeGallery)}>
              <Image cachePolicy="memory-disk" source={{ uri: photo.uri }} style={{ width: 100, height: 100, borderRadius: 10 }} contentFit="cover"/>
            </TouchableOpacity>
          ))}
          {galleryPhotos.length > 5 && (
            <TouchableOpacity onPress={() => onGalleryPress(activeGallery)} style={{ width: 100, height: 100, borderRadius: 10, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>+{galleryPhotos.length - 5}</Text>
              <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 2 }}>more</Text>
            </TouchableOpacity>
          )}
          {galleryPhotos.length === 0 && !galleryLoading && (
            <View style={{ width: 200, height: 100, borderRadius: 10, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border }}>
              <Text style={{ fontSize: 24 }}>📷</Text>
              <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 4 }}>Photos coming soon</Text>
            </View>
          )}
        </ScrollView>

        {/* Related events */}
        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }}/>
        <View style={{ paddingHorizontal: 16, paddingTop: 16, marginBottom: 12 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Related Events</Text>
        </View>
        <FlatList
          data={relatedEvents}
          keyExtractor={e => e.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: 150, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}>
              <Image cachePolicy="memory-disk" source={{ uri: item?.media?.[0]?.uri || '' }} style={{ width: 150, height: 190 }} contentFit="cover"/>
              <View style={{ padding: 10 }}>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{item?.title ?? ''}</Text>
                <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 2 }}>{item?.date ?? ''}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
        <View style={{ height: 120 }}/>
      </ScrollView>

      {/* Sticky CTA */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.divider, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}>
        {onGetTickets && event.hasTickets === true && (
          <TouchableOpacity
            style={{ backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginBottom: 10 }}
            onPress={onGetTickets}
          >
            <Text style={{ color: theme.onAccent, fontSize: 16, fontWeight: '700', letterSpacing: 0.3 }}>Get Tickets</Text>
          </TouchableOpacity>
        )}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity style={{ flex: 1, borderRadius: 12, paddingVertical: 12, borderWidth: 1.5, borderColor: theme.border, backgroundColor: theme.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <CalendarIcon color={theme.subtext}/>
            <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>Add to Calendar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ flex: 1, borderRadius: 12, paddingVertical: 12, borderWidth: 1.5, borderColor: theme.border, backgroundColor: theme.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <ShareIcon color={theme.subtext}/>
            <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>Share</Text>
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
