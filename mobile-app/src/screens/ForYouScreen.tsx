// ─────────────────────────────────────────────────────────────────────
// Wugi — ForYouScreen
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef } from 'react';
import {
  View, Text, Image, TouchableOpacity, SafeAreaView,
  Animated, PanResponder, StyleSheet, Dimensions,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Video, ResizeMode } from 'expo-av';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, ForYouCard, FavoriteItem } from '../types';
import { FOR_YOU_CARDS } from '../constants/mockData';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── ForYouCard component ──────────────────────────────────────────────
function ForYouCardComponent({ card, onSwipeLeft, onSwipeRight, onSwipeUp, onTap, isTop }: {
  card: ForYouCard;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onSwipeUp: () => void;
  onTap: () => void;
  isTop: boolean;
}) {
  const position     = useRef(new Animated.ValueXY()).current;
  const [isMuted, setIsMuted] = useState(true);
  const swipeStarted = useRef(false);

  const rotate      = position.x.interpolate({ inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2], outputRange: ['-8deg', '0deg', '8deg'], extrapolate: 'clamp' });
  const likeOpacity = position.x.interpolate({ inputRange: [0, 80],  outputRange: [0, 1], extrapolate: 'clamp' });
  const passOpacity = position.x.interpolate({ inputRange: [-80, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  const resetPosition = () => Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.sqrt(g.dx * g.dx + g.dy * g.dy) > 8,
    onPanResponderGrant: () => { swipeStarted.current = false; },
    onPanResponderMove: (_, g) => {
      if (Math.sqrt(g.dx * g.dx + g.dy * g.dy) > 10) swipeStarted.current = true;
      position.setValue({ x: g.dx, y: g.dy * 0.4 });
    },
    onPanResponderRelease: (_, g) => {
      const dist = Math.sqrt(g.dx * g.dx + g.dy * g.dy);
      if (!swipeStarted.current || dist < 8) { resetPosition(); onTap(); return; }
      if (g.dy < -80 && Math.abs(g.dy) > Math.abs(g.dx)) {
        Animated.timing(position, { toValue: { x: 0, y: -SCREEN_HEIGHT }, duration: 280, useNativeDriver: false }).start(onSwipeUp);
        return;
      }
      if (g.dx > 100) { Animated.timing(position, { toValue: { x: SCREEN_WIDTH + 100, y: 0 }, duration: 280, useNativeDriver: false }).start(onSwipeRight); return; }
      if (g.dx < -100) { Animated.timing(position, { toValue: { x: -SCREEN_WIDTH - 100, y: 0 }, duration: 280, useNativeDriver: false }).start(onSwipeLeft); return; }
      resetPosition();
    },
  })).current;

  return (
    <Animated.View
      {...(isTop ? panResponder.panHandlers : {})}
      style={{
        position: 'absolute',
        width: SCREEN_WIDTH - 32,
        height: SCREEN_HEIGHT * 0.65,
        borderRadius: 20,
        overflow: 'hidden',
        transform: isTop ? [{ translateX: position.x }, { translateY: position.y }, { rotate }] : [{ scale: 0.93 }],
        opacity: isTop ? 1 : 0.7,
        shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: isTop ? 10 : 5,
      }}
    >
      {card.type === 'video' ? (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <Video source={{ uri: card.videoUri || card.image }} style={{ width: '100%', height: '100%' }} resizeMode={ResizeMode.COVER} shouldPlay={isTop} isLooping isMuted={isMuted}/>
          <TouchableOpacity onPress={() => setIsMuted(p => !p)} style={{ position: 'absolute', bottom: 80, right: 14, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              {isMuted
                ? (<><Path d="M11 5L6 9H2v6h4l5 4V5z" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Path d="M23 9l-6 6M17 9l6 6" stroke="#fff" strokeWidth={1.8} strokeLinecap="round"/></>)
                : (<><Path d="M11 5L6 9H2v6h4l5 4V5z" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" stroke="#fff" strokeWidth={1.8} strokeLinecap="round"/></>)
              }
            </Svg>
          </TouchableOpacity>
        </View>
      ) : (
        <Image source={{ uri: card.image }} style={StyleSheet.absoluteFillObject} resizeMode="cover"/>
      )}

      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.2)' }}/>
      {isTop && <Animated.View style={{ position: 'absolute', top: 40, left: 20, opacity: likeOpacity, transform: [{ rotate: '-15deg' }] }}><View style={{ borderWidth: 3, borderColor: '#2a7a5a', borderRadius: 8, padding: 8 }}><Text style={{ color: '#2a7a5a', fontSize: 28, fontWeight: '900', letterSpacing: 2 }}>SAVE</Text></View></Animated.View>}
      {isTop && <Animated.View style={{ position: 'absolute', top: 40, right: 20, opacity: passOpacity, transform: [{ rotate: '15deg' }] }}><View style={{ borderWidth: 3, borderColor: '#e74c3c', borderRadius: 8, padding: 8 }}><Text style={{ color: '#e74c3c', fontSize: 28, fontWeight: '900', letterSpacing: 2 }}>PASS</Text></View></Animated.View>}

      <View style={{ position: 'absolute', top: 16, right: 16, backgroundColor: card.tagColor, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 }}>
        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>{card.tag}</Text>
      </View>
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20 }}>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 }}>{card.title}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>{card.subtitle}</Text>
        {(card.type === 'event' || card.type === 'venue') && card.data && (
          <View style={{ marginTop: 10 }}>
            <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Tap to view →</Text>
            </View>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// ── ForYouScreen ──────────────────────────────────────────────────────
type Props = {
  theme: Theme;
  onEventPress: (event: EventData) => void;
  onVenuePress: (venue: VenueData) => void;
  onFavoriteToggle: (item: FavoriteItem) => void;
};

export function ForYouScreen({ theme, onEventPress, onVenuePress, onFavoriteToggle }: Props) {
  const [cards, setCards]           = useState([...FOR_YOU_CARDS]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDone, setIsDone]         = useState(false);

  const advance = () => {
    if (currentIndex >= cards.length - 1) setIsDone(true);
    else setCurrentIndex(p => p + 1);
  };

  const handleSwipeRight = () => {
    const card = cards[currentIndex];
    if (card.data) {
      if (card.type === 'event') onFavoriteToggle({ id: card.id, type: 'event', title: card.title, subtitle: card.subtitle, image: card.image, read: false, data: card.data as EventData });
      else if (card.type === 'venue') onFavoriteToggle({ id: card.id, type: 'venue', title: card.title, subtitle: card.subtitle, image: card.image, read: false, data: card.data as VenueData });
    }
    advance();
  };

  const handleSwipeLeft = () => advance();

  const handleSwipeUp = () => {
    const card = cards[currentIndex];
    const newCards = [...cards];
    newCards.splice(currentIndex, 1);
    const insertAt = Math.min(currentIndex + 3, newCards.length);
    newCards.splice(insertAt, 0, card);
    setCards(newCards);
    if (currentIndex >= newCards.length) setIsDone(true);
  };

  const handleTap = () => {
    const card = cards[currentIndex];
    if (card.type === 'event' && card.data) onEventPress(card.data as EventData);
    else if (card.type === 'venue' && card.data) onVenuePress(card.data as VenueData);
  };

  if (isDone) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🎉</Text>
        <Text style={{ color: theme.text, fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 8 }}>You're all caught up!</Text>
        <Text style={{ color: theme.subtext, fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 32 }}>Check back later for more Atlanta nightlife and dining recommendations.</Text>
        <TouchableOpacity style={{ backgroundColor: theme.accent, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 }} onPress={() => { setCurrentIndex(0); setIsDone(false); setCards([...FOR_YOU_CARDS]); }}>
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Start Over</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentCard = cards[currentIndex];
  const nextCard    = cards[currentIndex + 1];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ paddingHorizontal: 20, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 36 }}/>
          <Text style={{ color: theme.accent, fontSize: 26, fontWeight: '900', letterSpacing: -1 }}>for you</Text>
          <View style={{ width: 36 }}/>
        </View>
        <View style={{ height: 3, backgroundColor: theme.divider, borderRadius: 2, marginTop: 10 }}>
          <View style={{ height: 3, backgroundColor: theme.accent, borderRadius: 2, width: `${(currentIndex / cards.length) * 100}%` as any }}/>
        </View>
        <Text style={{ color: theme.subtext, fontSize: 11, textAlign: 'center', marginTop: 4 }}>{currentIndex + 1} of {cards.length}</Text>
      </SafeAreaView>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 20 }}>
        {nextCard && <ForYouCardComponent key={nextCard.id + '_next'} card={nextCard} isTop={false} onSwipeLeft={() => {}} onSwipeRight={() => {}} onSwipeUp={() => {}} onTap={() => {}}/>}
        {currentCard && <ForYouCardComponent key={currentCard.id} card={currentCard} isTop={true} onSwipeLeft={handleSwipeLeft} onSwipeRight={handleSwipeRight} onSwipeUp={handleSwipeUp} onTap={handleTap}/>}
      </View>

      <View style={{ alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ color: theme.subtext, fontSize: 11 }}>↑ Swipe up to see later</Text>
      </View>

      <SafeAreaView style={{ paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 40 }}>
          <TouchableOpacity onPress={handleSwipeLeft} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#e74c3c', alignItems: 'center', justifyContent: 'center', shadowColor: '#e74c3c', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}>
            <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
              <Path d="M18 6L6 18M6 6l12 12" stroke="#fff" strokeWidth={2.5} strokeLinecap="round"/>
            </Svg>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSwipeRight} style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', shadowColor: theme.accent, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
            <Svg width={28} height={28} viewBox="0 0 24 24">
              <Path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" fill="#fff"/>
            </Svg>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}
