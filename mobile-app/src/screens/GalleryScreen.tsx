// ─────────────────────────────────────────────────────────────────────
// Wugi — GalleryScreen
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import {
  View, Text, Image, TouchableOpacity,
  ScrollView, SafeAreaView, Dimensions,
} from 'react-native';
import type { Theme } from '../constants/colors';
import type { GalleryData } from '../types';
import { BackIcon, ShareIcon } from '../components/icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Props = {
  gallery: GalleryData;
  onBack: () => void;
  onPhotoPress: (index: number) => void;
  theme: Theme;
};

export function GalleryScreen({ gallery, onBack, onPhotoPress, theme }: Props) {
  const COL_WIDTH = (SCREEN_WIDTH - 36) / 2;
  const leftCol   = gallery.photos.filter((_, i) => i % 2 === 0);
  const rightCol  = gallery.photos.filter((_, i) => i % 2 === 1);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ backgroundColor: theme.bg, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 }}>
          <TouchableOpacity style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 8 }} onPress={onBack}>
            <BackIcon color={theme.text}/>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.3 }} numberOfLines={1}>
              {gallery.title}
            </Text>
            <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 1 }}>
              {gallery.venue} · {gallery.date}
            </Text>
          </View>
          <TouchableOpacity style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <ShareIcon color={theme.subtext}/>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 12 }}>
        <Text style={{ color: theme.subtext, fontSize: 12, marginBottom: 12, paddingHorizontal: 2 }}>
          {gallery.photos.length} photos
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            {leftCol.map((photo, i) => (
              <TouchableOpacity key={photo.id} style={{ marginBottom: 8 }} onPress={() => onPhotoPress(i * 2)} activeOpacity={0.9}>
                <Image source={{ uri: photo.uri }} style={{ width: COL_WIDTH, height: photo.height, borderRadius: 10 }} resizeMode="cover"/>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flex: 1 }}>
            {rightCol.map((photo, i) => (
              <TouchableOpacity key={photo.id} style={{ marginBottom: 8 }} onPress={() => onPhotoPress(i * 2 + 1)} activeOpacity={0.9}>
                <Image source={{ uri: photo.uri }} style={{ width: COL_WIDTH, height: photo.height, borderRadius: 10 }} resizeMode="cover"/>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={{ height: 20 }}/>
      </ScrollView>
    </View>
  );
}
