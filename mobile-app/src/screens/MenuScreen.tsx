// ─────────────────────────────────────────────────────────────────────
// Wugi — MenuScreen
// Pixel-match of the Claude Design handoff (consumer-app/MenuScreen).
//
// Anatomy: full-bleed hero (1.8:1) with venue image + name overlay →
// sticky section-pill nav → grouped menu rows → footer note.
//
// Data: menu items are fetched from the `venues/{venueId}/menu`
// subcollection and grouped by their `section` field. Venue hero image
// comes from the `venues/{venueId}` doc (media[0]). No per-item images
// exist in the data schema — the featured (photo) row variant is DROPPED
// and all items render as compact text rows.
//
// DROPPED vs design:
//   • Featured / photo row variant   — no image field on MenuItem
//   • Item badge overlay on photos   — no images
//   • Kitchen status chip row        — no kitchen status data in Firestore
//   • Sticky cart pill               — future mobile ordering, not launched
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Dimensions,
  FlatList,
  Alert,
  Share,
} from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import type { Theme } from '../constants/colors';
import type { MenuItem } from '../types';
import { BackIcon, ShareIcon, FlagIcon } from '../components/icons';
import { FONTS, MONO } from '../constants/fonts';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = Math.round(SCREEN_WIDTH / 1.8);
// Honey-amber tag color from design
const TAG_AMBER = '#d4a85c';
const TAG_AMBER_BG = 'rgba(212,168,92,0.13)';

type SectionBucket = { name: string; items: MenuItem[] };

type Props = {
  venueId: string;
  venueName: string;
  theme: Theme;
  onBack: () => void;
  onItemPress: (item: MenuItem) => void;
};

// ── Section nav pill bar (sticky) ────────────────────────────────────
function SectionNav({
  sections,
  active,
  onPick,
  theme,
}: {
  sections: SectionBucket[];
  active: string;
  onPick: (name: string) => void;
  theme: Theme;
}) {
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: theme.divider,
        paddingVertical: 10,
        backgroundColor: theme.bg,
      }}
    >
      <FlatList
        data={sections}
        keyExtractor={(s) => s.name}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}
        renderItem={({ item: s }) => {
          const on = s.name === active;
          return (
            <TouchableOpacity
              onPress={() => onPick(s.name)}
              activeOpacity={0.8}
              style={{
                flexShrink: 0,
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: 999,
                backgroundColor: on ? theme.accent : theme.card,
                borderWidth: 1,
                borderColor: on ? theme.accent : theme.border,
              }}
            >
              <Text
                style={{
                  color: on ? theme.onAccent : theme.text,
                  fontSize: 12.5,
                  fontFamily: FONTS.medium,
                  letterSpacing: -0.1,
                }}
              >
                {s.name}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

// ── Compact text-only menu row ───────────────────────────────────────
// Price renders only when explicitly provided — no fallback.
function MenuRowCompact({
  item,
  onPress,
  isLast,
  theme,
}: {
  item: MenuItem;
  onPress: () => void;
  isLast: boolean;
  theme: Theme;
}) {
  const priceStr =
    item.priceDisplay ||
    (typeof item.price === 'number' ? `$${item.price.toFixed(0)}` : '');
  const hasPrice = priceStr.length > 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={{
        paddingHorizontal: 16,
        paddingVertical: item.description ? 14 : 12,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: theme.divider,
        borderStyle: 'dashed',
        backgroundColor: 'transparent',
      }}
    >
      {/* Name + price on same baseline row */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Text
          style={{
            flex: 1,
            color: theme.text,
            fontSize: 15,
            fontFamily: FONTS.medium,
            letterSpacing: -0.2,
          }}
        >
          {item.name}
        </Text>
        {hasPrice && (
          <Text
            style={{
              color: theme.text,
              fontSize: 14,
              fontFamily: MONO,
              fontWeight: '600',
              letterSpacing: -0.1,
              paddingTop: 1,
            }}
          >
            {priceStr}
          </Text>
        )}
      </View>

      {/* Description */}
      {!!item.description && (
        <Text
          style={{
            color: theme.subtext,
            fontSize: 13,
            fontFamily: FONTS.body,
            lineHeight: 18.5,
            marginTop: 3,
          }}
        >
          {item.description}
        </Text>
      )}

      {/* Tags */}
      {item.tags && item.tags.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
          {item.tags.map((t) => (
            <View
              key={t}
              style={{
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 4,
                backgroundColor: TAG_AMBER_BG,
              }}
            >
              <Text
                style={{
                  color: TAG_AMBER,
                  fontSize: 9,
                  fontFamily: MONO,
                  fontWeight: '700',
                  letterSpacing: 0.5,
                }}
              >
                {t}
              </Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Section block ──────────────────────────────────────────────────
function MenuSectionBlock({
  section,
  onItem,
  theme,
}: {
  section: SectionBucket;
  onItem: (item: MenuItem) => void;
  theme: Theme;
}) {
  return (
    <View>
      {/* Section header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8 }}>
        <Text
          style={{
            color: theme.subtext,
            fontSize: 11,
            fontFamily: MONO,
            fontWeight: '600',
            letterSpacing: 0.5,
            marginBottom: 4,
          }}
        >
          {section.name.toUpperCase()}
        </Text>
        <Text
          style={{
            color: theme.text,
            fontSize: 20,
            fontFamily: FONTS.display,
            letterSpacing: -0.5,
          }}
        >
          {section.name}
        </Text>
      </View>

      {/* Item rows on surface background */}
      <View style={{ backgroundColor: theme.surface }}>
        {section.items.map((item, idx) => (
          <MenuRowCompact
            key={item.id}
            item={item}
            onPress={() => onItem(item)}
            isLast={idx === section.items.length - 1}
            theme={theme}
          />
        ))}
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────
export function MenuScreen({ venueId, venueName, theme, onBack, onItemPress }: Props) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [heroUri, setHeroUri] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { getFirestore, collection, getDocs, doc, getDoc } =
          await import('@react-native-firebase/firestore');
        const db = getFirestore();

        // Fetch menu items + venue hero image in parallel
        const [menuSnap, venueSnap] = await Promise.all([
          getDocs(collection(db, 'venues', venueId, 'menu')),
          getDoc(doc(db, 'venues', venueId)),
        ]);

        if (cancelled) return;

        const loaded: MenuItem[] = (menuSnap.docs as any[]).map((d) => {
          const data = (d.data?.() ?? {}) as Partial<MenuItem>;
          return { ...data, id: data.id ?? d.id } as MenuItem;
        });
        setItems(loaded);

        // Extract first hero image from venue doc
        if (venueSnap.exists()) {
          const vd = venueSnap.data() as any;
          const media: any[] = vd?.media || [];
          const first = media[0];
          const uri = typeof first === 'string' ? first : first?.uri ?? '';
          if (uri) setHeroUri(uri);
        }
      } catch (_e) {
        // Subcollection missing or offline — render empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [venueId]);

  // Group items by section, preserving first-seen order
  const sections: SectionBucket[] = [];
  for (const item of items) {
    const sectionName = item.section || 'Menu';
    let bucket = sections.find((s) => s.name === sectionName);
    if (!bucket) {
      bucket = { name: sectionName, items: [] };
      sections.push(bucket);
    }
    bucket.items.push(item);
  }

  // Set first active section when sections arrive
  useEffect(() => {
    if (sections.length > 0 && !activeSection) {
      setActiveSection(sections[0].name);
    }
  }, [items]);

  // Share + Report handlers — mirror the EventScreen / VenueScreen /
  // ItineraryDetailScreen pattern (system Share for share; Alert ack for
  // report).
  const handleShare = () => {
    Share.share({
      message: `Check out ${venueName}'s menu on Wugi!`,
      title: `${venueName} — Menu`,
    }).catch(() => {});
  };
  const handleReport = () => {
    Alert.alert(
      'Report Menu',
      'Thank you — we\'ll review this menu.',
      [{ text: 'OK' }],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} size="large" />
          <Text
            style={{
              color: theme.subtext,
              fontSize: 13,
              fontFamily: FONTS.body,
              marginTop: 12,
            }}
          >
            Loading menu…
          </Text>
        </View>
      ) : sections.length === 0 ? (
        // ── Empty state ───────────────────────────────────────────────
        <View style={{ flex: 1 }}>
          <SafeAreaView>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingTop: 8,
                paddingBottom: 12,
                borderBottomWidth: 1,
                borderBottomColor: theme.divider,
              }}
            >
              <TouchableOpacity
                onPress={onBack}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <BackIcon color={theme.text} />
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text
                  style={{
                    color: theme.subtext,
                    fontSize: 11,
                    fontFamily: MONO,
                    fontWeight: '600',
                    letterSpacing: 0.5,
                  }}
                >
                  MENU
                </Text>
                <Text
                  style={{
                    color: theme.text,
                    fontSize: 16,
                    fontFamily: FONTS.display,
                    marginTop: 1,
                  }}
                  numberOfLines={1}
                >
                  {venueName}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <TouchableOpacity
                  onPress={handleShare}
                  style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
                >
                  <ShareIcon color={theme.text}/>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleReport}
                  style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
                >
                  <FlagIcon color={theme.text}/>
                </TouchableOpacity>
              </View>
            </View>
          </SafeAreaView>
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 32,
            }}
          >
            <Text
              style={{
                color: theme.text,
                fontSize: 17,
                fontFamily: FONTS.display,
                textAlign: 'center',
              }}
            >
              Menu coming soon
            </Text>
            <Text
              style={{
                color: theme.subtext,
                fontSize: 13,
                fontFamily: FONTS.body,
                marginTop: 6,
                textAlign: 'center',
                lineHeight: 18,
              }}
            >
              We're working with {venueName} to bring their full menu inside the
              app. Check back shortly.
            </Text>
          </View>
        </View>
      ) : (
        // ── Full menu ─────────────────────────────────────────────────
        <View style={{ flex: 1 }}>
          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 32 }}
            stickyHeaderIndices={[1]} // index of the SectionNav in the scroll
          >
            {/* ── Hero — 1.8:1, venue photo with back button ── */}
            <View
              style={{
                width: SCREEN_WIDTH,
                height: HERO_HEIGHT,
                position: 'relative',
                overflow: 'hidden',
                backgroundColor: theme.card,
              }}
            >
              {!!heroUri && (
                <Image
                  cachePolicy="memory-disk"
                  source={{ uri: heroUri }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                />
              )}

              {/* Dual-gradient scrim — top dark for button legibility,
                  bottom dark for name legibility */}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: HERO_HEIGHT * 0.45,
                  backgroundColor: 'rgba(0,0,0,0.45)',
                  // Soft fade out by using a very dark card on non-image hero
                }}
              />
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: HERO_HEIGHT * 0.55,
                  backgroundColor: theme.overlayMedium,
                }}
              />

              {/* Top icon row — Back (left) + Share + Report (right).
                  Same glass-pill BlurView pattern as Event / Venue /
                  Photo screens. */}
              <SafeAreaView
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 16,
                  paddingTop: 8,
                }}
              >
                <TouchableOpacity onPress={onBack} activeOpacity={0.85}>
                  <BlurView
                    intensity={20}
                    tint="dark"
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      overflow: 'hidden',
                      borderWidth: 1,
                      borderColor: 'rgba(244,239,225,0.15)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <BackIcon color={theme.onImage} />
                  </BlurView>
                </TouchableOpacity>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <TouchableOpacity onPress={handleShare} activeOpacity={0.85}>
                    <BlurView
                      intensity={20}
                      tint="dark"
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        overflow: 'hidden',
                        borderWidth: 1,
                        borderColor: 'rgba(244,239,225,0.15)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <ShareIcon color={theme.onImage} />
                    </BlurView>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleReport} activeOpacity={0.85}>
                    <BlurView
                      intensity={20}
                      tint="dark"
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        overflow: 'hidden',
                        borderWidth: 1,
                        borderColor: 'rgba(244,239,225,0.15)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <FlagIcon color={theme.onImage} />
                    </BlurView>
                  </TouchableOpacity>
                </View>
              </SafeAreaView>

              {/* Venue name overlay */}
              <View
                style={{
                  position: 'absolute',
                  bottom: 16,
                  left: 0,
                  right: 0,
                  paddingHorizontal: 20,
                }}
              >
                <Text
                  style={{
                    color: 'rgba(244,239,225,0.75)',
                    fontSize: 11,
                    fontFamily: MONO,
                    fontWeight: '600',
                    letterSpacing: 0.5,
                    marginBottom: 4,
                  }}
                >
                  MENU
                </Text>
                <Text
                  style={{
                    color: theme.onImage,
                    fontSize: 32,
                    fontFamily: FONTS.display,
                    letterSpacing: -1.2,
                    lineHeight: 34,
                  }}
                  numberOfLines={2}
                >
                  {venueName}
                </Text>
              </View>
            </View>

            {/* ── Sticky section nav ── (stickyHeaderIndices=[1]) */}
            <SectionNav
              sections={sections}
              active={activeSection}
              onPick={setActiveSection}
              theme={theme}
            />

            {/* ── Menu sections ── */}
            {sections.map((s) => (
              <MenuSectionBlock
                key={s.name}
                section={s}
                onItem={onItemPress}
                theme={theme}
              />
            ))}

            {/* Footer note */}
            <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8 }}>
              <Text
                style={{
                  color: theme.subtext,
                  fontSize: 11,
                  fontFamily: FONTS.body,
                  lineHeight: 16,
                  textAlign: 'center',
                }}
              >
                Allergens noted on request. 20% gratuity added to parties of 6 or more.
              </Text>
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}
