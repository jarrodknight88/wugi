// ─────────────────────────────────────────────────────────────────────
// Wugi — PhotoViewer Screen
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, Image, TouchableOpacity, ScrollView,
  SafeAreaView, Animated, PanResponder, StyleSheet, Dimensions,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Theme } from '../constants/colors';
import type { GalleryPhoto } from '../types';
import { BackIcon, ShareIcon, HeartIcon, InfoIcon, CartIcon, FlagIcon } from '../components/icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type Props = {
  photos: GalleryPhoto[];
  initialIndex: number;
  galleryTitle: string;
  venue: string;
  date: string;
  onBack: () => void;
  theme: Theme;
};

export function PhotoViewer({ photos, initialIndex, galleryTitle, venue, date, onBack, theme }: Props) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [showUI, setShowUI]   = useState(true);
  const [liked, setLiked]     = useState<Record<string, boolean>>({});
  const [showInfo, setShowInfo] = useState(false);

  const scrollRef    = useRef<ScrollView>(null);
  const uiOpacity    = useRef(new Animated.Value(1)).current;
  const translateY   = useRef(new Animated.Value(0)).current;
  const likeScale    = useRef(new Animated.Value(1)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const lastTap      = useRef<number>(0);

  const photo = photos[currentIndex];

  useEffect(() => {
    if (initialIndex > 0) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({ x: initialIndex * SCREEN_WIDTH, animated: false });
      }, 50);
    }
  }, []);

  const toggleUI = () => {
    Animated.timing(uiOpacity, { toValue: showUI ? 0 : 1, duration: 200, useNativeDriver: true }).start();
    setShowUI(p => !p);
  };

  const animateHeart = () => {
    heartOpacity.setValue(0);
    likeScale.setValue(0.5);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(heartOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
        Animated.spring(likeScale, { toValue: 1.4, useNativeDriver: true }),
      ]),
      Animated.spring(likeScale, { toValue: 1, useNativeDriver: true }),
      Animated.delay(500),
      Animated.timing(heartOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  const handleShare = async () => {
    try {
      const fileName = `wugi_${photo.id}.jpg`;
      const localUri = (FileSystem.cacheDirectory ?? '') + fileName;
      await FileSystem.downloadAsync(photo.uri, localUri);
      await Sharing.shareAsync(localUri, { mimeType: 'image/jpeg', dialogTitle: galleryTitle, UTI: 'public.jpeg' });
    } catch (e) {
      console.log('Share error:', e);
    }
  };

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > Math.abs(g.dx) * 2 && Math.abs(g.dy) > 10,
    onPanResponderMove: (_, g) => { if (g.dy > 0) translateY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 80) {
        Animated.timing(translateY, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }).start(onBack);
      } else {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  const handleTap = () => {
    const now = Date.now();
    const isDouble = now - lastTap.current < 300;
    lastTap.current = now;
    if (isDouble) {
      const isLiked = liked[photo.id];
      setLiked(p => ({ ...p, [photo.id]: !isLiked }));
      if (!isLiked) animateHeart();
    } else {
      setTimeout(() => {
        if (Date.now() - lastTap.current >= 280) toggleUI();
      }, 300);
    }
  };

  const onScrollEnd = (e: any) =>
    setCurrentIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH));

  const scrollTo = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
    setCurrentIndex(index);
  };

  return (
    <Animated.View
      style={{ flex: 1, backgroundColor: '#000', transform: [{ translateY }] }}
      {...panResponder.panHandlers}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {photos.map(item => (
          <TouchableOpacity
            key={item.id}
            activeOpacity={1}
            onPress={handleTap}
            style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT, justifyContent: 'center' }}
          >
            <Image
              source={{ uri: item.uri }}
              style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.85 }}
              resizeMode="contain"
            />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Double-tap heart */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute', alignSelf: 'center',
          top: SCREEN_HEIGHT / 2 - 44,
          opacity: heartOpacity, transform: [{ scale: likeScale }],
        }}
      >
        <HeartIcon color="#fff" filled/>
      </Animated.View>

      {/* UI overlay */}
      <Animated.View
        style={{ ...StyleSheet.absoluteFillObject, opacity: uiOpacity }}
        pointerEvents={showUI ? 'box-none' : 'none'}
      >
        {/* Prev arrow */}
        {currentIndex > 0 && (
          <TouchableOpacity
            onPress={() => scrollTo(currentIndex - 1)}
            style={{ position: 'absolute', left: 10, top: '50%', marginTop: -22, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M15 18l-6-6 6-6" stroke="rgba(255,255,255,0.5)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </TouchableOpacity>
        )}
        {/* Next arrow */}
        {currentIndex < photos.length - 1 && (
          <TouchableOpacity
            onPress={() => scrollTo(currentIndex + 1)}
            style={{ position: 'absolute', right: 10, top: '50%', marginTop: -22, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M9 18l6-6-6-6" stroke="rgba(255,255,255,0.5)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </TouchableOpacity>
        )}

        {/* Top bar */}
        <SafeAreaView style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 }}>
          <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }} onPress={onBack}>
            <BackIcon color="#fff"/>
          </TouchableOpacity>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
            {currentIndex + 1} / {photos.length}
          </Text>
          <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }} onPress={handleShare}>
            <ShareIcon color="#fff"/>
          </TouchableOpacity>
        </SafeAreaView>

        {/* Bottom bar */}
        <SafeAreaView style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          {showInfo && (
            <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 14, padding: 14 }}>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 2 }}>{galleryTitle}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 2 }}>{venue}</Text>
              <Text style={{ color: theme.accent, fontSize: 12 }}>{date}</Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 24, paddingBottom: 32, paddingTop: 16, backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <TouchableOpacity style={{ alignItems: 'center', gap: 4 }} onPress={() => { const isLiked = liked[photo.id]; setLiked(p => ({ ...p, [photo.id]: !isLiked })); if (!isLiked) animateHeart(); }}>
              <HeartIcon color={liked[photo.id] ? '#e74c3c' : '#fff'} filled={liked[photo.id]}/>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>Like</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', gap: 4 }} onPress={handleShare}>
              <ShareIcon color="#fff"/>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', gap: 4 }} onPress={() => setShowInfo(!showInfo)}>
              <InfoIcon color={showInfo ? theme.accent : '#fff'}/>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>Info</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', gap: 4 }}>
              <CartIcon color="#fff"/>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>Buy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', gap: 4 }}>
              <FlagIcon color="#fff"/>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>Report</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Animated.View>
    </Animated.View>
  );
}
