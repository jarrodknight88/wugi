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
import { View, Text, TouchableOpacity, SafeAreaView, FlatList, ActivityIndicator, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../constants/colors';
import { FONTS, MONO } from '../constants/fonts';
import { listMyUnlocks, resolveUnlockedPhotos, type UnlockedPhoto } from '../../firestoreService';

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { getAuth } = await import('@react-native-firebase/auth');
      const uid = getAuth().currentUser?.uid;
      if (!uid) { setPhotos([]); return; }
      const unlocks = await listMyUnlocks(uid);
      setPhotos(await resolveUnlockedPhotos(unlocks));
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
          <View style={{ width: 36 }}/>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} size="large"/>
          <Text style={{ color: theme.subtext, fontSize: 13, marginTop: 12 }}>Loading your photos...</Text>
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
