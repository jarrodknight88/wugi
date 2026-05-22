// ─────────────────────────────────────────────────────────────────────
// Wugi — MenuItemScreen
// Single-dish detail. Item is passed in directly (already loaded from
// the parent MenuScreen) so this screen does no Firestore reads of its
// own. Allergens / ingredients / pairings render only when populated.
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { Image } from 'expo-image';
import type { Theme } from '../constants/colors';
import type { MenuItem } from '../types';
import { BackIcon } from '../components/icons';

type Props = {
  item: MenuItem;
  venueName: string;
  theme: Theme;
  onBack: () => void;
};

export function MenuItemScreen({ item, venueName, theme, onBack }: Props) {
  const hasImage   = !!item.imageUrl;
  const tags       = item.tags || [];
  const badges     = item.badges || [];
  const allergens  = item.allergens || [];
  const ingredients = item.ingredients || [];
  const pairings   = item.pairings || [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ borderBottomWidth: 1, borderBottomColor: theme.divider, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8 }}>
          <TouchableOpacity onPress={onBack} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <BackIcon color={theme.text}/>
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: theme.subtext, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 }} numberOfLines={1}>{venueName.toUpperCase()}</Text>
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600', marginTop: 1 }} numberOfLines={1}>{item.section || 'Menu'}</Text>
          </View>
          <View style={{ width: 36 }}/>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {hasImage && (
          <Image
            cachePolicy="memory-disk"
            source={{ uri: item.imageUrl }}
            style={{ width: '100%', aspectRatio: 1.4 }}
            contentFit="cover"
          />
        )}

        <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
          {/* Badges row */}
          {badges.length > 0 && (
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
              {badges.map(b => (
                <View key={b} style={{ backgroundColor: theme.accent, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 }}>
                  <Text style={{ color: theme.onAccent, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>{b}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Title + price */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <Text style={{ color: theme.text, fontSize: 24, fontWeight: '800', flex: 1, lineHeight: 30 }}>{item.name}</Text>
            <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>
              {item.priceDisplay || (typeof item.price === 'number' ? `$${item.price.toFixed(0)}` : '')}
            </Text>
          </View>

          {/* Description */}
          {item.description ? (
            <Text style={{ color: theme.subtext, fontSize: 14, lineHeight: 21, marginTop: 12 }}>
              {item.description}
            </Text>
          ) : null}

          {/* Tag pills */}
          {tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
              {tags.map(t => (
                <View key={t} style={{ backgroundColor: theme.pill, borderWidth: 1, borderColor: theme.pillBorder, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: '500' }}>{t}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Allergens — render only when present */}
          {allergens.length > 0 && (
            <>
              <View style={{ height: 1, backgroundColor: theme.divider, marginTop: 22 }}/>
              <Text style={{ color: theme.subtext, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginTop: 18 }}>ALLERGENS</Text>
              <Text style={{ color: theme.text, fontSize: 14, marginTop: 6, lineHeight: 21 }}>{allergens.join(' · ')}</Text>
            </>
          )}

          {/* Ingredients — render only when present */}
          {ingredients.length > 0 && (
            <>
              <View style={{ height: 1, backgroundColor: theme.divider, marginTop: 22 }}/>
              <Text style={{ color: theme.subtext, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginTop: 18 }}>INGREDIENTS</Text>
              <Text style={{ color: theme.text, fontSize: 14, marginTop: 6, lineHeight: 21 }}>{ingredients.join(', ')}</Text>
            </>
          )}

          {/* Pairings — render only when present */}
          {pairings.length > 0 && (
            <>
              <View style={{ height: 1, backgroundColor: theme.divider, marginTop: 22 }}/>
              <Text style={{ color: theme.subtext, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginTop: 18 }}>PAIRS WITH</Text>
              <Text style={{ color: theme.text, fontSize: 14, marginTop: 6, lineHeight: 21 }}>{pairings.join(' · ')}</Text>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
