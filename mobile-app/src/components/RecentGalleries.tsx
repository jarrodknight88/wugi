// ─────────────────────────────────────────────────────────────────────
// Wugi — RecentGalleries
//
// Shared horizontal-scroll shelf of the most recently added galleries
// (UAT-W2A). Self-contained: fetches its own data via getApprovedGalleries
// (already newest-first) and batch-resolves venue names via getVenueById,
// so callers just mount `<RecentGalleries theme={theme} onGalleryPress={.}/>`
// with no extra wiring. Card tap builds the existing GalleryData shape and
// hands it to the caller's onGalleryPress — reuses the existing gallery
// route (bug fix PR #195), no new navigator wiring.
//
// Renders nothing while loading or when there are no galleries to show.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { Theme } from '../constants/colors';
import type { GalleryData, GalleryDoc } from '../types';
import { FONTS, MONO } from '../constants/fonts';

type Props = {
  theme: Theme;
  onGalleryPress: (gallery: GalleryData) => void;
  max?: number;
};

function galleryDocToData(g: GalleryDoc, venueName: string): GalleryData {
  const images = (g.images || []).filter(Boolean);
  return {
    id: g.id,
    title: g.title || '',
    venue: venueName,
    date: g.date || '',
    coverImage: g.coverImage || images[0] || '',
    photos: (images.length > 0 ? images : [g.coverImage].filter(Boolean))
      .map((uri, i) => ({ id: `${g.id}-${i}`, uri, height: 300 })),
    venueId: g.venueId || undefined,
  };
}

export function RecentGalleries({ theme, onGalleryPress, max = 12 }: Props) {
  const [galleries, setGalleries] = useState<GalleryDoc[]>([]);
  const [venueNameById, setVenueNameById] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const svc = await import('../../firestoreService');
        const docs = await svc.getApprovedGalleries(max);
        if (cancelled) return;
        setGalleries(docs);

        const venueIds = Array.from(new Set(docs.map(d => d.venueId).filter(Boolean)));
        if (venueIds.length > 0) {
          const venues = await Promise.all(venueIds.map(id => svc.getVenueById(id).catch(() => null)));
          if (cancelled) return;
          const map: Record<string, string> = {};
          venues.forEach(v => { if (v && v.id && v.name) map[v.id] = v.name; });
          setVenueNameById(map);
        }
      } catch (e) {
        console.log('RecentGalleries: load failed', e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [max]);

  if (!loaded || galleries.length === 0) return null;

  return (
    <View>
      <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 10 }}>
        <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.5, marginBottom: 4 }}>FRESH SHOTS</Text>
        <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, letterSpacing: -0.3 }}>Recent galleries</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
        {galleries.map(g => {
          const venueName = venueNameById[g.venueId] || '';
          const photoCount = g.photoCount ?? (g.images || []).length;
          return (
            <TouchableOpacity
              key={g.id}
              activeOpacity={0.9}
              onPress={() => onGalleryPress(galleryDocToData(g, venueName))}
              style={[styles.card, { backgroundColor: theme.card }]}
            >
              {!!g.coverImage && (
                <Image cachePolicy="memory-disk" source={{ uri: g.coverImage }} style={StyleSheet.absoluteFillObject} contentFit="cover"/>
              )}
              {/* Bottom gradient scrim — matches the ShelfCard/VibeEventCard card-gradient recipe. */}
              <LinearGradient
                pointerEvents="none"
                colors={['transparent', 'transparent', 'rgba(0,0,0,0.85)']}
                locations={[0, 0.45, 1]}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.body}>
                <Text numberOfLines={1} style={[styles.title, { color: '#f4efe1', fontFamily: FONTS.display }]}>{g.title}</Text>
                {!!venueName && (
                  <Text numberOfLines={1} style={[styles.venue, { color: 'rgba(244,239,225,0.75)', fontFamily: FONTS.body }]}>{venueName}</Text>
                )}
                <Text numberOfLines={1} style={[styles.count, { color: theme.accent, fontFamily: MONO }]}>{photoCount} PHOTOS</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 150,
    height: 190,
    borderRadius: 14,
    overflow: 'hidden',
  },
  body: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
  },
  title: {
    fontSize: 13,
    lineHeight: 16,
    marginBottom: 2,
  },
  venue: {
    fontSize: 11,
    marginBottom: 4,
  },
  count: {
    fontSize: 9,
    letterSpacing: 0.5,
    fontWeight: '700',
  },
});
