import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  ScrollView,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  Pressable,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import Svg, { Path, Line } from 'react-native-svg';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MEDIA_HEIGHT = SCREEN_WIDTH * 1.25;

const EVENT = {
  media: [
    {
      type: 'video',
      uri: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    },
    { type: 'image', uri: 'https://picsum.photos/seed/event2/800/1000' },
    { type: 'image', uri: 'https://picsum.photos/seed/event3/800/1000' },
  ],
  date: 'SAT MAR 22',
  time: '8 PM – 2 AM',
  age: '21+',
  venue: {
    name: 'The Ivy Buckhead',
    address: '3717 Roswell Rd NE, Atlanta, GA 30342',
  },
  about: "Join us for an unforgettable night at The Ivy Buckhead. Atlanta's premier nightlife destination brings you the best in music, drinks, and vibes. Dress to impress — this is the event of the season.",
  gallery: [
    'https://picsum.photos/seed/gal1/400/400',
    'https://picsum.photos/seed/gal2/400/400',
    'https://picsum.photos/seed/gal3/400/400',
    'https://picsum.photos/seed/gal4/400/400',
    'https://picsum.photos/seed/gal5/400/400',
  ],
};

const RELATED_EVENTS = [
  { id: '1', title: 'Buckhead Saturdays', venue: 'Tongue & Groove', date: 'SAT MAR 29', image: 'https://picsum.photos/seed/rel1/400/500' },
  { id: '2', title: 'Sunday Funday Brunch', venue: 'Stats Brewpub', date: 'SUN MAR 23', image: 'https://picsum.photos/seed/rel2/400/500' },
  { id: '3', title: 'Midtown Friday', venue: 'SkyLounge ATL', date: 'FRI MAR 28', image: 'https://picsum.photos/seed/rel3/400/500' },
];

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <View style={styles.soundIconCircle}>
      {muted ? (
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path d="M11 5L6 9H2v6h4l5 4V5z" fill="white" />
          <Line x1="3" y1="3" x2="21" y2="21" stroke="white" strokeWidth={2} strokeLinecap="round" />
        </Svg>
      ) : (
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path d="M11 5L6 9H2v6h4l5 4V5z" fill="white" />
          <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="white" strokeWidth={2} strokeLinecap="round" fill="none" />
          <Path d="M19.07 4.93a10 10 0 0 1 0 14.14" stroke="white" strokeWidth={2} strokeLinecap="round" fill="none" />
        </Svg>
      )}
    </View>
  );
}

function VideoPlayer({
  uri,
  isActive,
  isMuted,
  onToggleMute,
}: {
  uri: string;
  isActive: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
}) {
  const videoRef = useRef<Video>(null);

  React.useEffect(() => {
    if (!videoRef.current) return;
    if (isActive) {
      videoRef.current.playFromPositionAsync(0);
    } else {
      videoRef.current.stopAsync();
    }
  }, [isActive]);

  return (
    <Pressable style={styles.mediaItem} onPress={onToggleMute}>
      <Video
        ref={videoRef}
        source={{ uri }}
        style={styles.mediaItem}
        resizeMode={ResizeMode.COVER}
        isLooping
        isMuted={isMuted}
        shouldPlay={isActive}
      />
      <View style={styles.soundIconWrapper} pointerEvents="none">
        <SoundIcon muted={isMuted} />
      </View>
    </Pressable>
  );
}

export default function App() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  const onScroll = (e: any) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setActiveIndex(index);
  };

  const goNext = () => {
    if (activeIndex < EVENT.media.length - 1) {
      const next = activeIndex + 1;
      flatListRef.current?.scrollToIndex({ index: next, animated: true });
      setActiveIndex(next);
    }
  };

  const goPrev = () => {
    if (activeIndex > 0) {
      const prev = activeIndex - 1;
      flatListRef.current?.scrollToIndex({ index: prev, animated: true });
      setActiveIndex(prev);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Media Carousel */}
        <View style={styles.mediaWrapper}>
          <FlatList
            ref={flatListRef}
            data={EVENT.media}
            keyExtractor={(_, i) => i.toString()}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            renderItem={({ item, index }) => (
              item.type === 'video'
                ? <VideoPlayer
                    uri={item.uri}
                    isActive={activeIndex === index}
                    isMuted={isMuted}
                    onToggleMute={() => setIsMuted(!isMuted)}
                  />
                : <Image source={{ uri: item.uri }} style={styles.mediaItem} resizeMode="cover" />
            )}
          />

          {/* Left Chevron */}
          {activeIndex > 0 && (
            <TouchableOpacity style={styles.chevronLeft} onPress={goPrev}>
              <Text style={styles.chevronText}>‹</Text>
            </TouchableOpacity>
          )}

          {/* Right Chevron */}
          {activeIndex < EVENT.media.length - 1 && (
            <TouchableOpacity style={styles.chevronRight} onPress={goNext}>
              <Text style={styles.chevronText}>›</Text>
            </TouchableOpacity>
          )}

          {/* Dots */}
          {EVENT.media.length > 1 && (
            <View style={styles.dotsRow}>
              {EVENT.media.map((_, i) => (
                <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
              ))}
            </View>
          )}

          {/* Dark Strip */}
          <View style={styles.darkStrip}>
            <View style={styles.stripColumn}>
              <Text style={styles.stripText}>{EVENT.date}</Text>
            </View>
            <View style={[styles.stripColumn, styles.stripBorder]}>
              <Text style={styles.stripText}>{EVENT.time}</Text>
            </View>
            <View style={[styles.stripColumn, styles.stripBorder]}>
              <Text style={styles.stripText}>{EVENT.age}</Text>
            </View>
          </View>
        </View>

        {/* Venue Info */}
        <View style={styles.venueRow}>
          <View style={styles.venueLogo} />
          <View style={styles.venueText}>
            <Text style={styles.venueName}>{EVENT.venue.name}</Text>
            <Text style={styles.venueAddress}>{EVENT.venue.address}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* About */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.sectionBody}>{EVENT.about}</Text>
        </View>

        <View style={styles.divider} />

        {/* Gallery */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Gallery</Text>
        </View>
        <FlatList
          data={EVENT.gallery}
          keyExtractor={(_, i) => i.toString()}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.galleryList}
          renderItem={({ item }) => (
            <Image source={{ uri: item }} style={styles.galleryItem} resizeMode="cover" />
          )}
        />

        <View style={styles.divider} />

        {/* Related Events */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Related Events</Text>
        </View>
        <FlatList
          data={RELATED_EVENTS}
          keyExtractor={(item) => item.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.relatedList}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.relatedCard}>
              <Image source={{ uri: item.image }} style={styles.relatedImage} resizeMode="cover" />
              <View style={styles.relatedInfo}>
                <Text style={styles.relatedTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.relatedVenue} numberOfLines={1}>{item.venue}</Text>
                <Text style={styles.relatedDate}>{item.date}</Text>
              </View>
            </TouchableOpacity>
          )}
        />

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Fixed Ticket Button */}
      <SafeAreaView style={styles.buttonWrapper}>
        <TouchableOpacity style={styles.ticketButton}>
          <Text style={styles.ticketButtonText}>Get Tickets</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e0e0e' },
  scroll: { flex: 1 },
  mediaWrapper: { width: SCREEN_WIDTH },
  mediaItem: { width: SCREEN_WIDTH, height: MEDIA_HEIGHT },

  // Sound icon
  soundIconWrapper: {
    position: 'absolute',
    bottom: 58,
    right: 12,
  },
  soundIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Chevrons
  chevronLeft: {
    position: 'absolute',
    left: 8,
    top: '45%',
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 20,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronRight: {
    position: 'absolute',
    right: 8,
    top: '45%',
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 20,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '300',
  },

  // Dots
  dotsRow: {
    position: 'absolute',
    bottom: 52,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { backgroundColor: '#fff', width: 18 },

  // Dark Strip
  darkStrip: {
    backgroundColor: '#111',
    flexDirection: 'row',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  stripColumn: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  stripBorder: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: '#333' },
  stripText: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },

  // Venue
  venueRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16 },
  venueLogo: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#333', marginRight: 12 },
  venueText: { flex: 1 },
  venueName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  venueAddress: { color: '#888', fontSize: 12, marginTop: 2 },

  // Divider
  divider: { height: 1, backgroundColor: '#1e1e1e', marginHorizontal: 16, marginTop: 16 },

  // Section
  section: { paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 12 },
  sectionBody: { color: '#888', fontSize: 14, lineHeight: 22 },

  // Gallery
  galleryList: { paddingHorizontal: 16, gap: 8 },
  galleryItem: { width: 120, height: 120, borderRadius: 10 },

  // Related Events
  relatedList: { paddingHorizontal: 16, gap: 12 },
  relatedCard: { width: 160, borderRadius: 12, overflow: 'hidden', backgroundColor: '#1a1a1a' },
  relatedImage: { width: 160, height: 200 },
  relatedInfo: { padding: 10 },
  relatedTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  relatedVenue: { color: '#888', fontSize: 11, marginTop: 2 },
  relatedDate: { color: '#2a7a5a', fontSize: 11, fontWeight: '700', marginTop: 4 },

  // Ticket Button
  buttonWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0e0e0e',
    borderTopWidth: 1,
    borderTopColor: '#1e1e1e',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  ticketButton: { backgroundColor: '#2a7a5a', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  ticketButtonText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
});