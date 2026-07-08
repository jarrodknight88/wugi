// ─────────────────────────────────────────────────────────────────────
// Wugi — OnboardingScreen
// 3-slide first-launch intro shown BEFORE the app (not after signup —
// the pitch belongs to people who haven't converted yet). Skippable on
// every slide; finishing or skipping lands directly on the Home feed.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Dimensions, SafeAreaView,
} from 'react-native';
import { FONTS } from '../constants/fonts';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const SLIDES = [
  {
    id: 0,
    emoji: '🎯',
    title: 'Find Your Vibe',
    subtitle: 'Boujee, Divey, Speakeasy, High Energy — filter Atlanta nightlife by the energy you actually want tonight.',
    accent: '#9b59b6',
    glow: '#2d0a4e',
  },
  {
    id: 1,
    emoji: '📸',
    title: 'See It Live',
    subtitle: "Real-time photos from the scene, published by our photographers in under 2 minutes. Know before you go.",
    accent: '#2a7a5a',
    glow: '#0a1a10',
  },
  {
    id: 2,
    emoji: '✨',
    title: 'Made For You',
    subtitle: 'Swipe through a personalized feed of events, venues, and deals curated to your exact taste in Atlanta.',
    accent: '#e67e22',
    glow: '#1f0e00',
  },
];

type Props = {
  onFinish: () => void;
  // "Already have an account?" — lands on Home with the auth sheet open
  // in sign-in mode. Optional so the intro also works standalone.
  onSignIn?: () => void;
};

export function OnboardingScreen({ onFinish, onSignIn }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const slide = SLIDES[currentIndex];
  const isLast = currentIndex === SLIDES.length - 1;

  const goTo = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
    setCurrentIndex(index);
  };

  const handleNext = () => {
    if (!isLast) goTo(currentIndex + 1);
    else onFinish();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0e0c08' }}>
      {/* Skip button — visible on every slide; the content is one tap away */}
      <SafeAreaView style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 8 }}>
        {!isLast && (
          <TouchableOpacity
            onPress={onFinish}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ paddingVertical: 8, paddingHorizontal: 4 }}
          >
            <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14, fontFamily: FONTS.medium }}>Skip</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>

      {/* Slides — horizontal pager */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        style={{ flex: 1 }}
      >
        {SLIDES.map(s => (
          <View key={s.id} style={{
            width: SCREEN_WIDTH,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 36,
            paddingBottom: 40,
          }}>
            {/* Outer ambient glow disc */}
            <View style={{
              position: 'absolute',
              width: 260, height: 260, borderRadius: 130,
              backgroundColor: s.accent, opacity: 0.1, top: '12%',
            }}/>

            {/* Glow well — dark inner disc + border ring + emoji */}
            <View style={{
              width: 140, height: 140, borderRadius: 70,
              backgroundColor: s.glow,
              borderWidth: 1.5, borderColor: s.accent + '40',
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 44,
              shadowColor: s.accent, shadowOpacity: 0.3,
              shadowRadius: 20, shadowOffset: { width: 0, height: 0 },
            }}>
              <Text style={{ fontSize: 58 }}>{s.emoji}</Text>
            </View>

            <Text style={{
              color: '#fff', fontSize: 34, fontFamily: FONTS.display,
              textAlign: 'center', letterSpacing: -0.8,
              marginBottom: 18, lineHeight: 40,
            }}>
              {s.title}
            </Text>

            <Text style={{
              color: 'rgba(255,255,255,0.5)', fontSize: 16,
              fontFamily: FONTS.body,
              textAlign: 'center', lineHeight: 26,
            }}>
              {s.subtitle}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* Footer — dots + CTA */}
      <SafeAreaView style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
        {/* Dot indicators */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 28 }}>
          {SLIDES.map((_, i) => (
            <TouchableOpacity key={i} onPress={() => goTo(i)}>
              <View style={{
                width: i === currentIndex ? 28 : 8, height: 8, borderRadius: 4,
                backgroundColor: i === currentIndex ? slide.accent : 'rgba(255,255,255,0.18)',
              }}/>
            </TouchableOpacity>
          ))}
        </View>

        {/* Primary CTA — vibe-colored per slide */}
        <TouchableOpacity
          onPress={handleNext}
          style={{
            backgroundColor: slide.accent,
            borderRadius: 14,
            paddingVertical: 17,
            alignItems: 'center',
            marginBottom: isLast ? 0 : 12,
            shadowColor: slide.accent, shadowOpacity: 0.35,
            shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
          }}
        >
          <Text style={{ color: '#fff', fontSize: 17, fontFamily: FONTS.display, letterSpacing: 0.2 }}>
            {isLast ? 'Get Started →' : 'Next'}
          </Text>
        </TouchableOpacity>

        {/* Last-slide sign-in link — opens the auth sheet over Home */}
        {isLast && onSignIn && (
          <TouchableOpacity onPress={onSignIn} accessibilityRole="button" style={{ alignItems: 'center', paddingVertical: 14 }}>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, fontFamily: FONTS.body }}>
              Already have an account? <Text style={{ color: slide.accent }}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </View>
  );
}
