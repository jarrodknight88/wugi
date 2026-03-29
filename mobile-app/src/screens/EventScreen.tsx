// ─────────────────────────────────────────────────────────────────────
// Wugi — EventScreen
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, ScrollView,
  FlatList, SafeAreaView, StyleSheet, Dimensions,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Video, ResizeMode } from 'expo-av';
import type { Theme } from '../constants/colors';
import type { EventData, GalleryData, FavoriteItem } from '../types';
import { EVENTS } from '../constants/mockData';
import { getVenueByName } from '../constants/mockData';
import { BackIcon, ShareIcon, CalendarIcon, ChevronRightIcon } from '../components/icons';
import { VenueIdentityBlock } from '../components/VenueIdentityBlock';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Props = {
  event: EventData;
  onBack: () => void;
  onVenuePress: () => void;
  onMapPress: () => void;
  onGalleryPress: (gallery: GalleryData) => void;
  onFavoriteToggle: (item: FavoriteItem) => void;
  onGetTickets?: () => void;
  theme: Theme;
};

export function EventScreen({ event, onBack, onVenuePress, onMapPress, onGalleryPress, onGetTickets, theme }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const venue = getVenueByName(event.venue);
  const relatedEvents = EVENTS.filter(e => e.id !== event.id).slice(0, 3);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Hero media */}
        <View style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.25 }}>
          <FlatList
            data={event.media}
            keyExtractor={(_, i) => i.toString()}
            horizontal pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={e => setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
            scrollEventThrottle={16}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            renderItem={({ item, index }) => (
              <View style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.25 }}>
                {item.type === 'video' ? (
                  <Video
                    source={{ uri: item.uri }}
                    style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.25 }}
                    resizeMode={ResizeMode.COVER}
                    shouldPlay={index === activeIndex}
                    isLooping
                    isMuted={isMuted}
                  />
                ) : (
                  <Image source={{ uri: item.uri }} style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.25 }} resizeMode="cover"/>
                )}
              </View>
            )}
          />

          {/* Top controls */}
          <SafeAreaView style={{ position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 }}>
            <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }} onPress={onBack}>
              <BackIcon color="#fff"/>
            </TouchableOpacity>
            <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
              <ShareIcon color="#fff"/>
            </TouchableOpacity>
          </SafeAreaView>

          {/* Mute toggle for video */}
          {event.media[activeIndex]?.type === 'video' && (
            <TouchableOpacity
              onPress={() => setIsMuted(p => !p)}
              style={{ position: 'absolute', bottom: 56, right: 14, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                {isMuted
                  ? (<><Path d="M11 5L6 9H2v6h4l5 4V5z" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Path d="M23 9l-6 6M17 9l6 6" stroke="#fff" strokeWidth={1.8} strokeLinecap="round"/></>)
                  : (<><Path d="M11 5L6 9H2v6h4l5 4V5z" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" stroke="#fff" strokeWidth={1.8} strokeLinecap="round"/></>)
                }
              </Svg>
            </TouchableOpacity>
          )}

          {/* Dot indicators */}
          {event.media.length > 1 && (
            <View style={{ position: 'absolute', bottom: 44, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
              {event.media.map((_, i) => (
                <View key={i} style={{ width: i === activeIndex ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === activeIndex ? '#fff' : 'rgba(255,255,255,0.4)' }}/>
              ))}
            </View>
          )}

          {/* Info strip */}
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.72)', flexDirection: 'row' }}>
            {[event.date, event.time, event.age].map((val, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderLeftWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderLeftColor: 'rgba(255,255,255,0.2)' }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>{val}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Venue identity */}
        <VenueIdentityBlock
          name={event.venue}
          address={venue?.address || ''}
          phone={venue?.phone || ''}
          website={venue?.website || ''}
          instagram={venue?.instagram || ''}
          logoUrl={(venue as any)?.logoUrl || ''}
          onAddressPress={onMapPress}
          onVenuePress={onVenuePress}
          theme={theme}
        />

        {/* About */}
        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }}/>
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 8 }}>About</Text>
          <Text style={{ color: theme.subtext, fontSize: 14, lineHeight: 20 }}>{event.about}</Text>
        </View>

        {/* Gallery strip */}
        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }}/>
        <TouchableOpacity
          style={{ paddingHorizontal: 16, paddingTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}
          onPress={() => onGalleryPress(event.gallery)}
        >
          <View>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Gallery</Text>
            <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 2 }}>{event.gallery.photos.length} photos</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '600' }}>View all</Text>
            <ChevronRightIcon color={theme.accent}/>
          </View>
        </TouchableOpacity>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {event.gallery.photos.slice(0, 5).map(photo => (
            <TouchableOpacity key={photo.id} onPress={() => onGalleryPress(event.gallery)}>
              <Image source={{ uri: photo.uri }} style={{ width: 100, height: 100, borderRadius: 10 }} resizeMode="cover"/>
            </TouchableOpacity>
          ))}
          {event.gallery.photos.length > 5 && (
            <TouchableOpacity onPress={() => onGalleryPress(event.gallery)} style={{ width: 100, height: 100, borderRadius: 10, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>+{event.gallery.photos.length - 5}</Text>
              <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 2 }}>more</Text>
            </TouchableOpacity>
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
              <Image source={{ uri: item.media[0].uri }} style={{ width: 150, height: 190 }} resizeMode="cover"/>
              <View style={{ padding: 10 }}>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{item.title}</Text>
                <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 2 }}>{item.date}</Text>
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
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 }}>Get Tickets</Text>
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
