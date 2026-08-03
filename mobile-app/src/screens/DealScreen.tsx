// ─────────────────────────────────────────────────────────────────────
// Wugi — DealScreen
//
// Deal detail page (UAT-W3-4), modeled on EventScreen/VenueScreen's
// UAT-W2B layout: hero media, title below the media (not on top of it),
// venue strip with tap-through, schedule/validity chip, offer + details
// copy, and a sticky "View Venue" CTA. Deals carry a single `image` (no
// carousel) and have no ticket/reservation flow, so the hero and CTA are
// simpler than EventScreen's.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  Dimensions, StyleSheet, Image as RNImage,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import type { Theme } from '../constants/colors';
import type { FSDeal, VenueData } from '../types';
import { FONTS, MONO } from '../constants/fonts';
import { BackIcon, ChevronRightIcon } from '../components/icons';
import { VenueIdentityBlock } from '../components/VenueIdentityBlock';
import { GetARideButton } from '../components/GetARideButton';
import { useVenueById } from '../hooks/useVenueById';
import { ErrorBoundary } from '../components/error/ErrorBoundary';
import { hexToRgba } from '../utils/color';
import { dealTypeLabel, dealOffer, formatDealSchedule, isDealActiveNow } from '../utils/deals';
import { DEAL_COLOR } from '../components/DealCard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DEFAULT_HERO_ASPECT_RATIO = 0.95;
const DEFAULT_HERO_HEIGHT = Math.round(SCREEN_WIDTH / DEFAULT_HERO_ASPECT_RATIO);

type Props = {
  deal: FSDeal;
  onBack: () => void;
  onNavigateToVenue?: (venue: VenueData) => void;
  onMapPress: (address: string, venueName: string) => void;
  theme: Theme;
};

function DealScreenInner({ deal, onBack, onNavigateToVenue, onMapPress, theme }: Props) {
  const { venue } = useVenueById(deal.venueId ?? null);

  // Same portrait-aware hero sizing as EventScreen — a deal's promo graphic
  // is often a portrait flyer and shouldn't be cropped.
  const [heroAspectRatio, setHeroAspectRatio] = useState(DEFAULT_HERO_ASPECT_RATIO);
  useEffect(() => {
    if (!deal.image) { setHeroAspectRatio(DEFAULT_HERO_ASPECT_RATIO); return; }
    let cancelled = false;
    RNImage.getSize(
      deal.image,
      (w, h) => { if (!cancelled && w > 0 && h > 0) setHeroAspectRatio(w / h); },
      () => { if (!cancelled) setHeroAspectRatio(DEFAULT_HERO_ASPECT_RATIO); },
    );
    return () => { cancelled = true; };
  }, [deal.image]);

  const isPortraitHero = heroAspectRatio < 1;
  const HERO_HEIGHT = isPortraitHero
    ? Math.round(SCREEN_WIDTH / heroAspectRatio)
    : DEFAULT_HERO_HEIGHT;

  const handleVenuePress = () => {
    if (venue && onNavigateToVenue) onNavigateToVenue(venue as unknown as VenueData);
  };

  const schedule = formatDealSchedule(deal);
  const activeNow = isDealActiveNow(deal);
  const offer = dealOffer(deal);
  // `description` is the longer copy; only show it as a separate section
  // when it says something the offer line doesn't already say.
  const details = deal.description && deal.description !== offer ? deal.description : '';

  const showVenueCTA = !!venue && !!onNavigateToVenue;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* ── Hero — single deal image, portrait-aware, no carousel ── */}
        <View style={{ width: SCREEN_WIDTH, height: HERO_HEIGHT, marginBottom: isPortraitHero ? 0 : -24 }}>
          {deal.image ? (
            <Image
              cachePolicy="memory-disk"
              source={{ uri: deal.image }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
            />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body }}>No media yet</Text>
            </View>
          )}

          {/* Deal-type badge, top-left over the hero — same terracotta as DealCard */}
          <View style={{ position: 'absolute', top: 64, left: 20, backgroundColor: DEAL_COLOR, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Text style={{ color: theme.onImage, fontSize: 10, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.8 }}>
              {dealTypeLabel(deal.dealType)}
            </Text>
          </View>

          {/* Bottom scrim bridging into the title block below (UAT-W2B pattern) */}
          <LinearGradient
            colors={['transparent', 'transparent', 'rgba(0,0,0,0.25)', theme.bg]}
            locations={[0, 0.55, 0.75, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>

        {/* ── Deal title — below the media (UAT-W2B) ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
          <Text
            numberOfLines={3}
            style={{ color: theme.text, fontSize: 30, fontFamily: FONTS.display, letterSpacing: -1.1, lineHeight: 33 }}
          >
            {deal.title ?? ''}
          </Text>
          {!!offer && (
            <Text style={{ color: theme.accent, fontSize: 15, fontFamily: FONTS.medium, marginTop: 6 }}>
              {offer}
            </Text>
          )}
        </View>

        {/* ── Schedule / active-now chips ── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14, flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: schedule ? 2 : 1, paddingVertical: 9, borderRadius: 10, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
            <Text style={{ color: theme.text, fontSize: 12, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.2 }} numberOfLines={1}>
              {schedule || 'ALWAYS ON'}
            </Text>
          </View>
          <View style={{ flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: activeNow ? theme.accent : theme.card, borderWidth: 1, borderColor: activeNow ? theme.accent : theme.border, alignItems: 'center' }}>
            <Text style={{ color: activeNow ? theme.onAccent : theme.subtext, fontSize: 12, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.2 }} numberOfLines={1}>
              {activeNow ? 'ACTIVE NOW' : 'NOT ACTIVE'}
            </Text>
          </View>
        </View>

        {/* ── Venue strip ── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
          {venue ? (
            <VenueIdentityBlock
              name={venue.name || deal.venueName || 'Venue'}
              address={venue.address || ''}
              phone={venue.phone || ''}
              website={venue.website || ''}
              instagram={venue.instagram || ''}
              logoUrl={venue.logoUrl || ''}
              onAddressPress={() => onMapPress(venue.address || '', venue.name || deal.venueName)}
              onVenuePress={handleVenuePress}
              theme={theme}
            />
          ) : deal.venueName ? (
            <TouchableOpacity
              onPress={handleVenuePress}
              disabled={!showVenueCTA}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
              activeOpacity={0.8}
            >
              <View style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: theme.subtext, fontSize: 10, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.5 }}>
                  {(deal.venueName as string).slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 16, fontFamily: FONTS.display, letterSpacing: -0.2 }} numberOfLines={1}>
                  {deal.venueName}
                </Text>
              </View>
              {showVenueCTA && <ChevronRightIcon color={theme.subtext}/>}
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── Get a ride ── */}
        {!!venue?.location && (
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <GetARideButton location={venue.location} venueName={venue.name || deal.venueName} theme={theme}/>
          </View>
        )}

        {/* ── Details / terms — the deal data model has no dedicated
             "terms" field; `description` is the closest fit. ── */}
        {!!details && (
          <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
            <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8 }}>
              DETAILS
            </Text>
            <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.body, lineHeight: 23 }}>
              {details}
            </Text>
          </View>
        )}

        <View style={{ height: showVenueCTA ? 120 : 40 }}/>
      </ScrollView>

      {/* ── Status-bar wash + back control — same treatment as EventScreen ── */}
      <LinearGradient
        pointerEvents="none"
        colors={[hexToRgba(theme.bg, 0.92), hexToRgba(theme.bg, 0.55), hexToRgba(theme.bg, 0)]}
        locations={[0, 0.6, 1]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 60, zIndex: 50 }}
      />
      <View style={{ position: 'absolute', top: 64, left: 20, zIndex: 51 }}>
        <TouchableOpacity onPress={onBack} activeOpacity={0.8}>
          <BlurView intensity={20} tint="dark" style={styles.controlButton}>
            <LinearGradient colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.25)']} style={StyleSheet.absoluteFill}/>
            <BackIcon color="#f4efe1"/>
          </BlurView>
        </TouchableOpacity>
      </View>

      {/* ── Sticky CTA — "View Venue" ── */}
      {showVenueCTA && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.divider, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32 }}>
          <TouchableOpacity
            onPress={handleVenuePress}
            style={{
              backgroundColor: theme.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
              shadowColor: theme.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
            }}
            activeOpacity={0.88}
          >
            <Text style={{ color: theme.onAccent, fontSize: 16, fontFamily: FONTS.display, letterSpacing: -0.1 }}>
              View Venue
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  controlButton: {
    width: 40, height: 40, borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(244,239,225,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
});

export function DealScreen(props: Props) {
  return (
    <ErrorBoundary label="this deal" screen="DealScreen" venueId={props.deal?.venueId ?? null} onBack={props.onBack}>
      <DealScreenInner {...props} />
    </ErrorBoundary>
  );
}
