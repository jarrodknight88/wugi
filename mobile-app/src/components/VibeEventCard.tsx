// ─────────────────────────────────────────────────────────────────────
// Wugi — VibeEventCard
//
// The single source of truth for the home "Picks for you / FOR YOUR VIBES"
// event card (extracted from HomeScreen's inline JSX). Full-bleed image, a
// mono badge top-left, and title + subtitle bottom-left. Reused by:
//   • HomeScreen "Picks for you" (badge = vibe/daypart reason)
//   • VenueScreen upcoming-events section (badge = event date)
//   • VenueEventsListScreen "View all" (badge = event date)
//
// `width`/`height` default to the home shelf size (170×240); the venue surfaces
// pass a full-width size. `label` drives the top-left badge (omit → no badge).
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import type { Theme } from '../constants/colors';
import type { EventData } from '../types';
import { FONTS, MONO } from '../constants/fonts';

type Props = {
  event: EventData;
  theme: Theme;
  onPress: () => void;
  label?: string;
  width?: number;
  height?: number;
};

export function VibeEventCard({ event, theme, onPress, label, width = 170, height = 240 }: Props) {
  // No stock-photo fallback — an event without media gets a neutral
  // card-colored block instead of a random picsum image.
  const imageUri = (event.media || [])[0]?.uri;
  return (
    <TouchableOpacity
      style={{ width, height, borderRadius: 14, overflow: 'hidden' }}
      activeOpacity={0.9}
      onPress={onPress}
    >
      {imageUri ? (
        <Image
          cachePolicy="memory-disk"
          source={{ uri: imageUri }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.card }]}/>
      )}
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: theme.overlayMedium }}/>
      {!!label && (
        <View style={{ position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(244,239,225,0.18)', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Text style={{ color: theme.onImage, fontSize: 9, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.5 }} numberOfLines={1}>{label}</Text>
        </View>
      )}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14 }}>
        <Text style={{ color: theme.onImage, fontSize: 15, fontFamily: FONTS.display, letterSpacing: -0.2, lineHeight: 18, marginBottom: 3 }} numberOfLines={2}>{event.title}</Text>
        <Text style={{ color: theme.onImageMuted, fontSize: 11, fontFamily: FONTS.body }} numberOfLines={1}>{event.venue}{event.time ? ` · ${event.time}` : ''}</Text>
      </View>
    </TouchableOpacity>
  );
}
