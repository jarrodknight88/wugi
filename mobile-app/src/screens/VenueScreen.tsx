// ─────────────────────────────────────────────────────────────────────
// Wugi — VenueScreen
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, ScrollView,
  FlatList, SafeAreaView, Dimensions,
} from 'react-native';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, GalleryData } from '../types';
import { BackIcon, ShareIcon, StarIcon, ChevronRightIcon } from '../components/icons';
import { VenueIdentityBlock } from '../components/VenueIdentityBlock';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Props = {
  venue: VenueData;
  onBack: () => void;
  onEventPress: (event: EventData) => void;
  onMapPress: () => void;
  onGalleryPress: (gallery: GalleryData) => void;
  theme: Theme;
};

export function VenueScreen({ venue, onBack, onEventPress, onMapPress, onGalleryPress, theme }: Props) {
  const [selectedThumb, setSelectedThumb] = useState(0);
  const THUMB_SIZE  = 60;
  const THUMB_TOTAL = venue.media.length * (THUMB_SIZE + 8) + 24;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Hero image */}
        <View style={{ width: SCREEN_WIDTH, position: 'relative' }}>
          <Image
            source={{ uri: venue.media[selectedThumb] }}
            style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 0.7 }}
            resizeMode="cover"
          />
          <SafeAreaView style={{ position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 }}>
            <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }} onPress={onBack}>
              <BackIcon color="#fff"/>
            </TouchableOpacity>
            <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
              <ShareIcon color="#fff"/>
            </TouchableOpacity>
          </SafeAreaView>
        </View>

        {/* Thumbnail strip */}
        <View style={{ position: 'relative' }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }, THUMB_TOTAL <= SCREEN_WIDTH && { flexGrow: 1, justifyContent: 'center' }]}
          >
            {venue.media.map((item, index) => (
              <TouchableOpacity key={index} onPress={() => setSelectedThumb(index)}>
                <Image
                  source={{ uri: item }}
                  style={[{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 10, opacity: 0.5 }, index === selectedThumb && { opacity: 1, borderWidth: 2, borderColor: theme.accent }]}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            ))}
          </ScrollView>
          {THUMB_TOTAL > SCREEN_WIDTH && (
            <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg, opacity: 0.85 }} pointerEvents="none">
              <ChevronRightIcon color={theme.subtext}/>
            </View>
          )}
        </View>

        {/* Identity block */}
        <VenueIdentityBlock
          name={venue.name}
          address={venue.address}
          phone={venue.phone}
          website={venue.website}
          instagram={venue.instagram}
          onAddressPress={onMapPress}
          theme={theme}
        />

        {/* Attributes */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 8 }}>
          {venue.attributes.map(a => (
            <View key={a} style={{ backgroundColor: theme.pill, borderWidth: 1, borderColor: theme.pillBorder, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ color: theme.subtext, fontSize: 12, fontWeight: '500' }}>{a}</Text>
            </View>
          ))}
        </ScrollView>

        {/* About */}
        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }}/>
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 8 }}>About</Text>
          <Text style={{ color: theme.subtext, fontSize: 14, lineHeight: 20 }}>{venue.about}</Text>
        </View>

        {/* Menu */}
        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }}/>
        <View style={{ paddingHorizontal: 16, paddingTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Menu</Text>
          <ChevronRightIcon color={theme.subtext}/>
        </View>
        <Text style={{ paddingHorizontal: 16, color: theme.subtext, fontSize: 14, lineHeight: 20 }}>{venue.menuDescription}</Text>

        {/* Best Sellers */}
        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }}/>
        <View style={{ paddingHorizontal: 16, paddingTop: 16, marginBottom: 12 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Best Sellers</Text>
        </View>
        <FlatList
          data={venue.bestSellers}
          keyExtractor={i => i.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: 140, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}>
              <Image source={{ uri: item.image }} style={{ width: 140, height: 140 }} resizeMode="cover"/>
              <View style={{ padding: 8 }}>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{item.name}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <Text style={{ color: theme.subtext, fontSize: 11 }}>{item.category}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <StarIcon color="#f5a623"/>
                    <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: '600' }}>{item.rating}</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )}
        />

        {/* Upcoming Events */}
        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }}/>
        <View style={{ paddingHorizontal: 16, paddingTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Upcoming Events</Text>
          <ChevronRightIcon color={theme.subtext}/>
        </View>
        <FlatList
          data={venue.upcomingEvents}
          keyExtractor={e => e.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: 150, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }} onPress={() => onEventPress(item)}>
              <Image source={{ uri: item.media[0].uri }} style={{ width: 150, height: 190 }} resizeMode="cover"/>
              <View style={{ padding: 10 }}>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{item.title}</Text>
                <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 2 }}>{item.date}</Text>
              </View>
            </TouchableOpacity>
          )}
        />

        {/* Galleries */}
        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }}/>
        <TouchableOpacity
          style={{ paddingHorizontal: 16, paddingTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}
          onPress={() => venue.galleries[0] && onGalleryPress(venue.galleries[0])}
        >
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Galleries</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '600' }}>View all</Text>
            <ChevronRightIcon color={theme.accent}/>
          </View>
        </TouchableOpacity>
        <FlatList
          data={venue.galleries}
          keyExtractor={g => g.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: 160, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }} onPress={() => onGalleryPress(item)}>
              <Image source={{ uri: item.coverImage }} style={{ width: 160, height: 160 }} resizeMode="cover"/>
              <View style={{ padding: 10 }}>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{item.title}</Text>
                <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 2 }}>{item.photos.length} photos · {item.date}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
        <View style={{ height: 40 }}/>
      </ScrollView>
    </View>
  );
}
