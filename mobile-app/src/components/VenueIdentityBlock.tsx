// ─────────────────────────────────────────────────────────────────────
// Wugi — VenueIdentityBlock Component
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Linking, Image } from 'react-native';
import type { Theme } from '../constants/colors';
import { ChevronRightIcon, ChevronDownIcon, GlobeIcon, InstagramIcon } from './icons';

type Props = {
  name: string;
  address: string;
  phone: string;
  website: string;
  instagram: string;
  logoUrl?: string;
  onAddressPress: () => void;
  onVenuePress?: () => void;
  theme: Theme;
};

export function VenueIdentityBlock({
  name, address, phone, website, instagram, logoUrl,
  onAddressPress, onVenuePress, theme,
}: Props) {
  const [open, setOpen] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const showLogo = logoUrl && !logoError;

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {/* Venue logo — taps to venue profile */}
        <TouchableOpacity
          onPress={onVenuePress}
          disabled={!onVenuePress}
          style={{
            width: 64, height: 64, borderRadius: 10,
            backgroundColor: theme.card,
            alignItems: 'center', justifyContent: 'center',
            marginRight: 12, overflow: 'hidden',
            borderWidth: 1, borderColor: theme.border,
          }}
        >
          {showLogo ? (
            <Image
              source={{ uri: logoUrl }}
              style={{ width: 64, height: 64, borderRadius: 10 }}
              resizeMode="cover"
              onError={() => setLogoError(true)}
            />
          ) : (
            <Text style={{ fontSize: 10, fontWeight: '600', color: theme.subtext }}>
              {name.slice(0, 2).toUpperCase()}
            </Text>
          )}
        </TouchableOpacity>

        <View style={{ flex: 1, justifyContent: 'center' }}>
          <TouchableOpacity onPress={onVenuePress} disabled={!onVenuePress}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800', marginBottom: 3 }}>
              {name}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onAddressPress}>
            <Text style={{ color: theme.accent, fontSize: 12, marginBottom: 3, textDecorationLine: 'underline' }}>
              {address}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => phone ? Linking.openURL(`tel:${phone}`) : null}>
            <Text style={{ color: theme.subtext, fontSize: 12, textDecorationLine: phone ? 'underline' : 'none' }}>
              {phone}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => setOpen(!open)}
          style={{ paddingLeft: 12, alignSelf: 'center' }}
        >
          {open ? <ChevronDownIcon color={theme.subtext}/> : <ChevronRightIcon color={theme.subtext}/>}
        </TouchableOpacity>
      </View>

      {open && (
        <View style={{ marginTop: 14, paddingLeft: 76, gap: 12 }}>
          {website ? (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              onPress={() => Linking.openURL(website)}
            >
              <GlobeIcon color={theme.accent}/>
              <Text style={{ color: theme.text, fontSize: 13 }}>
                {website.replace('https://', '').replace('http://', '')}
              </Text>
            </TouchableOpacity>
          ) : null}
          {instagram ? (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              onPress={() => Linking.openURL(`https://instagram.com/${instagram.replace('@', '')}`)}
            >
              <InstagramIcon color={theme.accent}/>
              <Text style={{ color: theme.text, fontSize: 13 }}>{instagram}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </View>
  );
}
