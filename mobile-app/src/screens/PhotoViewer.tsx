// ─────────────────────────────────────────────────────────────────────
// Wugi — PhotoViewer Screen  (UAT V4 polish)
//
// Changes vs prior:
//   • Top toolbar: ported to the Event/Venue glass-pill pattern
//     (BlurView 40×40, intensity:20 tint:dark, 1px border, top:64
//     left:20/right:20). Top-right is a single kebab pill that opens
//     an iOS ActionSheet (Android: Alert) with Share + Report —
//     identical pattern to EventScreen / VenueScreen.
//   • Bottom toolbar: now Like / Buy / Send only. Info icon and Report
//     icon are removed — Info is replaced by a persistent info overlay
//     anchored above the bottom toolbar (joins the icon-overlay fade),
//     and Report lives in the kebab overflow.
//   • Send icon (paper-plane) replaces the bottom-toolbar Share icon
//     while preserving the share-sheet handler. Buy icon swapped to
//     ShoppingBagIcon for a cleaner read.
//   • Double-tap heart animation enlarged from 22px → 100px to match
//     Instagram scale.
//   • Like / Unlike now writes to the existing top-level `favorites`
//     collection via firestoreService.addFavorite / removeFavorite
//     (itemType: 'photo'), using the same deterministic doc id
//     `${uid}_photo_${photoId}` as event/venue favorites. Local
//     `liked` state drives UI instantly; the write is fire-and-forget.
//     Note: RootNavigator's in-memory `favorites` array still skips
//     photo hydration on login (FavoriteItem.type today is
//     'event'|'venue' only — see types/index.ts). That doesn't matter
//     for like/unlike correctness; Saved-tab UI for photos is a
//     post-launch follow-up that will require extending FavoriteItem.
//   • Tap-to-toggle behavior unchanged: single-tap → fade both the icon
//     overlay AND the info overlay; double-tap → like.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView, Animated, PanResponder, StyleSheet, Dimensions, Alert, Platform, ActionSheetIOS } from 'react-native';
import { SecureImageView } from '../../modules/secure-image-view';
import Svg, { Path, LinearGradient as SvgLinearGradient, Stop, Defs, Rect } from 'react-native-svg';
import { BlurView } from 'expo-blur';
// SDK 54 (expo-file-system v19) removed `cacheDirectory` + `downloadAsync`
// from the package's main entry — they live only in the `/legacy` entry now.
// The new File-class API is not yet adopted here, so import the legacy
// surface explicitly. Without this, both symbols are `undefined` and the
// share handler threw silently (caught + logged), leaving Share dead.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { Theme } from '../constants/colors';
import type { GalleryPhoto } from '../types';
import { BackIcon, HeartIcon, KebabVerticalIcon, ShoppingBagIcon, SendIcon } from '../components/icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Big double-tap heart — Instagram-scale.
const BIG_HEART_SIZE = 100;

type Props = {
  photos: GalleryPhoto[];
  initialIndex: number;
  galleryTitle: string;
  venue: string;
  date: string;
  onBack: () => void;
  // When provided, the venue line in the info overlay becomes tappable and
  // deep-links to the venue profile (resolved venueId owned by the navigator).
  onVenuePress?: () => void;
  // Synthetic ids (`${galleryId}-${index}`) of photos already liked in the
  // favorites store. Owned by RootNavigator (live `favorites` state) and passed
  // at render so hearts render filled on FIRST paint for EVERY photo regardless
  // of entry path (normal gallery nav OR Saved deep-link), and re-fill reactively
  // if favorites hydrate after mount (cold deep-link). See render-time derivation
  // in `isPhotoLiked`.
  likedPhotoIds?: string[];
  // Optimistic, in-memory-only sync of a like/unlike back to RootNavigator's
  // `favorites` array (NO Firestore write — that stays in persistLikeToggle).
  // Keeps `likedPhotoIds` reactive within-session so the Saved tab updates
  // immediately and a viewer re-entry (fresh mount, empty overrides) stays
  // correct. `meta` lets the navigator build a usable Saved card.
  onPhotoLikeChange?: (
    photoId: string,
    liked: boolean,
    meta: { title: string; subtitle: string; image: string },
  ) => void;
  theme: Theme;
};

export function PhotoViewer({ photos, initialIndex, galleryTitle, venue, date, onBack, onVenuePress, likedPhotoIds, onPhotoLikeChange, theme }: Props) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [showUI, setShowUI]   = useState(true);
  // In-session like/unlike overrides ONLY. The source of truth at render time is
  // the favorites store (`likedPhotoIds`); this map records the user's taps this
  // session so an in-session toggle wins over (and survives a late hydration of)
  // the store. Never seeded from `{}` for display — display is derived below.
  const [likedOverrides, setLikedOverrides] = useState<Record<string, boolean>>({});
  // Store membership as a Set for O(1) lookup; rebuilt only when the prop changes.
  const storeLikedIds = useMemo(() => new Set(likedPhotoIds || []), [likedPhotoIds]);
  // Effective liked state for a photo: an in-session override wins; otherwise
  // fall back to the favorites store. Used by both render and the toggles.
  const isPhotoLiked = (id: string): boolean =>
    Object.prototype.hasOwnProperty.call(likedOverrides, id) ? likedOverrides[id] : storeLikedIds.has(id);

  const scrollRef    = useRef<ScrollView>(null);
  const uiOpacity    = useRef(new Animated.Value(1)).current;
  const translateY   = useRef(new Animated.Value(0)).current;
  const likeScale    = useRef(new Animated.Value(1)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const lastTap      = useRef<number>(0);

  const photo = photos[currentIndex];

  useEffect(() => {
    if (initialIndex > 0) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({ x: initialIndex * SCREEN_WIDTH, animated: false });
      }, 50);
    }
  }, []);

  const toggleUI = () => {
    Animated.timing(uiOpacity, { toValue: showUI ? 0 : 1, duration: 200, useNativeDriver: true }).start();
    setShowUI(p => !p);
  };

  const animateHeart = () => {
    heartOpacity.setValue(0);
    likeScale.setValue(0.5);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(heartOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
        Animated.spring(likeScale, { toValue: 1.4, useNativeDriver: true }),
      ]),
      Animated.spring(likeScale, { toValue: 1, useNativeDriver: true }),
      // Tightened: no 500ms hold — fade out promptly so the heart doesn't linger.
      Animated.timing(heartOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  // Fire-and-forget persistence for like/unlike. Writes to the shared
  // top-level `favorites` collection (itemType: 'photo') via the same
  // firestoreService helpers event/venue saves use — deterministic doc
  // id `${uid}_photo_${photoId}` keeps add/remove idempotent and aligns
  // with the existing Firestore security rules.
  const persistLikeToggle = async (photoId: string, willBeLiked: boolean) => {
    try {
      const { getAuth } = await import('@react-native-firebase/auth');
      const uid = getAuth().currentUser?.uid;
      if (!uid) return; // signed-out — skip write silently
      const svc = await import('../../firestoreService');
      if (willBeLiked) {
        await svc.addFavorite(uid, 'photo', photoId);
      } else {
        await svc.removeFavorite(uid, 'photo', photoId);
      }
    } catch (e) {
      console.log('PhotoViewer: favorites write failed', e);
    }
  };

  const toggleLike = () => {
    const isLiked = isPhotoLiked(photo.id);
    const next = !isLiked;
    setLikedOverrides(p => ({ ...p, [photo.id]: next }));
    if (next) animateHeart();
    persistLikeToggle(photo.id, next);
    onPhotoLikeChange?.(photo.id, next, { title: galleryTitle, subtitle: venue, image: photo.uri });
  };

  // Share the FULL-RES photo. iOS' share sheet needs a real LOCAL file URI —
  // handing it the remote URL is what produced the broken-thumbnail preview
  // and the failed Share-to-Photos / Messages through #71–#73. So we download
  // the image to a cache file first, then share that file. Every failure path
  // now surfaces a visible Alert instead of a swallowed console.log — that
  // silent catch is exactly what hid this regression for three builds.
  const handleShare = async () => {
    const uri = photo?.uri;
    try {
      if (!uri) throw new Error('This photo isn’t available to share yet.');
      // expo-sharing must be available (it is on iOS/Android; guards web/sims).
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Sharing isn’t available on this device.');
      }
      const baseDir = FileSystem.cacheDirectory;
      if (!baseDir) throw new Error('No local cache directory is available.');
      // Sanitize the id into a safe filename (synthetic ids contain hyphens;
      // gallery ids can contain other punctuation).
      const safeName = String(photo.id || 'photo').replace(/[^a-zA-Z0-9_-]/g, '_');
      const localUri = `${baseDir}wugi_${safeName}.jpg`;
      const { status } = await FileSystem.downloadAsync(uri, localUri);
      if (status !== 200) throw new Error(`Couldn’t download the image (HTTP ${status}).`);
      await Sharing.shareAsync(localUri, { mimeType: 'image/jpeg', dialogTitle: galleryTitle, UTI: 'public.jpeg' });
    } catch (e: any) {
      console.log('PhotoViewer share error:', e);
      Alert.alert('Couldn’t share photo', e?.message || 'Something went wrong preparing this photo. Please try again.');
    }
  };

  // Existing Wugi Report pattern — same simple acknowledgement Alert
  // EventScreen / VenueScreen / ItineraryDetailScreen all use today.
  const handleReport = () => {
    Alert.alert(
      'Report Photo',
      'Thank you — we\'ll review this photo.',
      [{ text: 'OK' }],
    );
  };

  // Kebab overflow — mirrors EventScreen / VenueScreen /
  // ItineraryDetailScreen pattern (ActionSheetIOS on iOS, fallback
  // Alert on Android). Options: Share, Report.
  const openOverflowMenu = () => {
    const sheetTitle = galleryTitle || 'Photo';
    if (Platform.OS === 'ios') {
      const options = ['Share', 'Report', 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: options.length - 1,
          destructiveButtonIndex: options.indexOf('Report'),
          title: sheetTitle,
        },
        (index: number) => {
          if (index === 0) handleShare();
          else if (index === 1) handleReport();
        },
      );
    } else {
      Alert.alert(sheetTitle, 'Choose an action', [
        { text: 'Share',  onPress: handleShare },
        { text: 'Report', onPress: handleReport, style: 'destructive' },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > Math.abs(g.dx) * 2 && Math.abs(g.dy) > 10,
    onPanResponderMove: (_, g) => { if (g.dy > 0) translateY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 80) {
        Animated.timing(translateY, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }).start(onBack);
      } else {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  const handleTap = () => {
    const now = Date.now();
    const isDouble = now - lastTap.current < 300;
    lastTap.current = now;
    if (isDouble) {
      const isLiked = isPhotoLiked(photo.id);
      const next = !isLiked;
      setLikedOverrides(p => ({ ...p, [photo.id]: next }));
      if (next) animateHeart();
      persistLikeToggle(photo.id, next);
      onPhotoLikeChange?.(photo.id, next, { title: galleryTitle, subtitle: venue, image: photo.uri });
    } else {
      setTimeout(() => {
        if (Date.now() - lastTap.current >= 280) toggleUI();
      }, 300);
    }
  };

  const onScrollEnd = (e: any) =>
    setCurrentIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH));

  const scrollTo = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
    setCurrentIndex(index);
  };

  // ── Shared glass-pill style for top icon buttons ─────────────────
  // Mirrors EventScreen / VenueScreen Wave 1 pattern exactly (40×40,
  // intensity:20 tint:dark, 1px border at 15% on-image).
  const glassPill = {
    width: 40, height: 40, borderRadius: 20, overflow: 'hidden' as const,
    borderWidth: 1, borderColor: 'rgba(244,239,225,0.15)',
    alignItems: 'center' as const, justifyContent: 'center' as const,
  };

  return (
    <Animated.View
      style={{ flex: 1, backgroundColor: '#000', transform: [{ translateY }] }}
      {...panResponder.panHandlers}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {photos.map(item => (
          <TouchableOpacity
            key={item.id}
            activeOpacity={1}
            onPress={handleTap}
            style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT, justifyContent: 'center' }}
          >
            <SecureImageView
              uri={item.uri}
              style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.85 }}
              maxZoomScale={4}
              onSecureStateChange={(e) => {
                if (!e.nativeEvent.secure) {
                  console.warn('[SecureImageView] protection fell back to insecure for', item.uri);
                }
              }}
            />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Double-tap heart — Instagram-scale, centered over the photo. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute', alignSelf: 'center',
          top: SCREEN_HEIGHT / 2 - BIG_HEART_SIZE / 2,
          opacity: heartOpacity, transform: [{ scale: likeScale }],
        }}
      >
        <HeartIcon color="#FF3B30" filled size={BIG_HEART_SIZE}/>
      </Animated.View>

      {/* UI overlay — top + bottom toolbars + info overlay, fade together. */}
      <Animated.View
        style={{ ...StyleSheet.absoluteFillObject, opacity: uiOpacity }}
        pointerEvents={showUI ? 'box-none' : 'none'}
      >
        {/* Prev arrow */}
        {currentIndex > 0 && (
          <TouchableOpacity
            onPress={() => scrollTo(currentIndex - 1)}
            style={{ position: 'absolute', left: 10, top: '50%', marginTop: -22, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M15 18l-6-6 6-6" stroke="rgba(255,255,255,0.5)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </TouchableOpacity>
        )}
        {/* Next arrow */}
        {currentIndex < photos.length - 1 && (
          <TouchableOpacity
            onPress={() => scrollTo(currentIndex + 1)}
            style={{ position: 'absolute', right: 10, top: '50%', marginTop: -22, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M9 18l6-6-6-6" stroke="rgba(255,255,255,0.5)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </TouchableOpacity>
        )}

        {/* Top bar — glass-pill Back (left) + counter + glass-pill Share +
            glass-pill Report (right). Matches Event/Venue Wave-1 pattern. */}
        <View style={{ position: 'absolute', top: 64, left: 20, right: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity onPress={onBack} activeOpacity={0.85}>
            <BlurView intensity={20} tint="dark" style={glassPill}>
              <BackIcon color="#f4efe1"/>
            </BlurView>
          </TouchableOpacity>

          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>
            {currentIndex + 1} / {photos.length}
          </Text>

          <TouchableOpacity onPress={openOverflowMenu} activeOpacity={0.85}>
            <BlurView intensity={20} tint="dark" style={glassPill}>
              <KebabVerticalIcon color="#f4efe1"/>
            </BlurView>
          </TouchableOpacity>
        </View>

        {/* Info overlay — Event / Venue / Date as a single left-aligned
            stack, anchored ABOVE the bottom toolbar icons (paddingBottom
            clears the toolbar). Shares the same dark gradient the toolbar
            sits on so the two read as one pad. Fades in/out with the rest
            of the UI overlay (parent `uiOpacity`). `galleryTitle` carries
            the event name (gallery titles are event-named in our data;
            eventId backfill tracked separately). */}
        {/* box-none (not none): the gradient/title/date stay non-interactive but
            the venue line below can receive taps when onVenuePress is wired. */}
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
          <View pointerEvents="box-none" style={{ width: '100%', height: 210, position: 'relative', justifyContent: 'flex-end' }}>
            <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
              <Defs>
                <SvgLinearGradient id="photoInfoGrad" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#000" stopOpacity="0"/>
                  <Stop offset="0.6" stopColor="#000" stopOpacity="0.6"/>
                  <Stop offset="1" stopColor="#000" stopOpacity="0.95"/>
                </SvgLinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#photoInfoGrad)"/>
            </Svg>
            <View style={{ paddingHorizontal: 20, paddingBottom: 116 }}>
              <Text numberOfLines={1} style={{ color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 }}>
                {galleryTitle}
              </Text>
              {!!venue && (
                onVenuePress ? (
                  <TouchableOpacity onPress={onVenuePress} activeOpacity={0.7} hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                    <Text numberOfLines={1} style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
                      {venue}
                    </Text>
                    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                      <Path d="M9 18l6-6-6-6" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
                    </Svg>
                  </TouchableOpacity>
                ) : (
                  <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 3 }}>
                    {venue}
                  </Text>
                )
              )}
              {!!date && (
                <Text numberOfLines={1} style={{ color: theme.accent, fontSize: 12, marginTop: 3 }}>
                  {date}
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* Bottom bar — Like / Buy / Send. */}
        <SafeAreaView style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 24, paddingBottom: 32, paddingTop: 16, backgroundColor: 'rgba(0,0,0,0.55)' }}>
            <TouchableOpacity style={{ alignItems: 'center', gap: 4 }} onPress={toggleLike}>
              <HeartIcon color={isPhotoLiked(photo.id) ? '#e74c3c' : '#fff'} filled={isPhotoLiked(photo.id)}/>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>Like</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', gap: 4 }}>
              <ShoppingBagIcon color="#fff"/>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>Buy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', gap: 4 }} onPress={handleShare}>
              <SendIcon color="#fff"/>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>Send</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Animated.View>
    </Animated.View>
  );
}
