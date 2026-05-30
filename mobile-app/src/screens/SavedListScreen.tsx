// ─────────────────────────────────────────────────────────────────────
// Wugi — SavedListScreen   (per-section "View All" destination)
//
// The Saved tab presents each section (events / venues) as a horizontal
// preview carousel with a "View All" link. Tapping View All pushes this
// screen — a vertical full-list view of one kind. The Passes section has
// its own pending Wave 3 refactor and is intentionally NOT reachable here.
//
// Reuses SavedItemRow + EmptySection from FavoritesScreen so the full-list
// rows match the existing design language exactly.
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, FavoriteItem } from '../types';
import { FONTS } from '../constants/fonts';
import { SavedItemRow, EmptySection } from './FavoritesScreen';

type Props = {
  kind: 'event' | 'venue';
  items: FavoriteItem[];
  theme: Theme;
  onBack: () => void;
  onEventPress: (event: EventData) => void;
  onVenuePress: (venue: VenueData) => void;
  onRemove: (id: string) => void;
  onMarkRead: (id: string) => void;
};

export function SavedListScreen({ kind, items, theme, onBack, onEventPress, onVenuePress, onRemove, onMarkRead }: Props) {
  const title = kind === 'event' ? 'Saved Events' : 'Saved Venues';
  const emptyLabel = kind === 'event'
    ? 'Swipe right on events in the For You tab to save them here.'
    : 'Swipe right on venues in the For You tab to save them here.';

  const handlePress = (item: FavoriteItem) => {
    onMarkRead(item.id);
    if (item.type === 'event') onEventPress(item.data as EventData);
    else                       onVenuePress(item.data as VenueData);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header — back left, title centered, spacer right */}
      <SafeAreaView style={{ paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ width: 36, alignItems: 'flex-start' }}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M15 18l-6-6 6-6" stroke={theme.text} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </TouchableOpacity>
          <Text style={{ color: theme.text, fontSize: 20, fontFamily: FONTS.display, letterSpacing: -0.5 }}>{title}</Text>
          <View style={{ width: 36 }}/>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40, gap: 8 }}>
        {items.length === 0 ? (
          <EmptySection label={emptyLabel} theme={theme}/>
        ) : (
          items.map(item => (
            <SavedItemRow
              key={item.id}
              item={item}
              theme={theme}
              onPress={() => handlePress(item)}
              onRemove={() => onRemove(item.id)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
