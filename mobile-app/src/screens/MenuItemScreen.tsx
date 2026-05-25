// ─────────────────────────────────────────────────────────────────────
// Wugi — MenuItemScreen
// Pixel-match of the Claude Design handoff (consumer-app/MenuItemScreen).
//
// Anatomy: hero → tags + price chip row → about → ingredients →
// allergens → pairings → footer disclaimer.
//
// Hero variant logic:
//   • photo hero  — item.imageUrl present → full-bleed image with
//                   section eyebrow + name overlay
//   • text hero   — no image → dark gradient card, section name as
//                   eyebrow, item name large (all real items land here)
//
// DROPPED vs design:
//   • Double-tap-to-save / HeartBurst       — no save action wired
//   • Ingredients section                   — field absent on real items
//   • Allergens section                     — field absent on real items
//   • Pairings section                      — no pairing data in Firestore
//   • Photo hero variant (image row type)   — no image field on MenuItem
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import type { Theme } from '../constants/colors';
import type { MenuItem } from '../types';
import { BackIcon } from '../components/icons';
import { FONTS, MONO } from '../constants/fonts';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Design uses 1.2 aspect for photo hero; 1.4 for no-image hero
const PHOTO_HERO_HEIGHT = Math.round(SCREEN_WIDTH / 1.2);
const TEXT_HERO_HEIGHT  = Math.round(SCREEN_WIDTH / 1.4);

// Honey-amber tag color from design
const TAG_AMBER    = '#d4a85c';
const TAG_AMBER_BG = 'rgba(212,168,92,0.13)';
// Allergen terracotta from design
const ALLERGEN_COLOR    = '#d97a6a';
const ALLERGEN_BG       = 'rgba(217,122,106,0.12)';
const ALLERGEN_BORDER   = 'rgba(217,122,106,0.30)';

type Props = {
  item: MenuItem;
  venueName: string;
  theme: Theme;
  onBack: () => void;
};

// ── Hero sub-components ──────────────────────────────────────────────

function PhotoHero({
  item,
  section,
  onBack,
  theme,
}: {
  item: MenuItem;
  section: string | undefined;
  onBack: () => void;
  theme: Theme;
}) {
  return (
    <View
      style={{
        width: SCREEN_WIDTH,
        height: PHOTO_HERO_HEIGHT,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Image
        cachePolicy="memory-disk"
        source={{ uri: item.imageUrl! }}
        style={{ width: '100%', height: '100%' }}
        contentFit="cover"
      />

      {/* Dual scrim */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: PHOTO_HERO_HEIGHT * 0.4,
          backgroundColor: 'rgba(0,0,0,0.55)',
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: PHOTO_HERO_HEIGHT * 0.5,
          backgroundColor: 'rgba(0,0,0,0.88)',
        }}
      />

      {/* Back button */}
      <SafeAreaView
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          flexDirection: 'row',
          paddingHorizontal: 16,
          paddingTop: 8,
        }}
      >
        <TouchableOpacity
          onPress={onBack}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: 'rgba(0,0,0,0.5)',
            borderWidth: 1,
            borderColor: 'rgba(244,239,225,0.15)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <BackIcon color={theme.onImage} />
        </TouchableOpacity>
      </SafeAreaView>

      {/* Name + section overlay */}
      <View
        style={{
          position: 'absolute',
          bottom: 24,
          left: 0,
          right: 0,
          paddingHorizontal: 20,
        }}
      >
        {!!section && (
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
            {section.toUpperCase()}
          </Text>
        )}
        <Text
          style={{
            color: theme.onImage,
            fontSize: 36,
            fontFamily: FONTS.display,
            letterSpacing: -1.2,
            lineHeight: 38,
          }}
          numberOfLines={3}
        >
          {item.name}
        </Text>
      </View>
    </View>
  );
}

function TextHero({
  item,
  section,
  onBack,
  theme,
}: {
  item: MenuItem;
  section: string | undefined;
  onBack: () => void;
  theme: Theme;
}) {
  return (
    <View
      style={{
        width: SCREEN_WIDTH,
        height: TEXT_HERO_HEIGHT,
        position: 'relative',
        overflow: 'hidden',
        // Dark radial gradient effect via layered Views
        backgroundColor: '#0e0c08',
        borderBottomWidth: 1,
        borderBottomColor: theme.divider,
      }}
    >
      {/* Subtle green radial tint at top-left (design detail) */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -60,
          left: -60,
          width: SCREEN_WIDTH * 0.7,
          height: TEXT_HERO_HEIGHT * 0.8,
          borderRadius: SCREEN_WIDTH * 0.7,
          backgroundColor: 'rgba(42,122,90,0.07)',
        }}
      />

      {/* Back button */}
      <SafeAreaView
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          flexDirection: 'row',
          paddingHorizontal: 16,
          paddingTop: 8,
        }}
      >
        <TouchableOpacity
          onPress={onBack}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.card,
            borderWidth: 1,
            borderColor: theme.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <BackIcon color={theme.text} />
        </TouchableOpacity>
      </SafeAreaView>

      {/* Section + name */}
      <View
        style={{
          position: 'absolute',
          bottom: 28,
          left: 0,
          right: 0,
          paddingHorizontal: 24,
        }}
      >
        {!!section && (
          <Text
            style={{
              color: theme.subtext,
              fontSize: 11,
              fontFamily: MONO,
              fontWeight: '600',
              letterSpacing: 0.5,
              marginBottom: 6,
            }}
          >
            {section.toUpperCase()}
          </Text>
        )}
        <Text
          style={{
            color: '#e8e3d6',
            fontSize: 42,
            fontFamily: FONTS.display,
            letterSpacing: -1.4,
            lineHeight: 44,
          }}
          numberOfLines={3}
        >
          {item.name}
        </Text>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────
export function MenuItemScreen({ item, venueName, theme, onBack }: Props) {
  const hasImage = typeof item.imageUrl === 'string' && item.imageUrl.length > 0;

  const tags      = item.tags      || [];
  const badges    = item.badges    || [];
  const allergens = item.allergens || [];
  const ingredients = item.ingredients || [];
  const pairings  = (item.pairings || []) as string[];

  const priceStr =
    item.priceDisplay ||
    (typeof item.price === 'number' ? `$${item.price.toFixed(0)}` : '');
  const hasPrice = priceStr.length > 0;

  const hasTags = tags.length > 0 || badges.length > 0 || hasPrice;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* ── Hero ── */}
        {hasImage ? (
          <PhotoHero item={item} section={item.section} onBack={onBack} theme={theme} />
        ) : (
          <TextHero item={item} section={item.section} onBack={onBack} theme={theme} />
        )}

        {/* ── Tags + price chip row ── */}
        {hasTags && (
          <View
            style={{
              paddingHorizontal: 16,
              paddingTop: 14,
              flexDirection: 'row',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            {/* Badges */}
            {badges.map((b) => (
              <View
                key={b}
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 4,
                  backgroundColor: theme.accent,
                }}
              >
                <Text
                  style={{
                    color: theme.onAccent,
                    fontSize: 10,
                    fontFamily: MONO,
                    fontWeight: '800',
                    letterSpacing: 1,
                  }}
                >
                  {b}
                </Text>
              </View>
            ))}

            {/* Tags */}
            {tags.map((t) => (
              <View
                key={t}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 6,
                  backgroundColor: TAG_AMBER_BG,
                }}
              >
                <Text
                  style={{
                    color: TAG_AMBER,
                    fontSize: 10,
                    fontFamily: MONO,
                    fontWeight: '700',
                    letterSpacing: 0.5,
                  }}
                >
                  {t}
                </Text>
              </View>
            ))}

            {/* Price */}
            {hasPrice && (
              <View
                style={{
                  marginLeft: 'auto',
                  paddingHorizontal: 11,
                  paddingVertical: 5,
                  borderRadius: 8,
                  backgroundColor: theme.card,
                  borderWidth: 1,
                  borderColor: theme.border,
                }}
              >
                <Text
                  style={{
                    color: theme.text,
                    fontSize: 13,
                    fontFamily: MONO,
                    fontWeight: '600',
                  }}
                >
                  {priceStr}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── About / description ── */}
        {!!item.description && (
          <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
            <Text
              style={{
                color: theme.subtext,
                fontSize: 11,
                fontFamily: MONO,
                fontWeight: '600',
                letterSpacing: 0.5,
                marginBottom: 6,
              }}
            >
              ABOUT
            </Text>
            <Text
              style={{
                color: theme.text,
                fontSize: 15,
                fontFamily: FONTS.body,
                lineHeight: 23,
              }}
            >
              {item.description}
            </Text>
          </View>
        )}

        {/* ── Ingredients chips ── (only when data exists) */}
        {ingredients.length > 0 && (
          <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
            <Text
              style={{
                color: theme.subtext,
                fontSize: 11,
                fontFamily: MONO,
                fontWeight: '600',
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              INGREDIENTS
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {ingredients.map((ing) => (
                <View
                  key={ing}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: theme.card,
                    borderWidth: 1,
                    borderColor: theme.border,
                  }}
                >
                  <Text
                    style={{
                      color: theme.text,
                      fontSize: 12.5,
                      fontFamily: FONTS.medium,
                    }}
                  >
                    {ing}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Allergens ── (only when data exists) */}
        {allergens.length > 0 && (
          <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
            <Text
              style={{
                color: theme.subtext,
                fontSize: 11,
                fontFamily: MONO,
                fontWeight: '600',
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              CONTAINS
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {allergens.map((a) => (
                <View
                  key={a}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 6,
                    backgroundColor: ALLERGEN_BG,
                    borderWidth: 1,
                    borderColor: ALLERGEN_BORDER,
                  }}
                >
                  <Text
                    style={{
                      color: ALLERGEN_COLOR,
                      fontSize: 11,
                      fontFamily: MONO,
                      fontWeight: '600',
                      letterSpacing: 0.4,
                    }}
                  >
                    {a.toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Pairings ── (only when data exists) */}
        {pairings.length > 0 && (
          <View style={{ paddingTop: 24 }}>
            <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
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
                GOES WELL WITH
              </Text>
              <Text
                style={{
                  color: theme.text,
                  fontSize: 17,
                  fontFamily: FONTS.display,
                  letterSpacing: -0.3,
                }}
              >
                Pairings
              </Text>
            </View>
            <View style={{ paddingHorizontal: 16, gap: 8 }}>
              {pairings.map((p) => (
                <View
                  key={p}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    backgroundColor: theme.card,
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 12,
                  }}
                >
                  <Text
                    style={{
                      flex: 1,
                      color: theme.text,
                      fontSize: 14,
                      fontFamily: FONTS.medium,
                    }}
                  >
                    {p}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Footer disclaimer ── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 28 }}>
          <Text
            style={{
              color: theme.subtext,
              fontSize: 11,
              fontFamily: FONTS.body,
              lineHeight: 16,
              textAlign: 'center',
            }}
          >
            Allergens noted on request. Ask your server about ingredient changes.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
