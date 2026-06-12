// ─────────────────────────────────────────────────────────────────────
// Wugi — VenueGalleriesListScreen   (full "All →" destination)
//
// Pushed from the GALLERIES section on VenueScreen v2 when a venue has
// more than VENUE_GALLERIES_INLINE_MAX (4) galleries. Renders ALL galleries
// for one venueId in a vertical 2-col aspect-1 grid, then taps through
// to the existing GalleryScreen → PhotoViewer flow.
//
// Read-only against the top-level `galleries` collection. Same query +
// sort that VenueScreen.tsx uses (single-field where venueId == X, sort
// by createdAt desc client-side — no composite index needed).
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../constants/colors';
import type { GalleryData, GalleryDoc } from '../types';
import { FONTS, MONO } from '../constants/fonts';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GUTTER = 16;
const GAP = 8;
const CARD_W = (SCREEN_WIDTH - GUTTER * 2 - GAP) / 2;
const GALLERY_PURPLE = '#9b59b6';

type Props = {
  venueId: string;
  theme: Theme;
  onBack: () => void;
  onGalleryPress: (gallery: GalleryData) => void;
};

export function VenueGalleriesListScreen({ venueId, theme, onBack, onGalleryPress }: Props) {
  const [galleries, setGalleries] = useState<GalleryDoc[]>([]);
  const [venueName, setVenueName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getFirestore, collection, getDocs, query, where, doc, getDoc } =
          await import('@react-native-firebase/firestore');
        const db = getFirestore();
        const [gsnap, vdoc] = await Promise.all([
          getDocs(query(collection(db, 'galleries'), where('venueId', '==', venueId))),
          getDoc(doc(collection(db, 'venues'), venueId)),
        ]);
        if (cancelled) return;
        const gdocs: GalleryDoc[] = gsnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as object) }) as GalleryDoc);
        gdocs.sort((a, b) => {
          const ta = (a.createdAt as any)?.toMillis ? (a.createdAt as any).toMillis() : 0;
          const tb = (b.createdAt as any)?.toMillis ? (b.createdAt as any).toMillis() : 0;
          return tb - ta;
        });
        setGalleries(gdocs);
        if (vdoc.exists()) setVenueName(((vdoc.data() as any)?.name) || '');
      } catch (e) {
        console.log('VenueGalleriesListScreen: load failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [venueId]);

  const toGalleryData = (g: GalleryDoc): GalleryData => ({
    id: g.id,
    title: g.title,
    venue: venueName,
    date: g.date,
    coverImage: g.coverImage,
    photos: (g.images || []).map((uri, i) => ({ id: `${g.id}-${i}`, uri, height: 1000 })),
    venueId: g.venueId || venueId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header — back left, title centered, spacer right */}
      <SafeAreaView style={{ paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ width: 36, alignItems: 'flex-start' }}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M15 18l-6-6 6-6" stroke={theme.text} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </TouchableOpacity>
          <Text style={{ color: theme.text, fontSize: 20, fontFamily: FONTS.display, letterSpacing: -0.5 }}>Galleries</Text>
          <View style={{ width: 36 }}/>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 16, paddingBottom: 40 }}>
        {!!venueName && (
          <View style={{ paddingHorizontal: GUTTER, paddingBottom: 14 }}>
            <Text style={{ color: GALLERY_PURPLE, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 }}>
              {galleries.length} {galleries.length === 1 ? 'NIGHT' : 'NIGHTS'} · NIGHTS HERE, CAPTURED
            </Text>
            <Text style={{ color: theme.text, fontSize: 22, fontFamily: FONTS.display, letterSpacing: -0.6 }} numberOfLines={2}>
              {venueName}
            </Text>
          </View>
        )}

        {loading ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}>
            <ActivityIndicator color={theme.accent} size="large"/>
          </View>
        ) : galleries.length === 0 ? (
          <View style={{ paddingTop: 60, paddingHorizontal: 32, alignItems: 'center' }}>
            <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.display, letterSpacing: -0.2, marginBottom: 6, textAlign: 'center' }}>
              No galleries yet
            </Text>
            <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, textAlign: 'center', opacity: 0.7 }}>
              Photos from this venue will appear here as Wugi Lens photographers publish them.
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: GUTTER, flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
            {galleries.map(g => (
              <TouchableOpacity
                key={g.id}
                activeOpacity={0.9}
                onPress={() => onGalleryPress(toGalleryData(g))}
                style={{ width: CARD_W, height: CARD_W, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.card }}
              >
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
        )}
      </ScrollView>
    </View>
  );
}
