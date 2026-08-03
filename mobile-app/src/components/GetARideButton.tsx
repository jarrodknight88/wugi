// ─────────────────────────────────────────────────────────────────────
// Wugi — GetARideButton
// "Get a ride" action shared by EventScreen, VenueScreen, and
// ItineraryDetailScreen (UAT-W2B). Builds an Uber universal link from the
// venue's geocoded coordinates — no SDK/package, Linking.openURL falls
// back to the browser natively when Uber isn't installed. Renders nothing
// when the venue has no location (no fabricated coordinates).
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { TouchableOpacity, Text, Linking } from 'react-native';
import type { Theme } from '../constants/colors';
import { FONTS } from '../constants/fonts';
import { CarIcon } from './icons';
import { buildUberRideLink } from '../utils/uberDeepLink';

type Props = {
  location?: { latitude: number; longitude: number } | null;
  venueName?: string;
  theme: Theme;
  style?: object;
};

export function GetARideButton({ location, venueName, theme, style }: Props) {
  if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
    return null;
  }
  const onPress = () => {
    Linking.openURL(buildUberRideLink(location, venueName)).catch(() => {});
  };
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10,
        backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
      }, style]}
    >
      <CarIcon color={theme.text}/>
      <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.medium }}>Get a ride</Text>
    </TouchableOpacity>
  );
}
