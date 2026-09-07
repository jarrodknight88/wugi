// ─────────────────────────────────────────────────────────────────────
// Wugi — MyPhotosScreen ("My Photos")
//
// Lists every photo the signed-in user has unlocked (free-credit or
// purchased) — re-downloadable forever, since entitlement is a permanent
// ledger record (`unlocks` collection), not a time-boxed grant. Self-fetches
// on mount, mirroring MyPassesScreen's pattern in
// mobile-app/src/features/ticketing/PassScreens.tsx. Tapping a photo hands
// off to the existing PhotoViewer deep-link path (onPhotoPress — the same
// callback FavoritesScreen wires to RootNavigator's openLikedPhoto), so
// download/share reuses the viewer's existing handleShare flow.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, FlatList, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../constants/colors';
import { FONTS, MONO } from '../constants/fonts';
import { SkeletonBlock } from '../components/Skeleton';
import { listMyUnlocks, resolveUnlockedPhotos, getUserProfile, type UnlockedPhoto } from '../../firestoreService';
import { creditsDecimal } from '../utils/credits';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = 3;
const GRID_COLUMNS = 3;
const CELL_SIZE = (SCREEN_WIDTH - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

type Props = {
  theme: Theme;
  onBack: () => void;
  // Same shape as FavoritesScreen's onPhotoPress — parses the synthetic
  // `${galleryId}-${index}` id and opens PhotoViewer at that exact photo.
  onPhotoPress: (photoId: string) => void;
};

export function MyPhotosScreen({ theme, onBack, onPhotoPress }: Props) {
  const [photos,  setPhotos]  = useState<UnlockedPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  // Small persistent wallet balance (issue #282) — same source of truth as
  // AccountScreen's "Photo Credits" row, shown here too since this is the
  // other screen a user visits specifically about paid photo unlocks.
  const [creditBalanceHalfCredits, setCreditBalanceHalfCredits] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { getAuth } = await import('@react-native-firebase/auth');
      const uid = getAuth().currentUser?.uid;
      if (!uid) { setPhotos([]); return; }
      const [unlocks, profile] = await Promise.all([listMyUnlocks(uid), getUserProfile(uid)]);
      setPhotos(await resolveUnlockedPhotos(unlocks));
      setCreditBalanceHalfCredits(profile?.creditBalanceHalfCredits ?? 0);
    } catch (e) {
      console.log('MyPhotosScreen load failed', e);
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ width: 36, alignItems: 'flex-start' }}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M15 18l-6-6 6-6" stroke={theme.text} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </TouchableOpacity>
          <Text style={{ color: theme.text, fontSize: 20, fontFamily: FONTS.display, letterSpacing: -0.5 }}>My Photos</Text>
          <View style={{ width: 36, alignItems: 'flex-end' }}>
            {creditBalanceHalfCredits != null && (
              <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.3 }}>
                {creditsDecimal(creditBalanceHalfCredits)}✦
              </Text>
            )}
          </View>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <SkeletonBlock key={i} theme={theme} width={CELL_SIZE} height={CELL_SIZE} borderRadius={0}/>
          ))}
        </View>
      ) : photos.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.5, marginBottom: 8 }}>NO UNLOCKS YET</Text>
          <Text style={{ color: theme.text, fontSize: 14, fontFamily: FONTS.body, textAlign: 'center', lineHeight: 20 }}>
            Every account gets one free HD photo unlock. Unlocked photos show up here, forever.
          </Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={item => item.photoId}
          numColumns={GRID_COLUMNS}
          columnWrapperStyle={{ gap: GRID_GAP }}
          contentContainerStyle={{ gap: GRID_GAP, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <TouchableOpacity activeOpacity={0.85} onPress={() => onPhotoPress(item.photoId)}>
              <Image source={{ uri: item.uri }} style={{ width: CELL_SIZE, height: CELL_SIZE, backgroundColor: theme.card }} contentFit="cover"/>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}
