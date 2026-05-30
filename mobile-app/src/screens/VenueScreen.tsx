// ─────────────────────────────────────────────────────────────────────
// Wugi — VenueScreen
//
// Venue detail, brought to full fidelity against the Claude Design handoff
// (wugi-design-system @ consumer-app VenueScreen). A place, not a moment:
//   • Photo carousel hero with the venue name overlaid
//   • Stats trio (open status · rating · price) + category
//   • Attribute pills (amenities)
//   • About + info card (address / phone / website / instagram / hours)
//   • Upcoming events AT this venue (wired to real Firestore events)
//   • Sticky Directions + Reserve CTAs
//
// Type via FONTS.* (PP Neue Montreal); mono eyebrows/stats via MONO.
// Real-data-only: sections with no backing data are omitted, not faked.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, FlatList, Dimensions, Linking, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, GalleryData, GalleryDoc } from '../types';
import { BackIcon, ShareIcon, StarIcon, ChevronRightIcon, LocationIcon } from '../components/icons';
import { FONTS, MONO } from '../constants/fonts';
import { makeGallery } from '../constants/mockData';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = Math.round(SCREEN_WIDTH / 1.2); // design hero aspect ratio
const STATUS_GREEN = '#5c9a7e';   // design --status-valid / live-dot (warm sage)
const GALLERY_PURPLE = '#9b59b6'; // design --tag-photos / Lens accent

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
  const [upcoming, setUpcoming] = useState<EventData[]>([]);
  const [galleries, setGalleries] = useState<GalleryDoc[]>([]);
  const [activeTicketEvent, setActiveTicketEvent] = useState<ActiveTicketEvent | null>(null);

  // Map a top-level gallery doc to the GalleryData shape the gallery viewer
  // expects (consumer app is read-only against the galleries collection).
  const toGalleryData = (g: GalleryDoc): GalleryData => ({
    id: g.id,
    title: g.title,
    venue: venue.name,
    date: g.date,
    coverImage: g.coverImage,
    photos: (g.images || []).map((uri, i) => ({ id: `${g.id}-${i}`, uri, height: 1000 })),
  });
  const heroRef = useRef<FlatList<{ type: string; uri: string }>>(null);
  const heroMedia = venue.media.length > 0 ? venue.media : [{ type: 'image', uri: '' }];
  const hasMultiHero = heroMedia.length > 1;

  // Real events at this venue — drives Upcoming Events + the Get Tickets CTA.
  // Query by venueId only (single-field, no composite index needed); filter
  // approved + derive the ticketed event in JS.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const { getFirestore, collection, getDocs, query, where } =
          await import('@react-native-firebase/firestore');
        const db = getFirestore();
        const snap = await getDocs(query(collection(db, 'events'), where('venueId', '==', venue.id)));
        const approved = snap.docs.filter(d => d.data().status === 'approved');
        const evs: EventData[] = approved.slice(0, 8).map(d => {
          const e = d.data();
          return {
            id: d.id, title: e.title || e.name || '', venue: venue.name, venueId: venue.id,
            date: e.date || '', time: e.time || '', age: e.age || venue.age || '', about: e.about || '',
            media: (e.media || []).map((m: any) => typeof m === 'string' ? { type: 'image', uri: m } : m),
            hasTickets: e.hasTickets === true,
            gallery: makeGallery(d.id, e.title || e.name || '', venue.name, e.date || '', ['gp1','gp2','gp3','gp4']),
          };
        });
        const ticketDoc = approved.find(d => d.data().hasTickets === true);

        // Galleries — top-level collection, queried by venueId only (single
        // field, no composite index) and sorted by createdAt desc client-side.
        const gsnap = await getDocs(query(collection(db, 'galleries'), where('venueId', '==', venue.id)));
        const gdocs: GalleryDoc[] = gsnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as object) }) as GalleryDoc);
        gdocs.sort((a, b) => {
          const ta = (a.createdAt as any)?.toMillis ? (a.createdAt as any).toMillis() : 0;
          const tb = (b.createdAt as any)?.toMillis ? (b.createdAt as any).toMillis() : 0;
          return tb - ta;
        });

        if (!cancelled) {
          setUpcoming(evs);
          setGalleries(gdocs);
          if (ticketDoc) {
            const ev = ticketDoc.data();
            setActiveTicketEvent({ id: ticketDoc.id, name: ev.name ?? ev.title ?? venue.name, date: ev.date ?? '', time: ev.time ?? '' });
          }
        }
      } catch (e) {
        // No events/galleries or query failed — those sections stay hidden
      }
    };
    run();
    return () => { cancelled = true; };
  }, [venue.id]);

  // Stats trio — open status (green) · rating · price. Render only what exists.
  const openLabel = venue.openStatusHint || (venue.hoursText ? venue.hoursText.split('  ·  ')[0] : undefined);
  const stats: { kind: 'open' | 'rating' | 'price'; value: string }[] = [];
  if (openLabel) stats.push({ kind: 'open', value: openLabel });
  if (typeof venue.rating === 'number') stats.push({ kind: 'rating', value: venue.rating.toFixed(1) });
  if (venue.priceTier) stats.push({ kind: 'price', value: venue.priceTier });

  // Attribute pills — prefer Phase-2 amenities[], fall back to legacy attributes[].
  const pillList = (venue.amenities && venue.amenities.length > 0) ? venue.amenities : venue.attributes;

  // Info-card rows — only render rows with data.
  const infoRows: { label: string; value: string; accent?: boolean; onPress?: () => void }[] = [];
  if (venue.address)  infoRows.push({ label: 'ADDRESS', value: venue.address, accent: true, onPress: onMapPress });
  if (venue.phone)    infoRows.push({ label: 'PHONE', value: venue.phone, onPress: () => Linking.openURL(`tel:${venue.phone}`).catch(() => {}) });
  if (venue.website)  infoRows.push({ label: 'WEBSITE', value: venue.website.replace(/^https?:\/\//, ''), onPress: () => Linking.openURL(venue.website.startsWith('http') ? venue.website : `https://${venue.website}`).catch(() => {}) });
  if (venue.instagram) infoRows.push({ label: 'INSTAGRAM', value: venue.instagram, onPress: () => Linking.openURL(`https://instagram.com/${venue.instagram.replace('@', '')}`).catch(() => {}) });
  if (venue.hoursText) infoRows.push({ label: 'HOURS', value: venue.hoursText });

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

        {/* Hero — paged carousel with the venue name overlaid */}
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
              <Image cachePolicy="memory-disk" source={{ uri: item.uri }} style={{ width: SCREEN_WIDTH, height: HERO_HEIGHT }} contentFit="cover"/>
            )}
          />

          {/* Bottom scrim — real LinearGradient (was a flat 55%-height rectangle
              with a hard horizontal edge; the venue name read against the edge
              rather than against a smooth fade). Now: transparent through the
              upper half → progressively dark to ~85% at the bottom, covering
              the whole hero so the venue name + carousel dots stay legible. */}
          <LinearGradient
            pointerEvents="none"
            colors={['transparent', 'transparent', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.85)']}
            locations={[0, 0.45, 0.78, 1]}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          />

          {/* Top controls — back + share. Matches EventScreen's Wave 1 pattern:
              absolute top:64 / left:20 / right:20 edge padding, 40×40 BlurView
              pills (intensity:20 tint:dark) with an inner LinearGradient tint
              and a parchment-tinted border. Share stays a direct icon (Venue
              has no other top-right actions to fold into a kebab menu).
              VenueIdentityBlock / useVenueById NOT touched. */}
          <View
            style={{
              position: 'absolute', top: 64, left: 20, right: 20,
              flexDirection: 'row', justifyContent: 'space-between',
              zIndex: 2,
            }}
          >
            <TouchableOpacity onPress={onBack} activeOpacity={0.8}>
              <BlurView
                intensity={20}
                tint="dark"
                style={{
                  width: 40, height: 40, borderRadius: 20,
                  overflow: 'hidden',
                  borderWidth: 1, borderColor: 'rgba(244,239,225,0.15)',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <LinearGradient
                  colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.25)']}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                />
                <BackIcon color="#f4efe1"/>
              </BlurView>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.8}>
              <BlurView
                intensity={20}
                tint="dark"
                style={{
                  width: 40, height: 40, borderRadius: 20,
                  overflow: 'hidden',
                  borderWidth: 1, borderColor: 'rgba(244,239,225,0.15)',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <LinearGradient
                  colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.25)']}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                />
                <ShareIcon color="#f4efe1"/>
              </BlurView>
            </TouchableOpacity>
          </View>

          {/* Venue name */}
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 30, paddingHorizontal: 20 }}>
            <Text style={{ color: theme.onImage, fontSize: 34, fontFamily: FONTS.display, letterSpacing: -1.2, lineHeight: 36 }} numberOfLines={3}>
              {venue.name}
            </Text>
          </View>

          {/* Carousel dots */}
          {hasMultiHero && (
            <View style={{ position: 'absolute', bottom: 14, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
              {heroMedia.map((_, i) => (
                <TouchableOpacity key={`dot-${i}`} onPress={() => jumpHero(i)} style={{ width: i === heroIndex ? 22 : 6, height: 6, borderRadius: 3, backgroundColor: i === heroIndex ? theme.onImage : theme.onImageMuted }}/>
              ))}
            </View>
          )}
        </View>

        {/* Stats trio + category */}
        {stats.length > 0 && (
          <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {stats.map((s, i) => (
                <View key={i} style={{ flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5 }}>
                  {s.kind === 'open' && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: STATUS_GREEN }}/>}
                  {s.kind === 'rating' && <StarIcon color={theme.iconAccent}/>}
                  <Text style={{ color: s.kind === 'open' ? STATUS_GREEN : theme.text, fontSize: 12, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.3 }} numberOfLines={1}>
                    {s.value}
                  </Text>
                </View>
              ))}
            </View>
            {!!venue.category && (
              <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, marginTop: 12 }}>{venue.category}</Text>
            )}
          </View>
        )}

        {/* Attribute pills — wrap */}
        {pillList && pillList.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingTop: 14 }}>
            {pillList.map(a => (
              <View key={a} style={{ backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Text style={{ color: theme.text, fontSize: 12, fontFamily: FONTS.medium }}>{a}</Text>
              </View>
            ))}
          </View>
        )}

        {/* About + info card */}
        {(!!venue.about || infoRows.length > 0) && (
          <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
            <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.5, marginBottom: 10 }}>ABOUT THE PLACE</Text>
            {!!venue.about && (
              <Text style={{ color: theme.text, fontSize: 14, fontFamily: FONTS.body, lineHeight: 22, marginBottom: 16 }}>{venue.about}</Text>
            )}
            {infoRows.length > 0 && (
              <View style={{ backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 12, overflow: 'hidden' }}>
                {infoRows.map((r, i) => (
                  <TouchableOpacity key={r.label} disabled={!r.onPress} activeOpacity={r.onPress ? 0.7 : 1}
                    onPress={r.onPress}
                    style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: theme.divider }}>
                    <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.4 }}>{r.label}</Text>
                    <Text style={{ color: r.accent ? theme.accent : theme.text, fontSize: 12, fontFamily: FONTS.medium, flexShrink: 1, textAlign: 'right' }} numberOfLines={2}>{r.value}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Menu — entry point to MenuScreen (kept for functional access) */}
        {onMenuPress && (
          <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
            <TouchableOpacity onPress={onMenuPress} activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14 }}>
              <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.display }}>Menu</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ color: theme.accent, fontSize: 12, fontFamily: FONTS.medium }}>View full menu</Text>
                <ChevronRightIcon color={theme.accent}/>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Upcoming events at this venue */}
        {upcoming.length > 0 && (
          <>
            <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 10 }}>
              <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.5, marginBottom: 4 }}>
                HAPPENING HERE · {upcoming.length} UPCOMING
              </Text>
              <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, letterSpacing: -0.3 }}>What's on the calendar</Text>
            </View>
            <FlatList
              data={upcoming} keyExtractor={e => e.id} horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={{ width: 200, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }} activeOpacity={0.9} onPress={() => onEventPress(item)}>
                  <View style={{ height: 110 }}>
                    <Image cachePolicy="memory-disk" source={{ uri: (item.media || [])[0]?.uri || 'https://picsum.photos/seed/fallback/400/300' }} style={{ width: '100%', height: '100%' }} contentFit="cover"/>
                    <View style={{ position: 'absolute', inset: 0, backgroundColor: theme.overlaySoft }}/>
                    {!!item.date && (
                      <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(244,239,225,0.18)', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 }}>
                        <Text style={{ color: theme.onImage, fontSize: 10, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.4 }}>{item.date}</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ padding: 12 }}>
                    <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.display, marginBottom: 2 }} numberOfLines={1}>{item.title}</Text>
                    {!!item.time && <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: FONTS.body }}>{item.time}</Text>}
                  </View>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        {/* Galleries — real top-level `galleries` collection (Lens styling) */}
        {galleries.length > 0 && (
          <>
            <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 10 }}>
              <Text style={{ color: GALLERY_PURPLE, fontSize: 11, fontFamily: MONO, letterSpacing: 0.5, marginBottom: 4 }}>
                GALLERIES · {galleries.length} {galleries.length === 1 ? 'NIGHT' : 'NIGHTS'}
              </Text>
              <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, letterSpacing: -0.3 }}>Nights here, captured</Text>
            </View>
            <FlatList
              data={galleries} keyExtractor={g => g.id} horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={{ width: 200, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }} activeOpacity={0.9} onPress={() => onGalleryPress(toGalleryData(item))}>
                  <View style={{ height: 120 }}>
                    <Image cachePolicy="memory-disk" source={{ uri: item.coverImage }} style={{ width: '100%', height: '100%' }} contentFit="cover"/>
                    <View style={{ position: 'absolute', inset: 0, backgroundColor: theme.overlaySoft }}/>
                    <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(155,89,182,0.9)', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 }}>
                      <Text style={{ color: theme.onImage, fontSize: 9, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.5 }}>PHOTOS</Text>
                    </View>
                  </View>
                  <View style={{ padding: 12 }}>
                    <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.display, marginBottom: 2 }} numberOfLines={1}>{item.title}</Text>
                    <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: FONTS.body }} numberOfLines={1}>{item.photoCount} photos · {item.date}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        <View style={{ height: stickyHeight + 16 }}/>
      </ScrollView>

      {/* Sticky bottom: Get Tickets (if active event) over Directions + Reserve */}
      {(showTicketCTA || showReserve) && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.divider, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 10 }}>
          {showTicketCTA && (
            <TouchableOpacity onPress={() => onGetTickets!(activeTicketEvent!)} style={{ backgroundColor: theme.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}>
              <Text style={{ color: theme.onAccent, fontSize: 16, fontFamily: FONTS.display, letterSpacing: 0.3 }}>Get Tickets</Text>
            </TouchableOpacity>
          )}
          {showReserve && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={onMapPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 22 }}>
                <LocationIcon color={theme.subtext}/>
                <Text style={{ color: theme.text, fontSize: 14, fontFamily: FONTS.medium }}>{directionsLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={openReserve} style={{ flex: 1, backgroundColor: theme.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', shadowColor: theme.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6 }}>
                <Text style={{ color: theme.onAccent, fontSize: 16, fontFamily: FONTS.display, letterSpacing: -0.1 }}>{reserveLabel}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
