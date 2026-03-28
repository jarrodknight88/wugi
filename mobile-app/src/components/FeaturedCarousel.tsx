// ─────────────────────────────────────────────────────────────────────
// Wugi — FeaturedCarousel Component
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, Image, FlatList, TouchableOpacity,
  StyleSheet, Dimensions,
} from 'react-native';
import type { Theme } from '../constants/colors';
import type { EventData } from '../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 32;
const CARD_GAP   = 12;

type Props = {
  theme: Theme;
  onEventPress: (event: EventData) => void;
  events: EventData[];
};

export function FeaturedCarousel({ theme, onEventPress, events }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setActiveIndex(prev => {
        const next = (prev + 1) % events.length;
        flatListRef.current?.scrollToOffset({
          offset: next * (CARD_WIDTH + CARD_GAP),
          animated: true,
        });
        return next;
      });
    }, 5000);
  };

  useEffect(() => {
    if (events.length === 0) return;
    startTimer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [events.length]);

  const onScroll = (e: any) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / (CARD_WIDTH + CARD_GAP));
    if (index !== activeIndex) {
      setActiveIndex(index);
      if (timerRef.current) clearInterval(timerRef.current);
      startTimer();
    }
  };

  const goTo = (i: number) => {
    flatListRef.current?.scrollToOffset({ offset: i * (CARD_WIDTH + CARD_GAP), animated: true });
    setActiveIndex(i);
    if (timerRef.current) clearInterval(timerRef.current);
    startTimer();
  };

  if (events.length === 0) return null;

  return (
    <View>
      <FlatList
        ref={flatListRef}
        data={events}
        keyExtractor={item => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        snapToInterval={CARD_WIDTH + CARD_GAP}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 16, gap: CARD_GAP }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={{ width: CARD_WIDTH, height: 260, borderRadius: 16, overflow: 'hidden' }}
            onPress={() => onEventPress(item)}
            activeOpacity={0.92}
          >
            <Image
              source={{ uri: item.media[0]?.uri || 'https://picsum.photos/seed/fallback/800/600' }}
              style={StyleSheet.absoluteFillObject}
              resizeMode="cover"
            />
            <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' }}/>
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16 }}>
              <View style={{
                alignSelf: 'flex-start',
                backgroundColor: theme.accent,
                borderRadius: 6,
                paddingHorizontal: 8,
                paddingVertical: 3,
                marginBottom: 8,
              }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>
                  {item.date} · {item.time}
                </Text>
              </View>
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.3, marginBottom: 2 }}>
                {item.title}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>
                {item.venue}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />

      {/* Dot indicators */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 }}>
        {events.map((_, i) => (
          <TouchableOpacity key={i} onPress={() => goTo(i)}>
            <View style={{
              width: i === activeIndex ? 18 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === activeIndex ? theme.accent : theme.subtext + '55',
            }}/>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
