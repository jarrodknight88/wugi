// ─────────────────────────────────────────────────────────────────────
// Wugi — FavoritesScreen
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, FavoriteItem } from '../types';
import { HeartIcon } from '../components/icons';

type Props = {
  theme: Theme;
  favorites: FavoriteItem[];
  onEventPress: (event: EventData) => void;
  onVenuePress: (venue: VenueData) => void;
  onRemove: (id: string) => void;
  onMarkRead: (id: string) => void;
};

export function FavoritesScreen({ theme, favorites, onEventPress, onVenuePress, onRemove, onMarkRead }: Props) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 36 }}/>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '900', letterSpacing: -0.5 }}>Favorites</Text>
          <View style={{ width: 36 }}/>
        </View>
      </SafeAreaView>

      {favorites.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>❤️</Text>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 8 }}>
            Nothing saved yet
          </Text>
          <Text style={{ color: theme.subtext, fontSize: 15, textAlign: 'center', lineHeight: 22 }}>
            Swipe right on events and venues in the For You tab to save them here.
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 12 }}>
          <Text style={{ color: theme.subtext, fontSize: 13, marginBottom: 4 }}>
            {favorites.length} saved
          </Text>
          {favorites.map(item => (
            <TouchableOpacity
              key={item.id}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}
              onPress={() => {
                onMarkRead(item.id);
                if (item.type === 'event') onEventPress(item.data as EventData);
                else onVenuePress(item.data as VenueData);
              }}
            >
              <View style={{ position: 'relative' }}>
                <Image source={{ uri: item.image }} style={{ width: 90, height: 90 }} resizeMode="cover"/>
                {!item.read && (
                  <View style={{ position: 'absolute', top: 6, left: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent }}/>
                )}
              </View>
              <View style={{ flex: 1, padding: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <View style={{ backgroundColor: item.type === 'event' ? theme.accent + '33' : '#3498db33', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ color: item.type === 'event' ? theme.accent : '#3498db', fontSize: 10, fontWeight: '700' }}>
                      {item.type.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text style={{ color: item.read ? theme.subtext : theme.text, fontSize: 14, fontWeight: item.read ? '500' : '700', marginBottom: 2 }} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={{ color: theme.subtext, fontSize: 12 }} numberOfLines={1}>
                  {item.subtitle}
                </Text>
              </View>
              <TouchableOpacity onPress={() => onRemove(item.id)} style={{ padding: 16 }}>
                <HeartIcon color="#e74c3c" filled/>
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
