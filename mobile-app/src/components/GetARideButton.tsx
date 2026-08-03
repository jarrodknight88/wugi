// ─────────────────────────────────────────────────────────────────────
// Wugi — "Get a ride" action. Opens the Uber universal link with
// dropoff pinned to the given coordinates; Linking.openURL falls back to
// the mobile-web flow when the Uber app isn't installed (no SDK/package).
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { Linking, Text, TouchableOpacity } from 'react-native';
import type { Theme } from '../constants/colors';
import { FONTS } from '../constants/fonts';
import { CarIcon } from './icons';
import { buildUberRideLink } from '../utils/uberDeepLink';

type Props = {
  latitude: number;
  longitude: number;
  nickname?: string;
  theme: Theme;
};

export function GetARideButton({ latitude, longitude, nickname, theme }: Props) {
  const onPress = () => {
    Linking.openURL(buildUberRideLink({ latitude, longitude, nickname })).catch(() => {});
  };
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        alignSelf: 'flex-start',
        paddingVertical: 8, paddingHorizontal: 12,
        borderRadius: 10, borderWidth: 1, borderColor: theme.border,
        backgroundColor: theme.card,
      }}
    >
      <CarIcon color={theme.accent}/>
      <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.medium }}>Get a ride</Text>
    </TouchableOpacity>
  );
}
