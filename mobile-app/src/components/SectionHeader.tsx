// ─────────────────────────────────────────────────────────────────────
// Wugi — SectionHeader Component
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import type { Theme } from '../constants/colors';
import { ChevronRightIcon } from './icons';

type Props = {
  title: string;
  theme: Theme;
  onSeeAll?: () => void;
};

export function SectionHeader({ title, theme, onSeeAll }: Props) {
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      marginTop: 28,
      marginBottom: 12,
    }}>
      <Text style={{
        color: theme.text,
        fontSize: 17,
        fontWeight: '800',
        letterSpacing: -0.3,
      }}>
        {title}
      </Text>
      {onSeeAll && (
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
          onPress={onSeeAll}
        >
          <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '600' }}>
            See all
          </Text>
          <ChevronRightIcon color={theme.accent}/>
        </TouchableOpacity>
      )}
    </View>
  );
}
