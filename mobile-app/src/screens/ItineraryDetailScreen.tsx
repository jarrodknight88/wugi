// ─────────────────────────────────────────────────────────────────────
// Wugi — ItineraryDetailScreen   (curated multi-stop route)
//
// Design source: ui_kits/consumer-app/ItineraryScreen.jsx +
// design_handoff_discover_itinerary/README.md §2.
//
// Reached from the editorial Discover itinerary hero card. Fetches the
// itinerary doc by id from the top-level `itineraries` collection
// (seeded Wave 2.5) and renders a hero + blurb + ordered "THE ROUTE"
// timeline of numbered, connected stops. Each stop deep-links to its
// venue.
//
// DROPPED vs the kit (real-data-only):
//   • Meta strip "duration" + "WALKABLE" chips — duration/walking-time
//     aren't seeded (would need scheduling/geo). The N STOPS + neighborhood
//     chips remain; both are real fields.
//   • Per-stop `time` chip + per-stop `action` sentence — not seeded.
//     Stops show venue name + category sub (real card.sub) + "View venue ›".
//   • "Save this route" sticky CTA — FavoriteItem.type doesn't model
//     itineraries yet; dropped to avoid a parallel persistence path.
//   • Itinerary share/report in the kebab — kebab kept with Share + Report
//     (no Save) so the action sheet matches Event/Venue style.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Dimensions,
  ActionSheetIOS, Platform, Alert, Share, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../constants/colors';
import type { VenueData, ItineraryDoc, EditorialCard } from '../types';
import { FONTS, MONO } from '../constants/fonts';
import { BackIcon, ChevronRightIcon, KebabVerticalIcon } from '../components/icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = Math.round(SCREEN_WIDTH / 1.1);   // aspect 1.1 per spec

type Props = {
  itineraryId: string;
  theme: Theme;
  onBack: () => void;
  onVenuePress: (venue: VenueData) => void;
};

function toVenueData(v: any): VenueData {
  return {
    id: v.id, name: v.name, category: v.category || '',
    address: v.address || '', phone: v.phone || '',
    logoUrl: v.logoUrl || '',
    website: v.website || '', instagram: v.instagram || '',
    attributes: v.attributes || [], about: v.about || '',
    media: (v.media || []).map((m: any) => typeof m === 'string' ? { type: 'image', uri: m } : m),
    menuDescription: v.about || '', menuAttributes: v.attributes || [],
    bestSellers: [], upcomingEvents: [], galleries: [],
    shortDescription: v.shortDescription, neighborhood: v.neighborhood,
    priceTier: v.priceTier, rating: v.rating, age: v.age,
    dressCode: v.dressCode, hoursText: v.hoursText,
    openStatusHint: v.openStatusHint, amenities: v.amenities, vibes: v.vibes,
    reservationProvider: v.reservationProvider, reservationUrl: v.reservationUrl,
    reservationUrlWithDefaults: v.reservationUrlWithDefaults,
    ctaPrimary: v.ctaPrimary, ctaSecondary: v.ctaSecondary,
  } as VenueData;
}

// ── One stop: numbered node + spine + tappable venue card ──────────────
function StopRow({ n, card, theme, isLast, onVenuePress }: {
  n: number; card: EditorialCard; theme: Theme; isLast: boolean;
  onVenuePress: (card: EditorialCard) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 14 }}>
      {/* Spine column — accent-filled circular node with a ring; the
          connecting spine below links to the next node. The last stop
          omits the trailing spine so the route visibly ends. */}
      <View style={{ width: 32, alignItems: 'center', flexShrink: 0 }}>
        <View style={{
          width: 32, height: 32, borderRadius: 16,
          backgroundColor: theme.accent,
          alignItems: 'center', justifyContent: 'center',
          // 4px outer ring via shadow (works on both platforms).
          shadowColor: theme.accent, shadowOpacity: 0.18, shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
          borderWidth: 4, borderColor: 'rgba(42,122,90,0.15)',
        }}>
          <Text style={{ color: theme.onAccent, fontSize: 14, fontFamily: MONO, fontWeight: '700' }}>{n}</Text>
        </View>
        {!isLast && (
          <LinearGradient
            colors={[`${theme.accent}88`, theme.border]}
            style={{ flex: 1, width: 2, marginTop: 2, minHeight: 56 }}
          />
        )}
      </View>

      {/* Stop card */}
      <TouchableOpacity
        activeOpacity={card.venueId ? 0.88 : 1}
        onPress={card.venueId ? () => onVenuePress(card) : undefined}
        disabled={!card.venueId}
        style={{
          flex: 1, marginBottom: isLast ? 0 : 16,
          backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
          borderRadius: 14, overflow: 'hidden', flexDirection: 'row',
        }}
      >
        <Image source={{ uri: card.image }} style={{ width: 92, height: 92 }} contentFit="cover" cachePolicy="memory-disk"/>
        <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 11, gap: 4 }}>
          <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.display, letterSpacing: -0.2, lineHeight: 18 }}>
            {card.title}
          </Text>
          {!!card.sub && (
            <Text numberOfLines={2} style={{ color: theme.subtext, fontSize: 12.5, fontFamily: FONTS.body, lineHeight: 17 }}>
              {card.sub}
            </Text>
          )}
          <View style={{ marginTop: 'auto', flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Text style={{ color: theme.accent, fontSize: 11, fontFamily: FONTS.medium }}>View venue</Text>
            <ChevronRightIcon color={theme.accent}/>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────
export function ItineraryDetailScreen({ itineraryId, theme, onBack, onVenuePress }: Props) {
  const [itinerary, setItinerary] = useState<ItineraryDoc | null>(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const svc = await import('../../firestoreService');
        const doc = await svc.getItineraryById(itineraryId);
        if (!cancelled) setItinerary(doc);
      } catch (e) {
        console.log('ItineraryDetailScreen: load failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [itineraryId]);

  const handleStopTap = async (card: EditorialCard) => {
    if (!card.venueId) return;
    try {
      const svc = await import('../../firestoreService');
      const v = await svc.getVenueById(card.venueId);
      if (v) onVenuePress(toVenueData(v));
    } catch (e) {
      console.log('ItineraryDetailScreen: stop venue load failed', e);
    }
  };

  const openOverflow = () => {
    if (!itinerary) return;
    const title = itinerary.title;
    const options = ['Share itinerary', 'Report', 'Cancel'];
    const cancelIndex = options.length - 1;
    const destructiveIndex = options.indexOf('Report');
    const doShare = () => Share.share({ message: `Check out "${title}" on Wugi!`, title }).catch(() => {});
    const doReport = () => Alert.alert('Report itinerary', 'Thank you — we\'ll review this.', [{ text: 'OK' }]);
    const handleAction = (index: number) => {
      if (index === 0) doShare();
      else if (index === 1) doReport();
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIndex, destructiveButtonIndex: destructiveIndex, title },
        handleAction,
      );
    } else {
      Alert.alert(title, 'Choose an action', [
        { text: 'Share itinerary', onPress: doShare },
        { text: 'Report',          onPress: doReport, style: 'destructive' },
        { text: 'Cancel',          style: 'cancel' },
      ]);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} size="large"/>
      </View>
    );
  }
  if (!itinerary) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.display, marginBottom: 8 }}>Itinerary not found</Text>
        <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, textAlign: 'center', marginBottom: 16 }}>
          The route may have been removed.
        </Text>
        <TouchableOpacity onPress={onBack} style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}>
          <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.medium }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Stops are the `cards` of kind 'stop' on the itinerary doc. The hero
  // 'itinerary' card is decorative (used on the editorial Discover shelf)
  // and isn't shown on the detail page.
  const stops = (itinerary.cards || []).filter(c => c.kind === 'stop');
  const neighborhood = (itinerary.neighborhood || '').toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero — cover image, bleeds −24px into bg so the seam is invisible. */}
        <View style={{ width: SCREEN_WIDTH, height: HERO_HEIGHT, marginBottom: -24 }}>
          {!!itinerary.coverImage && (
            <Image source={{ uri: itinerary.coverImage }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="memory-disk"/>
          )}
          {/* Bottom scrim — transparent → mild → theme.bg so the marginBottom:-24 seam vanishes. */}
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(0,0,0,0.5)', 'transparent', 'transparent', theme.bg]}
            locations={[0, 0.22, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />

          {/* Top controls — back left, kebab right, glass-pill style matching
              Event/Venue Wave 1. */}
          <View style={{ position: 'absolute', top: 64, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', zIndex: 2 }}>
            <TouchableOpacity onPress={onBack} activeOpacity={0.8}>
              <BlurView intensity={20} tint="dark" style={{ width: 40, height: 40, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(244,239,225,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <LinearGradient
                  colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.25)']}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                />
                <BackIcon color="#f4efe1"/>
              </BlurView>
            </TouchableOpacity>
            <TouchableOpacity onPress={openOverflow} activeOpacity={0.8}>
              <BlurView intensity={20} tint="dark" style={{ width: 40, height: 40, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(244,239,225,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <LinearGradient
                  colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.25)']}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                />
                <KebabVerticalIcon color="#f4efe1"/>
              </BlurView>
            </TouchableOpacity>
          </View>

          {/* Title block — eyebrow + parchment-gradient title. Parchment gradient
              isn't natively supported on Text without MaskedView, so we render
              the title in a clean parchment off-white instead — visually close
              and avoids a new native dep. */}
          <View style={{ position: 'absolute', bottom: 44, left: 0, right: 0, paddingHorizontal: 20, zIndex: 2 }}>
            <Text style={{ color: theme.accent, fontSize: 11, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 }}>
              ITINERARY{neighborhood ? ` · ${neighborhood}` : ''}
            </Text>
            <Text style={{ color: '#f0ebdc', fontSize: 38, fontFamily: FONTS.display, letterSpacing: -1.3, lineHeight: 40 }} numberOfLines={3}>
              {itinerary.title}
            </Text>
          </View>
        </View>

        {/* Meta strip — N STOPS + NEIGHBORHOOD chips (duration + walkable dropped
            per real-data rule). */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14, flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
            <Text style={{ color: theme.text, fontSize: 12, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.3 }}>
              {stops.length} STOP{stops.length === 1 ? '' : 'S'}
            </Text>
          </View>
          {!!neighborhood && (
            <View style={{ flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
              <Text style={{ color: theme.text, fontSize: 12, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.3 }} numberOfLines={1}>
                {neighborhood}
              </Text>
            </View>
          )}
        </View>

        {/* Blurb — render only when seeded subtitle exists (real data only). */}
        {!!itinerary.subtitle && (
          <View style={{ paddingHorizontal: 16, paddingTop: 22 }}>
            <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 6 }}>
              THE NIGHT
            </Text>
            <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.body, lineHeight: 23 }}>
              {itinerary.subtitle}
            </Text>
          </View>
        )}

        {/* The Route — eyebrow + heading + timeline of stops. */}
        {stops.length > 0 && (
          <>
            <View style={{ paddingHorizontal: 16, paddingTop: 28, paddingBottom: 4 }}>
              <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 }}>
                THE ROUTE · IN ORDER
              </Text>
              <Text style={{ color: theme.text, fontSize: 20, fontFamily: FONTS.display, letterSpacing: -0.5 }}>
                {stops.length} stops, start to finish
              </Text>
            </View>
            <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
              {stops.map((c, i) => (
                <StopRow
                  key={`stop-${i}`}
                  n={i + 1}
                  card={c}
                  theme={theme}
                  isLast={i === stops.length - 1}
                  onVenuePress={handleStopTap}
                />
              ))}
            </View>
          </>
        )}

        {/* Footer note */}
        <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 40, alignItems: 'center' }}>
          <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: FONTS.body, lineHeight: 17, textAlign: 'center' }}>
            A Wugi curated route. Go at your own pace.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
