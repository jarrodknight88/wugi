// ─────────────────────────────────────────────────────────────────────
// Wugi — MapScreen
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import {
  View, Text, Image, TouchableOpacity,
  SafeAreaView, Linking,
} from 'react-native';
import type { Theme } from '../constants/colors';
import { BackIcon, LocationIcon } from '../components/icons';

type Props = {
  address: string;
  venueName: string;
  onBack: () => void;
  theme: Theme;
};

export function MapScreen({ address, venueName, onBack, theme }: Props) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 }}>
        <TouchableOpacity
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' }}
          onPress={onBack}
        >
          <BackIcon color={theme.text}/>
        </TouchableOpacity>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>Location</Text>
        <View style={{ width: 40 }}/>
      </SafeAreaView>

      {/* Map placeholder */}
      <View style={{ flex: 1, position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
        <Image
          source={{ uri: 'https://picsum.photos/seed/mapview/800/600' }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
        <View style={{
          position: 'absolute',
          width: 40, height: 40, borderRadius: 20,
          backgroundColor: theme.accent,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <LocationIcon color="#fff"/>
        </View>
      </View>

      {/* Venue info card */}
      <View style={{
        margin: 16, padding: 16, borderRadius: 12,
        borderWidth: 1, backgroundColor: theme.card, borderColor: theme.border,
      }}>
        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>
          {venueName}
        </Text>
        <Text style={{ color: theme.subtext, fontSize: 13, lineHeight: 18 }}>
          {address}
        </Text>
      </View>

      {/* Directions CTA */}
      <SafeAreaView style={{ borderTopWidth: 1, borderTopColor: theme.divider, paddingHorizontal: 16, paddingTop: 12 }}>
        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
            gap: 8, borderRadius: 12, paddingVertical: 16, backgroundColor: theme.accent,
          }}
          onPress={() => Linking.openURL(`maps://maps.apple.com/?q=${encodeURIComponent(address)}`)}
        >
          <LocationIcon color="#fff"/>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Get Directions</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}
