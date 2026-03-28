// ─────────────────────────────────────────────────────────────────────
// Wugi — VenueIdentityBlock Component
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import type { Theme } from '../constants/colors';
import { ChevronRightIcon, ChevronDownIcon, GlobeIcon, InstagramIcon } from './icons';

type Props = {
  name: string;
  address: string;
  phone: string;
  website: string;
  instagram: string;
  onAddressPress: () => void;
  onVenuePress?: () => void;
  theme: Theme;
};

export function VenueIdentityBlock({
  name, address, phone, website, instagram,
  onAddressPress, onVenuePress, theme,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {/* Venue logo placeholder */}
        <View style={{
          width: 64, height: 64, borderRadius: 10,
          backgroundColor: theme.card, alignItems: 'center',
          justifyContent: 'center', marginRight: 12,
        }}>
          <Text style={{ fontSize: 10, fontWeight: '600', color: theme.subtext }}>LOGO</Text>
        </View>

        <View style={{ flex: 1, justifyContent: 'center' }}>
          <TouchableOpacity onPress={onVenuePress}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800', marginBottom: 3 }}>
              {name}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onAddressPress}>
            <Text style={{ color: theme.accent, fontSize: 12, marginBottom: 3, textDecorationLine: 'underline' }}>
              {address}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL(`tel:${phone}`)}>
            <Text style={{ color: theme.subtext, fontSize: 12, textDecorationLine: 'underline' }}>
              {phone}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => setOpen(!open)}
          style={{ paddingLeft: 12, alignSelf: 'center' }}
        >
          {open
            ? <ChevronDownIcon color={theme.subtext}/>
            : <ChevronRightIcon color={theme.subtext}/>
          }
        </TouchableOpacity>
      </View>

      {open && (
        <View style={{ marginTop: 14, paddingLeft: 76, gap: 12 }}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
            onPress={() => Linking.openURL(website)}
          >
            <GlobeIcon color={theme.accent}/>
            <Text style={{ color: theme.text, fontSize: 13 }}>
              {website.replace('https://', '')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <InstagramIcon color={theme.accent}/>
            <Text style={{ color: theme.text, fontSize: 13 }}>{instagram}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
