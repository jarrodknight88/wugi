// ─────────────────────────────────────────────────────────────────────
// Wugi — DiscoverScreen
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, ScrollView,
  SafeAreaView, TextInput, Dimensions, StyleSheet,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData } from '../types';
import { EVENTS, VENUES } from '../constants/mockData';
import { DISCOVER_VIBES } from '../constants/mockData';
import { SearchIcon, StarIcon, ChevronRightIcon } from '../components/icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type DiscoverItem =
  | { kind: 'event'; data: EventData; image: string }
  | { kind: 'venue'; data: VenueData; image: string }
  | { kind: 'food'; name: string; venue: string; image: string; rating: number }
  | { kind: 'deal'; title: string; venueName: string; detail: string; image: string };

const ALL_RESULTS: DiscoverItem[] = [
  { kind: 'event',  data: EVENTS[0],  image: 'https://picsum.photos/seed/ev1a/800/600'    },
  { kind: 'venue',  data: VENUES[0],  image: 'https://picsum.photos/seed/venue1/800/600'  },
  { kind: 'event',  data: EVENTS[1],  image: 'https://picsum.photos/seed/ev2a/800/600'    },
  { kind: 'food',   name: 'Wagyu Sliders',    venue: 'Nite Owl Kitchen',  image: 'https://picsum.photos/seed/food2/800/600',  rating: 4.8 },
  { kind: 'deal',   title: 'Half Off Bottles', venueName: 'Nite Owl Kitchen', detail: 'Before 9 PM', image: 'https://picsum.photos/seed/deal1/800/600' },
  { kind: 'venue',  data: VENUES[1],  image: 'https://picsum.photos/seed/fv1/800/600'     },
  { kind: 'event',  data: EVENTS[2],  image: 'https://picsum.photos/seed/ev3a/800/600'    },
  { kind: 'food',   name: 'Sky Martini',      venue: 'SkyLounge ATL',    image: 'https://picsum.photos/seed/food4/800/600',  rating: 4.9 },
  { kind: 'deal',   title: 'Ladies Drink Free', venueName: 'Tongue & Groove', detail: 'Before 11 PM Fridays', image: 'https://picsum.photos/seed/deal2/800/600' },
  { kind: 'venue',  data: VENUES[2],  image: 'https://picsum.photos/seed/fv2/800/600'     },
  { kind: 'event',  data: EVENTS[3],  image: 'https://picsum.photos/seed/ev4a/800/600'    },
  { kind: 'food',   name: 'Truffle Fries',    venue: 'SkyLounge ATL',    image: 'https://picsum.photos/seed/food5/800/600',  rating: 4.6 },
];

const getItemName = (item: DiscoverItem) => {
  if (item.kind === 'event') return item.data.title;
  if (item.kind === 'venue') return item.data.name;
  if (item.kind === 'food')  return item.name;
  return item.title;
};
const getItemSub = (item: DiscoverItem) => {
  if (item.kind === 'event') return `${item.data.venue} · ${item.data.date}`;
  if (item.kind === 'venue') return item.data.category;
  if (item.kind === 'food')  return item.venue;
  return item.venueName;
};
const getItemTag = (item: DiscoverItem) => {
  if (item.kind === 'event') return { label: 'Event', color: '#2a7a5a' };
  if (item.kind === 'venue') return { label: 'Venue', color: '#3498db' };
  if (item.kind === 'food')  return { label: 'Food',  color: '#e67e22' };
  return { label: 'Deal', color: '#e74c3c' };
};

const CATEGORIES = ['All', 'Events', 'Venues', 'Food', 'Deals'];

type Props = {
  theme: Theme;
  onEventPress: (event: EventData) => void;
  onVenuePress: (venue: VenueData) => void;
};

export function DiscoverScreen({ theme, onEventPress, onVenuePress }: Props) {
  const [search,         setSearch]         = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeVibe,     setActiveVibe]     = useState<string | null>(null);
  const [viewMode,       setViewMode]       = useState<'list' | 'grid'>('list');
  const [showMap,        setShowMap]        = useState(false);

  const filtered = ALL_RESULTS.filter(item => {
    const matchCat =
      activeCategory === 'All' ||
      (activeCategory === 'Events' && item.kind === 'event') ||
      (activeCategory === 'Venues' && item.kind === 'venue') ||
      (activeCategory === 'Food'   && item.kind === 'food')  ||
      (activeCategory === 'Deals'  && item.kind === 'deal');
    const name       = getItemName(item).toLowerCase();
    const sub        = getItemSub(item).toLowerCase();
    const matchSearch = search === '' || name.includes(search.toLowerCase()) || sub.includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const handleItemPress = (item: DiscoverItem) => {
    if (item.kind === 'event') onEventPress(item.data);
    else if (item.kind === 'venue') onVenuePress(item.data);
  };

  const COL_WIDTH = (SCREEN_WIDTH - 48) / 2;

  const renderListItem = (item: DiscoverItem, index: number) => {
    const tag = getItemTag(item);
    return (
      <TouchableOpacity
        key={index}
        style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: theme.border, marginBottom: 10 }}
        onPress={() => handleItemPress(item)}
        activeOpacity={0.85}
      >
        <Image source={{ uri: item.image }} style={{ width: 88, height: 88 }} resizeMode="cover"/>
        <View style={{ flex: 1, padding: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <View style={{ backgroundColor: tag.color + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ color: tag.color, fontSize: 10, fontWeight: '700' }}>{tag.label.toUpperCase()}</Text>
            </View>
            {item.kind === 'food' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <StarIcon color="#f5a623"/>
                <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: '600' }}>{item.rating}</Text>
              </View>
            )}
          </View>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700', marginBottom: 3 }} numberOfLines={1}>{getItemName(item)}</Text>
          <Text style={{ color: theme.subtext, fontSize: 12 }} numberOfLines={1}>{getItemSub(item)}</Text>
        </View>
        <View style={{ paddingRight: 14 }}>
          <ChevronRightIcon color={theme.subtext}/>
        </View>
      </TouchableOpacity>
    );
  };

  const renderGridItem = (item: DiscoverItem, index: number) => {
    const tag = getItemTag(item);
    return (
      <TouchableOpacity
        key={index}
        style={{ width: COL_WIDTH, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}
        onPress={() => handleItemPress(item)}
        activeOpacity={0.85}
      >
        <Image source={{ uri: item.image }} style={{ width: COL_WIDTH, height: COL_WIDTH }} resizeMode="cover"/>
        <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: tag.color, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{tag.label.toUpperCase()}</Text>
        </View>
        <View style={{ padding: 10 }}>
          <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', marginBottom: 2 }} numberOfLines={1}>{getItemName(item)}</Text>
          <Text style={{ color: theme.subtext, fontSize: 11 }} numberOfLines={1}>{getItemSub(item)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ backgroundColor: theme.bg, borderBottomWidth: 1, borderBottomColor: theme.divider, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 }}>
          <View style={{ width: 36 }}/>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '900', letterSpacing: -0.5 }}>Discover</Text>
          <View style={{ width: 36 }}/>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, gap: 10 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}>
            <SearchIcon color={theme.subtext}/>
            <TextInput
              placeholder="Search events, venues, food..."
              placeholderTextColor={theme.subtext}
              value={search}
              onChangeText={setSearch}
              style={{ flex: 1, color: theme.text, fontSize: 14, padding: 0 }}
              returnKeyType="search"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M18 6L6 18M6 6l12 12" stroke={theme.subtext} strokeWidth={2} strokeLinecap="round"/>
                </Svg>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            onPress={() => setShowMap(!showMap)}
            style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: showMap ? theme.accent : theme.card, borderWidth: 1, borderColor: showMap ? theme.accent : theme.border, alignItems: 'center', justifyContent: 'center' }}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 9m0 8V9m0 0L9 7" stroke={showMap ? '#fff' : theme.subtext} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} stickyHeaderIndices={[0]}>
        {/* Sticky filter bar */}
        <View style={{ backgroundColor: theme.bg, paddingTop: 10, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity key={cat} onPress={() => setActiveCategory(cat)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: activeCategory === cat ? theme.accent : theme.card, borderWidth: 1, borderColor: activeCategory === cat ? theme.accent : theme.border }}>
                <Text style={{ color: activeCategory === cat ? '#fff' : theme.subtext, fontSize: 13, fontWeight: '600' }}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginTop: 8 }}>
            {DISCOVER_VIBES.map(vibe => {
              const active = activeVibe === vibe.label;
              return (
                <TouchableOpacity key={vibe.label} onPress={() => setActiveVibe(active ? null : vibe.label)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: active ? vibe.accent : theme.card, borderWidth: 1, borderColor: active ? vibe.accent : theme.border, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: active ? '#fff' : vibe.accent }}/>
                  <Text style={{ color: active ? '#fff' : theme.subtext, fontSize: 12, fontWeight: '600' }}>{vibe.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Results header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
          <Text style={{ color: theme.subtext, fontSize: 13 }}>
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}{activeVibe ? ` · ${activeVibe}` : ''}
          </Text>
          {!showMap && (
            <TouchableOpacity onPress={() => setViewMode(v => v === 'list' ? 'grid' : 'list')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                {viewMode === 'list'
                  ? <Path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z" stroke={theme.subtext} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
                  : <Path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke={theme.subtext} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
                }
              </Svg>
              <Text style={{ color: theme.subtext, fontSize: 12, fontWeight: '600' }}>{viewMode === 'list' ? 'Grid' : 'List'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Results */}
        {showMap ? (
          <View style={{ marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', height: SCREEN_HEIGHT * 0.55 }}>
            <Image source={{ uri: 'https://picsum.photos/seed/mapview/800/600' }} style={{ width: '100%', height: '100%' }} resizeMode="cover"/>
            {[
              { x: '30%', y: '40%', name: 'Nite Owl',  color: '#2a7a5a' },
              { x: '55%', y: '30%', name: 'SkyLounge', color: '#3498db' },
              { x: '70%', y: '55%', name: 'T&G',       color: '#e74c3c' },
            ].map((pin, i) => (
              <View key={i} style={{ position: 'absolute', left: pin.x as any, top: pin.y as any }}>
                <View style={{ backgroundColor: pin.color, borderRadius: 16, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{pin.name}</Text>
                </View>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: pin.color, alignSelf: 'center', marginTop: 2 }}/>
              </View>
            ))}
          </View>
        ) : viewMode === 'list' ? (
          <View style={{ paddingHorizontal: 16 }}>
            {filtered.length === 0 ? (
              <View style={{ alignItems: 'center', paddingTop: 60 }}>
                <Text style={{ fontSize: 36, marginBottom: 12 }}>🔍</Text>
                <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 6 }}>No results found</Text>
                <Text style={{ color: theme.subtext, fontSize: 14, textAlign: 'center' }}>Try a different search or filter</Text>
              </View>
            ) : filtered.map((item, i) => renderListItem(item, i))}
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            {filtered.length === 0 ? (
              <View style={{ width: '100%', alignItems: 'center', paddingTop: 60 }}>
                <Text style={{ fontSize: 36, marginBottom: 12 }}>🔍</Text>
                <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 6 }}>No results found</Text>
                <Text style={{ color: theme.subtext, fontSize: 14, textAlign: 'center' }}>Try a different search or filter</Text>
              </View>
            ) : filtered.map((item, i) => renderGridItem(item, i))}
          </View>
        )}
        <View style={{ height: 40 }}/>
      </ScrollView>
    </View>
  );
}
