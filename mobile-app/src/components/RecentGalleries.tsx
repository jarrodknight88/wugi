// ─────────────────────────────────────────────────────────────────────
// Wugi — RecentGalleries
//
// Shared horizontal-scroll shelf of the most recent approved galleries
// (cover / title / venue / photo count). Self-contained data fetch via
// getApprovedGalleries (already newest-first) + a venueId → name lookup
// so the venue line renders without the caller pre-loading venues.
// Card tap builds the existing GalleryData navigation payload and calls
// the caller's onGalleryPress — reuses the existing gallery route, no
// new nav wiring. Bottom gradient footer matches the #196 card-gradient
// treatment (see ShelfCard in DiscoverEditorialScreen / VibeEventCard).
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { Theme } from '../constants/colors';
import type { GalleryData, GalleryDoc } from '../types';
import { FONTS, MONO } from '../constants/fonts';

const MAX_GALLERIES = 12;

function galleryDocToData(g: GalleryDoc, venueName: string): GalleryData {
  const images = (g.images || []).filter(Boolean);
  return {
    id: g.id,
    title: g.title,
    venue: venueName,
    date: g.date || '',
    coverImage: g.coverImage || images[0] || '',
    photos: (images.length > 0 ? images : [g.coverImage].filter(Boolean))
      .map((uri, i) => ({ id: `${g.id}-${i}`, uri, height: 300 })),
    venueId: g.venueId || undefined,
  };
}

type RecentGallery = { doc: GalleryDoc; venueName: string };

export function RecentGalleries({ theme, onGalleryPress }: {
  theme: Theme;
  onGalleryPress: (gallery: GalleryData) => void;
}) {
  const [galleries, setGalleries] = useState<RecentGallery[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const svc = await import('../../firestoreService');
        const docs = await svc.getApprovedGalleries(MAX_GALLERIES);
        const venueIds = Array.from(new Set(docs.map(d => d.venueId).filter(Boolean)));
        const venues = await Promise.all(
          venueIds.map(id => svc.getVenueById(id).catch(() => null))
        );
        if (cancelled) return;
        const nameById: Record<string, string> = {};
        venues.forEach(v => { if (v && v.id && v.name) nameById[v.id] = v.name; });
        setGalleries(docs.map(doc => ({
          doc,
          venueName: (doc.venueId && nameById[doc.venueId]) || '',
        })));
      } catch (e) {
        console.log('RecentGalleries: load failed', e);
        if (!cancelled) setGalleries([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!galleries || galleries.length === 0) return null;

  return (
    <View>
      <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 10 }}>
        <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.5, marginBottom: 4 }}>
          FRESH OFF THE FLOOR
        </Text>
        <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, letterSpacing: -0.3 }}>
          Recent galleries
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: 8 }}
      >
        {galleries.map(({ doc, venueName }) => (
          <TouchableOpacity
            key={doc.id}
            activeOpacity={0.9}
            onPress={() => onGalleryPress(galleryDocToData(doc, venueName))}
            style={[styles.card, { backgroundColor: theme.card }]}
          >
            {!!doc.coverImage && (
              <Image
                cachePolicy="memory-disk"
                source={{ uri: doc.coverImage }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
              />
            )}
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(0,0,0,0.3)', 'transparent', 'rgba(0,0,0,0.92)']}
              locations={[0, 0.3, 1]}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={styles.footer}>
              <Text numberOfLines={1} style={styles.title}>{doc.title}</Text>
              {!!venueName && <Text numberOfLines={1} style={styles.venue}>{venueName}</Text>}
              <Text style={[styles.count, { color: theme.accent }]}>
                {doc.photoCount} photo{doc.photoCount === 1 ? '' : 's'}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
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
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 10,
  },
  title: {
    color: '#f4efe1',
    fontSize: 13,
    fontFamily: FONTS.display,
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  venue: {
    color: 'rgba(244,239,225,0.7)',
    fontSize: 11,
    fontFamily: FONTS.body,
    marginBottom: 2,
  },
  count: {
    fontSize: 10,
    fontFamily: MONO,
    letterSpacing: 0.3,
  },
});
