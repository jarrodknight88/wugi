// ─────────────────────────────────────────────────────────────────────
// Wugi — DealCard
//
// The canonical deal card, extracted VERBATIM from the Home "Deals &
// Specials" shelf so Venue, Discover (and Home) all render deals the same
// way. Visuals are unchanged from the original Home implementation: full-
// bleed image + overlay, terracotta "DEAL" badge, title / venue / offer.
// New surfaces reuse this — they do NOT restyle it.
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import type { Theme } from '../constants/colors';
import type { FSDeal } from '../types';
import { FONTS, MONO } from '../constants/fonts';
import { dealOffer } from '../utils/deals';

// Terracotta deal accent — moved here with the card (was a Home-local const).
export const DEAL_COLOR = '#a8533f';

export function DealCard({ deal, theme, onPress, width = 260 }: {
  deal: FSDeal;
  theme: Theme;
  onPress?: () => void;
  width?: number;
}) {
  return (
    <TouchableOpacity
      style={{ width, height: 150, borderRadius: 14, overflow: 'hidden' }}
      activeOpacity={onPress ? 0.9 : 1}
      onPress={onPress}
      disabled={!onPress}
    >
      <Image cachePolicy="memory-disk" source={{ uri: deal.image || 'https://picsum.photos/seed/deal/400/300' }} style={StyleSheet.absoluteFillObject} contentFit="cover"/>
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: theme.overlayMedium }}/>
      <View style={{ position: 'absolute', top: 10, left: 10, backgroundColor: DEAL_COLOR, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 }}>
        <Text style={{ color: theme.onImage, fontSize: 9, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.8 }}>DEAL</Text>
      </View>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14 }}>
        <Text style={{ color: theme.onImage, fontSize: 15, fontFamily: FONTS.display, letterSpacing: -0.2, marginBottom: 2 }} numberOfLines={1}>{deal.title}</Text>
        <Text style={{ color: theme.onImageSoft, fontSize: 11, fontFamily: FONTS.body, marginBottom: 4 }} numberOfLines={1}>{deal.venueName}</Text>
        <Text style={{ color: theme.accent, fontSize: 11, fontFamily: FONTS.medium }} numberOfLines={1}>{dealOffer(deal)}</Text>
      </View>
    </TouchableOpacity>
  );
}
