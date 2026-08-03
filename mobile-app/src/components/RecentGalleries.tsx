// ─────────────────────────────────────────────────────────────────────
// Wugi — RecentGalleries
//
// Shared horizontal-scroll shelf of the most recently added galleries
// (cover photo, title, venue, photo count). Self-contained: fetches its
// own data via getApprovedGalleries (already sorted newest-first) +
// resolves each gallery's venueId → venue name, then renders nothing if
// there's nothing to show.
//
// Card tap converts the fetched GalleryDoc into the existing GalleryData
// shape and calls the caller's onGalleryPress — the SAME prop Home and
// Discover already thread to RootNavigator's navigateToGallery, so this
// reuses the existing gallery route rather than adding new nav wiring.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import type { Theme } from '../constants/colors';
import type { GalleryData } from '../types';
import { FONTS, MONO } from '../constants/fonts';

type Item = {
  id: string;
  title: string;
  venueName: string;
  venueId?: string;
  coverImage: string;
  photoCount: number;
  images: string[];
  date: string;
};

type Props = {
  theme: Theme;
  onGalleryPress: (gallery: GalleryData) => void;
  max?: number;
};

export function RecentGalleries({ theme, onGalleryPress, max = 10 }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const svc = await import('../../firestoreService');
        const galleries = await svc.getApprovedGalleries(max);

        const venueIds = Array.from(new Set(
          galleries.map(g => g.venueId).filter((id): id is string => !!id)
        ));
        const venues = await Promise.all(
          venueIds.map(id => svc.getVenueById(id).catch(() => null))
        );
        const nameById: Record<string, string> = {};
        venues.forEach(v => { if (v) nameById[v.id] = v.name; });

        if (cancelled) return;
        setItems(galleries.map(g => ({
          id: g.id,
          title: g.title,
          venueName: g.venueId ? (nameById[g.venueId] || '') : '',
          venueId: g.venueId || undefined,
          coverImage: g.coverImage || (g.images || [])[0] || '',
          photoCount: g.photoCount ?? (g.images || []).length,
          images: g.images || [],
          date: g.date || '',
        })));
      } catch (e) {
        console.log('RecentGalleries: load failed', e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [max]);

  if (!loaded || items.length === 0) return null;

  const handlePress = (item: Item) => {
    const images = item.images.length > 0 ? item.images : [item.coverImage].filter(Boolean);
    const gallery: GalleryData = {
      id: item.id,
      title: item.title,
      venue: item.venueName,
      date: item.date,
      coverImage: item.coverImage,
      photos: images.map((uri, i) => ({ id: `${item.id}-${i}`, uri, height: 300 })),
      venueId: item.venueId,
    };
    onGalleryPress(gallery);
  };

  return (
    <View>
      <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 10 }}>
        <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.5, marginBottom: 4 }}>
          FRESH FROM THE LENS
        </Text>
        <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, letterSpacing: -0.3 }}>
          Recent galleries
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
      >
        {items.map(item => (
          <TouchableOpacity
            key={item.id}
            activeOpacity={0.9}
            onPress={() => handlePress(item)}
            style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
          >
            <View style={styles.photoWrap}>
              {!!item.coverImage && (
                <Image
                  cachePolicy="memory-disk"
                  source={{ uri: item.coverImage }}
                  style={StyleSheet.absoluteFillObject}
                  contentFit="cover"
                />
              )}
              {item.photoCount > 0 && (
                <View style={styles.countChip}>
                  <Text style={[styles.countChipText, { fontFamily: MONO }]}>
                    {item.photoCount} PHOTO{item.photoCount === 1 ? '' : 'S'}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.body}>
              <Text numberOfLines={1} style={[styles.title, { color: theme.text, fontFamily: FONTS.medium }]}>
                {item.title}
              </Text>
              {!!item.venueName && (
                <Text numberOfLines={1} style={[styles.venue, { color: theme.subtext, fontFamily: FONTS.body }]}>
                  {item.venueName}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexShrink: 0,
    width: 160,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
  },
  photoWrap: {
    width: 160,
    height: 160,
    position: 'relative',
  },
  countChip: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  countChipText: {
    color: '#f4efe1',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  body: {
    padding: 10,
    paddingBottom: 12,
  },
  title: {
    fontSize: 13,
    letterSpacing: -0.1,
    lineHeight: 16,
    marginBottom: 2,
  },
  venue: {
    fontSize: 11,
    lineHeight: 14,
  },
});
