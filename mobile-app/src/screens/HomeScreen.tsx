// ─────────────────────────────────────────────────────────────────────
// Wugi — HomeScreen
// Fetches live data from Firestore, falls back to mock if empty/error
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, Image, TouchableOpacity, ScrollView,
  FlatList, SafeAreaView, ActivityIndicator, Dimensions,
  StyleSheet,
} from 'react-native';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, GalleryData, FSEvent, FSVenue, FSDeal } from '../types';
import { EVENTS, VENUES, DEALS, VIBE_LIST, ALL_GALLERIES, makeGallery } from '../constants/mockData';
import { SectionHeader }    from '../components/SectionHeader';
import { FeaturedCarousel } from '../components/FeaturedCarousel';
import { CameraIcon, StarIcon } from '../components/icons';
import { StoriesBar }       from '../features/stories/StoriesBar';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Firestore → local type converters ────────────────────────────────
function toEventData(e: FSEvent): EventData {
  return {
    id: e.id, title: e.title, venue: e.venue,
    date: e.date, time: e.time, age: e.age, about: e.about || '',
    media: e.media || [],
    hasTickets: (e as any).hasTickets === true,
    gallery: makeGallery(e.id, e.title, e.venue, e.date,
      ['gp1','gp2','gp3','gp4','gp5','gp6','gp7','gp8']),
  };
}

function toVenueData(v: FSVenue): VenueData {
  return {
    id: v.id, name: v.name, category: v.category || '',
    address: v.address || '', phone: v.phone || '',
    logoUrl: (v as any).logoUrl || '',
    website: v.website || '', instagram: v.instagram || '',
    attributes: v.attributes || [], about: v.about || '',
    media: v.media || [],
    menuDescription: v.about || '', menuAttributes: v.attributes || [],
    bestSellers: [], upcomingEvents: [], galleries: [],
  };
}

// Mock → FS type helpers for fallback
const mockToFSEvent = (e: EventData): FSEvent => ({ id:e.id, title:e.title, venue:e.venue, venueId:'', date:e.date, time:e.time, age:e.age, about:e.about, vibes:['Boujee'], media:e.media || [], status:'approved', createdAt:null });
const mockToFSVenue = (v: VenueData): FSVenue => ({ id:v.id, name:v.name, category:v.category, address:v.address, phone:v.phone, website:v.website, instagram:v.instagram, attributes:v.attributes || [], vibes:['Boujee'], about:v.about, media:v.media || [], status:'approved', createdAt:null });
const mockToFSDeal  = (d: typeof DEALS[0]): FSDeal => ({ id:d.id, title:d.title, venueName:d.venueName, venueId:'', detail:d.detail, image:d.image, vibes:['Boujee'], expiresAt:null });

type Props = {
  theme: Theme;
  onEventPress:   (event: EventData)    => void;
  onVenuePress:   (venue: VenueData)    => void;
  onGalleryPress: (gallery: GalleryData) => void;
  userVibes:      string[];
  onCameraPress:  () => void;
};

export function HomeScreen({ theme, onEventPress, onVenuePress, onGalleryPress, userVibes, onCameraPress }: Props) {
  const [events,  setEvents]  = useState<FSEvent[]>([]);
  const [venues,  setVenues]  = useState<FSVenue[]>([]);
  const [deals,   setDeals]   = useState<FSDeal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { getApprovedEvents, getApprovedVenues, getActiveDeals } =
          await import('../../firestoreService');

        const [liveEvents, liveVenues, liveDeals] = await Promise.all([
          getApprovedEvents(userVibes, 20),
          getApprovedVenues(userVibes, 20),
          getActiveDeals(userVibes, 5),
        ]);

        if (cancelled) return;

        setEvents(liveEvents.length > 0 ? liveEvents : EVENTS.map(mockToFSEvent));
        setVenues(liveVenues.length > 0 ? liveVenues : VENUES.map(mockToFSVenue));
        setDeals(liveDeals.length  > 0 ? liveDeals  : DEALS.map(mockToFSDeal));
      } catch (e) {
        console.log('HomeScreen: Firestore fetch failed, using mock data', e);
        if (cancelled) return;
        setEvents(EVENTS.map(mockToFSEvent));
        setVenues(VENUES.map(mockToFSVenue));
        setDeals(DEALS.map(mockToFSDeal));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const timeout = setTimeout(() => { if (!cancelled) setLoading(false); }, 8000);
    load();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [userVibes]);

  const eventList = events.map(toEventData);
  const venueList = venues.map(toVenueData);
  const featured  = eventList.slice(0, 3);
  const tonight   = eventList.slice(0, 6);
  const upcoming  = eventList.slice(0, 5);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} size="large"/>
        <Text style={{ color: theme.subtext, fontSize: 13, marginTop: 12 }}>Loading your feed...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ borderBottomWidth: 1, borderBottomColor: theme.divider, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 36 }}/>
          <Text style={{ color: theme.accent, fontSize: 26, fontWeight: '900', letterSpacing: -1 }}>wugi</Text>
          <TouchableOpacity onPress={onCameraPress} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <CameraIcon color={theme.subtext}/>
          </TouchableOpacity>
        </View>
        {userVibes.length > 0 && (
          <Text style={{ color: theme.subtext, fontSize: 11, textAlign: 'center', marginTop: 4 }}>
            Showing {userVibes.join(' · ')} vibes
          </Text>
        )}
      </SafeAreaView>

      <StoriesBar theme={theme} onAddStory={onCameraPress}/>

      <ScrollView showsVerticalScrollIndicator={false}>
        <SectionHeader title="Tonight's Picks" theme={theme} onSeeAll={() => {}}/>
        {featured.length > 0
          ? <FeaturedCarousel theme={theme} onEventPress={onEventPress} events={featured}/>
          : <Text style={{ color: theme.subtext, fontSize: 13, paddingHorizontal: 16, marginBottom: 12 }}>No events right now — check back soon.</Text>
        }

        {tonight.length > 0 && (
          <FlatList data={tonight} keyExtractor={i => i.id} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }} style={{ marginTop: 12 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={{ width: 130, height: 200, borderRadius: 12, overflow: 'hidden' }} onPress={() => onEventPress(item)} activeOpacity={0.88}>
                <Image source={{ uri: (item.media || [])[0]?.uri || 'https://picsum.photos/seed/fallback/400/600' }} style={StyleSheet.absoluteFillObject} resizeMode="cover"/>
                <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' }}/>
                <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 10 }}>
                  <Text style={{ color: theme.accent, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 }}>{item.time}</Text>
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', lineHeight: 15, marginBottom: 2 }} numberOfLines={2}>{item.title}</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10 }} numberOfLines={1}>{item.venue}</Text>
                </View>
              </TouchableOpacity>
            )}
          />
        )}

        <SectionHeader title="Upcoming Events" theme={theme} onSeeAll={() => {}}/>
        {upcoming.length > 0
          ? <FlatList data={upcoming} keyExtractor={i => i.id} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={{ width: 150, height: 220, borderRadius: 12, overflow: 'hidden' }} onPress={() => onEventPress(item)} activeOpacity={0.88}>
                  <Image source={{ uri: (item.media || [])[0]?.uri || 'https://picsum.photos/seed/fallback/400/600' }} style={StyleSheet.absoluteFillObject} resizeMode="cover"/>
                  <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' }}/>
                  <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 10 }}>
                    <Text style={{ color: theme.accent, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 }}>{item.date}</Text>
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 1 }} numberOfLines={1}>{item.title}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }} numberOfLines={1}>{item.venue}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          : <Text style={{ color: theme.subtext, fontSize: 13, paddingHorizontal: 16 }}>No upcoming events.</Text>
        }

        <SectionHeader title="Deals & Specials" theme={theme} onSeeAll={() => {}}/>
        {deals.length > 0
          ? <FlatList data={deals} keyExtractor={i => i.id} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={{ width: 220, height: 150, borderRadius: 12, overflow: 'hidden' }} activeOpacity={0.88}>
                  <Image source={{ uri: item.image || 'https://picsum.photos/seed/deal/400/300' }} style={StyleSheet.absoluteFillObject} resizeMode="cover"/>
                  <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' }}/>
                  <View style={{ position: 'absolute', top: 0, right: 0, backgroundColor: theme.accent, paddingHorizontal: 10, paddingVertical: 5, borderBottomLeftRadius: 10 }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>DEAL</Text>
                  </View>
                  <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 }}>
                    <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', marginBottom: 2 }}>{item.title}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, marginBottom: 4 }}>{item.venueName}</Text>
                    <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '600' }}>{item.detail}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          : <Text style={{ color: theme.subtext, fontSize: 13, paddingHorizontal: 16 }}>No active deals.</Text>
        }

        <SectionHeader title="Explore by Vibe" theme={theme}/>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 8 }}>
          {VIBE_LIST.map(vibe => (
            <TouchableOpacity key={vibe.id} style={{ width: (SCREEN_WIDTH - 40) / 2, height: 80, borderRadius: 12, overflow: 'hidden', justifyContent: 'center', paddingLeft: 14 }} activeOpacity={0.85}>
              <Image source={{ uri: vibe.image }} style={StyleSheet.absoluteFillObject} resizeMode="cover"/>
              <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: vibe.color + 'cc' }}/>
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: vibe.accent }}/>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: -0.2 }}>{vibe.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <SectionHeader title="Featured Venues" theme={theme} onSeeAll={() => {}}/>
        {venueList.length > 0
          ? <FlatList data={venueList} keyExtractor={v => v.id} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={{ width: 200, height: 160, borderRadius: 12, overflow: 'hidden' }} onPress={() => onVenuePress(item)} activeOpacity={0.88}>
                  <Image source={{ uri: (item.media || [])[0] || 'https://picsum.photos/seed/fallback/400/300' }} style={StyleSheet.absoluteFillObject} resizeMode="cover"/>
                  <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' }}/>
                  <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 }}>
                    <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', marginBottom: 4 }}>{item.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{item.category}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <StarIcon color="#f5a623"/>
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>4.7</Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              )}
            />
          : <Text style={{ color: theme.subtext, fontSize: 13, paddingHorizontal: 16 }}>No venues yet.</Text>
        }

        <SectionHeader title="Near Me" theme={theme} onSeeAll={() => {}}/>
        {venueList.length > 0
          ? <View style={{ marginHorizontal: 16, borderRadius: 12, borderWidth: 1, overflow: 'hidden', backgroundColor: theme.card, borderColor: theme.divider }}>
              {venueList.slice(0, 4).map((item, index) => (
                <TouchableOpacity key={item.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: index === Math.min(venueList.length, 4) - 1 ? 0 : 1, borderBottomColor: theme.divider, gap: 12 }} onPress={() => onVenuePress(item)} activeOpacity={0.7}>
                  <Image source={{ uri: (item.media || [])[0] || 'https://picsum.photos/seed/fallback/120/120' }} style={{ width: 44, height: 44, borderRadius: 8 }} resizeMode="cover"/>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', marginBottom: 2 }}>{item.name}</Text>
                    <Text style={{ color: theme.subtext, fontSize: 11 }}>{item.category}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.accent }}/>
                    <Text style={{ color: theme.accent, fontSize: 10, fontWeight: '600' }}>Open</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          : <Text style={{ color: theme.subtext, fontSize: 13, paddingHorizontal: 16 }}>No venues nearby.</Text>
        }

        <SectionHeader title="Recent Galleries" theme={theme}/>
        <FlatList data={ALL_GALLERIES.slice(0, 6)} keyExtractor={g => g.id} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: 140, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }} onPress={() => onGalleryPress(item)} activeOpacity={0.88}>
              <Image source={{ uri: item.coverImage }} style={{ width: 140, height: 140 }} resizeMode="cover"/>
              <View style={{ padding: 10 }}>
                <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>{item.title}</Text>
                <Text style={{ color: theme.subtext, fontSize: 10, marginTop: 2 }}>{item.photos.length} photos</Text>
              </View>
            </TouchableOpacity>
          )}
        />
        <View style={{ height: 40 }}/>
      </ScrollView>
    </View>
  );
}
