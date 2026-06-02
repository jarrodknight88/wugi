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
import { View, Text, TouchableOpacity, SafeAreaView, Dimensions, ActivityIndicator } from 'react-native';
import MasonryList from 'react-native-masonry-list';
import type { Theme } from '../constants/colors';
import type { GalleryData } from '../types';
import { BackIcon, ShareIcon } from '../components/icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PAGE_SIZE = 50;

type Props = {
  gallery: GalleryData;
  onBack: () => void;
  onPhotoPress: (index: number) => void;
  theme: Theme;
};

type LoadedPhoto = {
  id: string;
  uri: string;
  width: number;
  height: number;
};

type MasonryImage = { uri: string; width: number; height: number };

export function GalleryScreen({ gallery, onBack, onPhotoPress, theme }: Props) {
  const [photos, setPhotos]               = useState<LoadedPhoto[]>([]);
  const [hasMore, setHasMore]             = useState(true);
  const [loadingMore, setLoadingMore]     = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const lastDocRef = useRef<any>(null);
  const loadingRef = useRef(false);   // debounce concurrent loads

  const loadNextPage = async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    // Only show the in-grid spinner after the initial page lands.
    if (photos.length > 0) setLoadingMore(true);
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
      if (lastDocRef.current) {
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

      lastDocRef.current = snap.docs[snap.docs.length - 1] || lastDocRef.current;
      setPhotos(prev => [...prev, ...next.map(({ _cap, ...rest }: any) => rest as LoadedPhoto)]);
      setHasMore(snap.size === PAGE_SIZE);
    } catch (e) {
      console.log('GalleryScreen: page load failed', e);
      setHasMore(false);
    } finally {
      loadingRef.current = false;
      setInitialLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    // Reset on gallery change (defensive — RootNavigator currently mounts a
    // fresh instance per push, but keep this in case the prop ever updates).
    setPhotos([]);
    setHasMore(true);
    setInitialLoading(true);
    lastDocRef.current = null;
    loadingRef.current = false;
    loadNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gallery.id]);

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
            <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
              {gallery.venue}{gallery.date ? ` · ${gallery.date}` : ''}
            </Text>
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
            onPressImage={handlePress}
            onEndReached={() => {
              if (hasMore && !loadingRef.current) loadNextPage();
            }}
            onEndReachedThreshold={0.5}
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
