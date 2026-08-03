// ─────────────────────────────────────────────────────────────────────
// Wugi — GetARideButton
// Shared "Get a ride" action for EventScreen / VenueScreen /
// ItineraryDetailScreen — opens the Uber universal deep link for the given
// dropoff coordinates. Renders nothing when no coordinates are supplied
// (real-data-only — no fabricated pickup for venues without geocoding).
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { TouchableOpacity, Text, Linking } from 'react-native';
import type { Theme } from '../constants/colors';
import { CarIcon } from './icons';
import { FONTS } from '../constants/fonts';
import { buildUberRideLink, type RideDropoff } from '../utils/uberDeepLink';

type Props = {
  dropoff: RideDropoff | null | undefined;
  theme: Theme;
  label?: string;
};

export function GetARideButton({ dropoff, theme, label = 'Get a ride' }: Props) {
  if (!dropoff) return null;
  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(buildUberRideLink(dropoff)).catch(() => {})}
      activeOpacity={0.8}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        alignSelf: 'flex-start',
        paddingVertical: 10, paddingHorizontal: 14,
        borderRadius: 10, borderWidth: 1, borderColor: theme.border,
        backgroundColor: theme.card,
      }}
    >
      <CarIcon color={theme.text}/>
      <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.medium }}>{label}</Text>
    </TouchableOpacity>
  );
}
