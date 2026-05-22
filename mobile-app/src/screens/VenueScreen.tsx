// ─────────────────────────────────────────────────────────────────────
// Wugi — VenueScreen
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, FlatList, SafeAreaView, Dimensions, Linking, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { Image } from 'expo-image';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, GalleryData } from '../types';
import { BackIcon, ShareIcon, StarIcon, ChevronRightIcon } from '../components/icons';
import { VenueIdentityBlock } from '../components/VenueIdentityBlock';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = Math.round(SCREEN_WIDTH * 0.7);

type ActiveTicketEvent = {
  id: string;
  name: string;
  date: string;
  time: string;
};

type Props = {
  venue: VenueData;
  onBack: () => void;
  onEventPress: (event: EventData) => void;
  onMapPress: () => void;
  onGalleryPress: (gallery: GalleryData) => void;
  onMenuPress?: () => void;
  onGetTickets?: (event: ActiveTicketEvent) => void;
  theme: Theme;
};

export function VenueScreen({ venue, onBack, onEventPress, onMapPress, onGalleryPress, onMenuPress, onGetTickets, theme }: Props) {
  const [heroIndex, setHeroIndex] = useState(0);
  const [activeTicketEvent, setActiveTicketEvent] = useState<ActiveTicketEvent | null>(null);
  const heroRef = useRef<FlatList<{ type: string; uri: string }>>(null);
  const THUMB_SIZE  = 60;
  const heroMedia = venue.media.length > 0 ? venue.media : [{ type: 'image', uri: '' }];
  const THUMB_TOTAL = heroMedia.length * (THUMB_SIZE + 8) + 24;
  const hasMultiHero = heroMedia.length > 1;

  // Look up active ticket events for this venue
  useEffect(() => {
    const lookup = async () => {
      try {
        const { getFirestore, collection, getDocs, query, where } =
          await import('@react-native-firebase/firestore');
        const db   = getFirestore();
        const snap = await getDocs(
          query(
            collection(db, 'events'),
            where('venueId', '==', venue.id),
            where('hasTickets', '==', true),
            where('status', '==', 'approved'),
          )
        );
        if (!snap.empty) {
          const ev = snap.docs[0].data();
          setActiveTicketEvent({
            id:   snap.docs[0].id,
            name: ev.name ?? ev.title ?? venue.name,
            date: ev.date ?? '',
            time: ev.time ?? '',
          });
        }
      } catch (e) {
        // No active ticket events — CTA stays hidden
      }
    };
    lookup();
  }, [venue.id]);

  // Determine which stats to surface (hide slots with no data)
  const statsToShow: { label: string; sub?: string }[] = [];
  if (venue.openStatusHint) statsToShow.push({ label: venue.openStatusHint });
  else if (venue.hoursText) statsToShow.push({ label: 'HOURS', sub: venue.hoursText.split('  ·  ')[0] });
  if (typeof venue.rating === 'number') statsToShow.push({ label: `★ ${venue.rating.toFixed(1)}` });
  if (venue.priceTier) statsToShow.push({ label: venue.priceTier });

  // Attribute pills — prefer the new amenities[] from Phase 2, fall back
  // to legacy attributes[] so pre-ingest docs still render something.
  const pillList = (venue.amenities && venue.amenities.length > 0) ? venue.amenities : venue.attributes;

  // Sticky CTA wiring
  const reservationHref = venue.reservationProvider === 'opentable'
    ? (venue.reservationUrlWithDefaults || venue.reservationUrl)
    : venue.reservationUrl;
  const reserveLabel = venue.ctaPrimary || (venue.reservationProvider === 'direct' ? 'Reserve a Section' : 'Reserve a table');
  const directionsLabel = venue.ctaSecondary || 'Directions';
  const showReserve = !!reservationHref;
  const showTicketCTA = !!(onGetTickets && activeTicketEvent);
  const stickyHeight = (showReserve ? 60 : 0) + (showTicketCTA ? 60 : 0) + (showReserve || showTicketCTA ? 32 : 0);

  const onHeroScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (i !== heroIndex) setHeroIndex(i);
  };

  const jumpHero = (i: number) => {
    setHeroIndex(i);
    heroRef.current?.scrollToOffset({ offset: i * SCREEN_WIDTH, animated: true });
  };

  const openReserve = () => { if (reservationHref) Linking.openURL(reservationHref).catch(() => {}); };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Hero — paged horizontal carousel; degrades to single image */}
        <View style={{ width: SCREEN_WIDTH, height: HERO_HEIGHT, position: 'relative' }}>
          <FlatList
            ref={heroRef}
            data={heroMedia}
            keyExtractor={(_, i) => `hero-${i}`}
            horizontal
            pagingEnabled
            scrollEnabled={hasMultiHero}
            showsHorizontalScrollIndicator={false}
            onScroll={onHeroScroll}
            scrollEventThrottle={16}
            renderItem={({ item }) => (
              <Image
                cachePolicy="memory-disk"
                source={{ uri: item.uri }}
                style={{ width: SCREEN_WIDTH, height: HERO_HEIGHT }}
                contentFit="cover"
              />
            )}
          />
          {/* Page dots — only when >1 image */}
          {hasMultiHero && (
            <View style={{ position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
              {heroMedia.map((_, i) => (
                <View
                  key={`dot-${i}`}
                  style={{
                    width: i === heroIndex ? 18 : 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: i === heroIndex ? theme.onImage : theme.onImageMuted,
                  }}
                />
              ))}
            </View>
          )}
          <SafeAreaView style={{ position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 }}>
            <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.overlayMedium, alignItems: 'center', justifyContent: 'center' }} onPress={onBack}>
              <BackIcon color={theme.onImage}/>
            </TouchableOpacity>
            <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.overlayMedium, alignItems: 'center', justifyContent: 'center' }}>
              <ShareIcon color={theme.onImage}/>
            </TouchableOpacity>
          </SafeAreaView>
        </View>

        {/* Thumbnail strip — only when >1 hero image */}
        {hasMultiHero && (
          <View style={{ position: 'relative' }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }, THUMB_TOTAL <= SCREEN_WIDTH && { flexGrow: 1, justifyContent: 'center' }]}
            >
              {heroMedia.map((item, index) => (
                <TouchableOpacity key={index} onPress={() => jumpHero(index)}>
                  <Image cachePolicy="memory-disk"
                    source={{ uri: item.uri }}
                    style={[{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 10, opacity: 0.5 }, index === heroIndex && { opacity: 1, borderWidth: 2, borderColor: theme.accent }]}
                    contentFit="cover"
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
        )}

        {/* Identity block */}
        <VenueIdentityBlock
          name={venue.name}
          address={venue.address}
          phone={venue.phone}
          website={venue.website}
          instagram={venue.instagram}
          logoUrl={(venue as any).logoUrl || ''}
          onAddressPress={onMapPress}
          theme={theme}
        />

        {/* Stats stripe — Open / Rating / Price. Hidden if nothing to show. */}
        {statsToShow.length > 0 && (
          <View style={{ flexDirection: 'row', marginHorizontal: 16, marginTop: 14, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' }}>
            {statsToShow.map((s, i) => (
              <React.Fragment key={`stat-${i}`}>
                {i > 0 && <View style={{ width: 1, backgroundColor: theme.divider, marginVertical: 10 }}/>}
                <View style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center' }}>
                  <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textAlign: 'center' }} numberOfLines={1}>
                    {s.label}
                  </Text>
                  {s.sub && (
                    <Text style={{ color: theme.subtext, fontSize: 10, marginTop: 2, textAlign: 'center' }} numberOfLines={1}>
                      {s.sub}
                    </Text>
                  )}
                </View>
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Attribute pills */}
        {pillList && pillList.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 8 }}>
            {pillList.map(a => (
              <View key={a} style={{ backgroundColor: theme.pill, borderWidth: 1, borderColor: theme.pillBorder, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Text style={{ color: theme.subtext, fontSize: 12, fontWeight: '500' }}>{a}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        {/* About */}
        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }}/>
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 8 }}>About</Text>
          <Text style={{ color: theme.subtext, fontSize: 14, lineHeight: 20 }}>{venue.about}</Text>
        </View>

        {/* Menu — tap row opens MenuScreen */}
        <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 16, marginTop: 16 }}/>
        <TouchableOpacity
          onPress={onMenuPress}
          disabled={!onMenuPress}
          activeOpacity={onMenuPress ? 0.7 : 1}
          style={{ paddingHorizontal: 16, paddingTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}
        >
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Menu</Text>
          {onMenuPress && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '600' }}>View menu</Text>
              <ChevronRightIcon color={theme.accent}/>
            </View>
          )}
        </TouchableOpacity>
        <Text style={{ paddingHorizontal: 16, color: theme.subtext, fontSize: 14, lineHeight: 20 }}>{venue.menuDescription}</Text>

        {/* Best Sellers */}
        {venue.bestSellers.length > 0 && (
          <>
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
                  <Image cachePolicy="memory-disk" source={{ uri: item.image }} style={{ width: 140, height: 140 }} contentFit="cover"/>
                  <View style={{ padding: 8 }}>
                    <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{item.name}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <Text style={{ color: theme.subtext, fontSize: 11 }}>{item.category}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <StarIcon color={theme.iconAccent}/>
                        <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: '600' }}>{item.rating}</Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        {/* Upcoming Events */}
        {venue.upcomingEvents.length > 0 && (
          <>
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
                  <Image cachePolicy="memory-disk" source={{ uri: item.media[0].uri }} style={{ width: 150, height: 190 }} contentFit="cover"/>
                  <View style={{ padding: 10 }}>
                    <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{item.title}</Text>
                    <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 2 }}>{item.date}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        {/* Galleries */}
        {venue.galleries.length > 0 && (
          <>
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
                  <Image cachePolicy="memory-disk" source={{ uri: item.coverImage }} style={{ width: 160, height: 160 }} contentFit="cover"/>
                  <View style={{ padding: 10 }}>
                    <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{item.title}</Text>
                    <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 2 }}>{item.photos.length} photos · {item.date}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        <View style={{ height: stickyHeight + 8 }}/>
      </ScrollView>

      {/* Sticky bottom: Get Tickets (if active event) over Directions+Reserve pair */}
      {(showTicketCTA || showReserve) && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.divider, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 10 }}>
          {showTicketCTA && (
            <TouchableOpacity
              onPress={() => onGetTickets!(activeTicketEvent!)}
              style={{ backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center' }}
            >
              <Text style={{ color: theme.onAccent, fontSize: 16, fontWeight: '700', letterSpacing: 0.3 }}>Get Tickets</Text>
            </TouchableOpacity>
          )}
          {showReserve && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={onMapPress}
                style={{ flex: 1, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }}>{directionsLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={openReserve}
                style={{ flex: 1, backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ color: theme.onAccent, fontSize: 15, fontWeight: '700' }}>{reserveLabel}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
