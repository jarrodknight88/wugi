// ─────────────────────────────────────────────────────────────────────
// Wugi — GalleryScreen   (UAT V4 Fix 2 — masonry + pagination)
//
// Per-venue gallery detail. The previous manual alternating-column layout
// used a placeholder `photo.height` constant (1000 or 300) for every tile,
// which gave every image the same height and caused portrait/landscape
// photos to skew under `contentFit="cover"`. v2 ports to a real masonry
// layout that respects each photo's native aspect ratio, sourced from the
// width/height fields on the top-level /photos docs (written by the Wave 2
// import pipeline).
//
// Pagination: Firestore /photos where galleryId == this.gallery.id, page
// size 50. Sort is client-side by `createdAt` within each page (no
// server-side orderBy so we don't trigger a composite-index requirement).
// onEndReached fires the next page at 50% of the remaining scroll;
// a single in-flight request is guaranteed by `loadingRef`. On fetch
// failure the ref resets so a later trigger can retry.
//
// Library: react-native-masonry-list v2.16.2 — pure JS, no native step.
// It accepts `images: [{uri, width, height}]` and respects dimensions
// directly (no Image.getSize round-trip when width+height are supplied).
//
// Photo tap → onPhotoPress(index) is the existing callback (RootNavigator
// owns the close-side wiring; we don't touch it). We look up the tapped
// photo's URI in the parent-supplied `gallery.photos[]` so the resolved
// index matches what PhotoViewer expects. This decouples Firestore-order
// from the parent's embedded-array order. For >50-photo galleries where
// pagination crosses the parent array's length, the URI lookup may miss
// (parent didn't supply that photo's URI); we fall back to the masonry
// index. That follow-up is recorded in docs/design_handoffs/venue/README.md
// — no real venue has >50 photos today.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, Dimensions, ActivityIndicator, Animated, Easing, StyleSheet } from 'react-native';
import { ChevronRightIcon } from '../components/icons';
import { Image as ExpoImage } from 'expo-image';
import MasonryList from 'react-native-masonry-list';
import type { Theme } from '../constants/colors';
import type { GalleryData } from '../types';
import { BackIcon, ShareIcon } from '../components/icons';
import { logGalleryViewed } from '../analytics/analyticsService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PAGE_SIZE = 50;

// Pulsing skeleton shown behind each masonry tile while its photo loads.
// Lightweight looping-opacity pulse (no gradient sweep) — keeps it cheap
// across a 2-column masonry grid.
function PhotoSkeleton({ theme, style }: { theme: Theme; style?: any }) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.8, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ backgroundColor: theme.card, opacity: pulse }, style]} />;
}

// Custom masonry image. react-native-masonry-list renders each cell with a
// hardcoded `backgroundColor: "gainsboro"` gray box while the image loads
// (UAT V6). Swapping in our own image component via `customImageComponent`
// (which keeps the lib's TouchableOpacity wrapper, so taps still open
// PhotoViewer) lets us show a themed shimmer skeleton until onLoad, then
// fade the photo in. `theme` is threaded through `customImageProps`.
function MasonryPhoto({ source, style, theme }: { source: any; style?: any; theme: Theme }) {
  const [loaded, setLoaded] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const uri =
    (source && (source.uri || (typeof source === 'string' ? source : source?.source?.uri))) || '';
  // Drop the lib's gainsboro background; keep size + margin + borderRadius.
  const { backgroundColor, ...box } = (style || {}) as any;
  const reveal = () => {
    setLoaded(true);
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  };
  return (
    <View style={[box, { overflow: 'hidden', backgroundColor: theme.bg }]}>
      {!loaded && <PhotoSkeleton theme={theme} style={StyleSheet.absoluteFill} />}
      <Animated.View style={{ ...StyleSheet.absoluteFillObject, opacity: fade }}>
        <ExpoImage
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          cachePolicy="memory-disk"
          onLoad={reveal}
          onError={reveal}
        />
      </Animated.View>
    </View>
  );
}

type Props = {
  gallery: GalleryData;
  onBack: () => void;
  onPhotoPress: (index: number) => void;
  // When provided, the venue line under the title becomes tappable and
  // deep-links to the venue profile (resolved venueId owned by the navigator).
  onVenuePress?: () => void;
  theme: Theme;
};

type LoadedPhoto = {
  id: string;
  uri: string;
  width: number;
  height: number;
};

type MasonryImage = { uri: string; width: number; height: number };

export function GalleryScreen({ gallery, onBack, onPhotoPress, onVenuePress, theme }: Props) {
  const [photos, setPhotos]               = useState<LoadedPhoto[]>([]);
  const [hasMore, setHasMore]             = useState(true);
  const [loadingMore, setLoadingMore]     = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const lastDocRef = useRef<any>(null);
  const loadingRef = useRef(false);   // debounce concurrent loads
  const viewLoggedRef = useRef(false); // fire gallery_viewed once per mount

  // `reset:true` (pull-to-refresh / gallery change) ignores the hasMore guard,
  // clears the cursor, and REPLACES the photo list with page 1. `reset:false`
  // (onEndReached) appends the next page. Single in-flight load via loadingRef.
  const loadPage = async (reset: boolean) => {
    if (loadingRef.current) return;
    if (!reset && !hasMore) return;
    loadingRef.current = true;
    if (reset) lastDocRef.current = null;
    // Only show the in-grid "loading more" spinner when appending after the
    // initial page (never during a pull-to-refresh).
    else if (photos.length > 0) setLoadingMore(true);
    try {
      const { getFirestore, collection, getDocs, query, where, limit, startAfter } =
        await import('@react-native-firebase/firestore');
      const db = getFirestore();
      // No server-side orderBy: keeps us off composite-index territory.
      // Pagination cursor falls back to doc-id order; client-side sort by
      // capturedAt/createdAt within each page reorders visibly.
      let q = query(
        collection(db, 'photos'),
        where('galleryId', '==', gallery.id),
        limit(PAGE_SIZE),
      );
      if (!reset && lastDocRef.current) {
        q = query(
          collection(db, 'photos'),
          where('galleryId', '==', gallery.id),
          startAfter(lastDocRef.current),
          limit(PAGE_SIZE),
        );
      }
      const snap = await getDocs(q);
      const next: (LoadedPhoto & { _cap: any })[] = snap.docs
        .map((d: any) => {
          const p = d.data();
          return {
            id: d.id,
            uri: p.watermarkedUrl || '',
            width:  Number(p.width)  || 0,
            height: Number(p.height) || 0,
            // Stash for client-side sort; stripped before going to state.
            _cap: (p.capturedAt && typeof p.capturedAt === 'string') ? p.capturedAt : (p.createdAt?.toMillis?.() ?? 0),
          } as LoadedPhoto & { _cap: any };
        })
        .filter((p: LoadedPhoto) => !!p.uri && !!p.width && !!p.height);

      // Client-side sort: keep visible order roughly chronological even
      // though the server query has no orderBy.
      next.sort((a: any, b: any) => {
        if (a._cap < b._cap) return -1;
        if (a._cap > b._cap) return 1;
        return 0;
      });

      lastDocRef.current = snap.docs[snap.docs.length - 1] || (reset ? null : lastDocRef.current);
      const cleaned = next.map(({ _cap, ...rest }: any) => rest as LoadedPhoto);
      setPhotos(prev => reset ? cleaned : [...prev, ...cleaned]);
      setHasMore(snap.size === PAGE_SIZE);
    } catch (e) {
      console.log('GalleryScreen: page load failed', e);
      if (!reset) setHasMore(false);
    } finally {
      loadingRef.current = false;
      setInitialLoading(false);
      setLoadingMore(false);
      if (reset) setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    if (loadingRef.current) return;
    setRefreshing(true);
    setHasMore(true);
    loadPage(true);
  };

  useEffect(() => {
    // Reset on gallery change (defensive — RootNavigator currently mounts a
    // fresh instance per push, but keep this in case the prop ever updates).
    setPhotos([]);
    setHasMore(true);
    setInitialLoading(true);
    lastDocRef.current = null;
    loadingRef.current = false;
    viewLoggedRef.current = false;
    loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gallery.id]);

  // ── gallery_viewed — fires once, after the first page of photos loads ──
  useEffect(() => {
    if (initialLoading || viewLoggedRef.current) return;
    viewLoggedRef.current = true;
    logGalleryViewed({
      eventId:    gallery.eventId ?? null,
      venueId:    gallery.venueId ?? null,
      photoCount: photos.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoading]);

  const masonryImages: MasonryImage[] = useMemo(
    () => photos.map(p => ({ uri: p.uri, width: p.width, height: p.height })),
    [photos]
  );

  // Tap handler — resolve the tapped URI back to the parent's gallery.photos
  // index so the existing onPhotoPress(index) → PhotoViewer plumbing works
  // unchanged. RootNavigator passes the parent's `current.gallery.photos`
  // array to PhotoViewer; we don't touch that closure (hard constraint).
  const handlePress = (item: any, idx: number) => {
    const uri: string | undefined =
      item?.uri || item?.URI || item?.url || item?.source?.uri;
    const target = uri
      ? gallery.photos.findIndex(p => p.uri === uri)
      : -1;
    onPhotoPress(target >= 0 ? target : idx);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header */}
      <SafeAreaView style={{ backgroundColor: theme.bg, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 }}>
          <TouchableOpacity style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 8 }} onPress={onBack}>
            <BackIcon color={theme.text}/>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.3 }} numberOfLines={1}>
              {gallery.title}
            </Text>
            {gallery.venue ? (
              onVenuePress && gallery.venueId ? (
                <TouchableOpacity onPress={onVenuePress} activeOpacity={0.7} hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
                  <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
                    {gallery.venue}
                  </Text>
                  <ChevronRightIcon color={theme.accent}/>
                </TouchableOpacity>
              ) : (
                <Text style={{ color: theme.text, fontSize: 12, fontWeight: '600', marginTop: 2 }} numberOfLines={1}>
                  {gallery.venue}
                </Text>
              )
            ) : null}
            {gallery.date ? (
              <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
                {gallery.date}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <ShareIcon color={theme.subtext}/>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Body */}
      {initialLoading && photos.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} size="large"/>
        </View>
      ) : photos.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700', letterSpacing: -0.2, marginBottom: 6 }}>No photos yet</Text>
          <Text style={{ color: theme.subtext, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
            Photos from this gallery will appear here as the photographer publishes them.
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <MasonryList
            images={masonryImages}
            columns={2}
            spacing={1}
            backgroundColor={theme.bg}
            imageContainerStyle={{ borderRadius: 10 }}
            customImageComponent={MasonryPhoto}
            customImageProps={{ theme }}
            onPressImage={handlePress}
            onEndReached={() => {
              if (hasMore && !loadingRef.current) loadPage(false);
            }}
            onEndReachedThreshold={0.5}
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
          {/* "Loading more" indicator — overlaid at the bottom of the
              visible area while the next page fetches. Disappears when
              hasMore is false. */}
          {loadingMore && (
            <View pointerEvents="none" style={{ position: 'absolute', bottom: 20, left: 0, right: 0, alignItems: 'center' }}>
              <ActivityIndicator color={theme.accent}/>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
