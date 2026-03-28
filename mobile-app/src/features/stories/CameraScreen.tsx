// ─────────────────────────────────────────────────────────────────────
// Wugi — CameraScreen
// Instagram-mirrored camera UX: tap camera icon → full screen live camera
// Real expo-camera integration is the next step after this placeholder
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, Image, TouchableOpacity,
  SafeAreaView, Animated, StyleSheet,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import type { Theme } from '../../constants/colors';

type Props = {
  onClose: () => void;
  theme: Theme;
};

export function CameraScreen({ onClose, theme }: Props) {
  const [captured,    setCaptured]    = useState<string | null>(null);
  const [flashOn,     setFlashOn]     = useState(false);
  const [frontCamera, setFrontCamera] = useState(false);
  const [recording,   setRecording]   = useState(false);
  const recordAnim = useRef(new Animated.Value(1)).current;
  const holdTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (recording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(recordAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
          Animated.timing(recordAnim, { toValue: 1,    duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      recordAnim.setValue(1);
    }
  }, [recording]);

  const handleShutterPress = () => {
    const seed = Math.floor(Math.random() * 1000);
    setCaptured(`https://picsum.photos/seed/${seed}/400/700`);
  };

  const handleShutterLongPress = () => {
    setRecording(true);
    holdTimer.current = setTimeout(() => {
      setRecording(false);
      const seed = Math.floor(Math.random() * 1000);
      setCaptured(`https://picsum.photos/seed/${seed}/400/700`);
    }, 15000);
  };

  const handleShutterRelease = () => {
    if (recording) {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      setRecording(false);
      const seed = Math.floor(Math.random() * 1000);
      setCaptured(`https://picsum.photos/seed/${seed}/400/700`);
    }
  };

  const handleDiscard = () => {
    setCaptured(null);
    setRecording(false);
  };

  const handleShareToStory = () => {
    // TODO: upload to Firebase Storage + create story document
    onClose();
  };

  // ── Preview screen ───────────────────────────────────────────────────
  if (captured) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <Image source={{ uri: captured }} style={StyleSheet.absoluteFillObject} resizeMode="cover"/>

        <SafeAreaView style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 }}>
          <TouchableOpacity onPress={handleDiscard} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M18 6L6 18M6 6l12 12" stroke="#fff" strokeWidth={2.5} strokeLinecap="round"/>
            </Svg>
          </TouchableOpacity>
          <TouchableOpacity style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>Aa</Text>
          </TouchableOpacity>
        </SafeAreaView>

        {/* Venue tag */}
        <View style={{ position: 'absolute', bottom: 120, left: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
              <Path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke="#2a7a5a" strokeWidth={2}/>
              <Circle cx="12" cy="9" r="2.5" stroke="#2a7a5a" strokeWidth={2}/>
            </Svg>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>SkyLounge ATL</Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>· Verified ✓</Text>
          </View>
        </View>

        {/* Share button */}
        <View style={{ position: 'absolute', bottom: 40, left: 16, right: 16 }}>
          <TouchableOpacity
            onPress={handleShareToStory}
            style={{ backgroundColor: '#fff', borderRadius: 14, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Text style={{ color: '#000', fontSize: 16, fontWeight: '900' }}>Share to Story</Text>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M5 12h14M12 5l7 7-7 7" stroke="#000" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Live viewfinder ──────────────────────────────────────────────────
  // TODO: Replace Image with expo-camera CameraView component
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Image source={{ uri: 'https://picsum.photos/seed/camera/400/800' }} style={StyleSheet.absoluteFillObject} resizeMode="cover"/>
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.2)' }}/>

      {/* Top controls */}
      <SafeAreaView style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 }}>
        <TouchableOpacity onPress={onClose} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path d="M18 6L6 18M6 6l12 12" stroke="#fff" strokeWidth={2.5} strokeLinecap="round"/>
          </Svg>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setFlashOn(f => !f)} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke={flashOn ? '#FFD700' : '#fff'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill={flashOn ? '#FFD700' : 'none'}/>
          </Svg>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setFrontCamera(f => !f)} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path d="M1 4v6h6M23 20v-6h-6" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
            <Path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
          </Svg>
        </TouchableOpacity>
      </SafeAreaView>

      {/* Recording indicator */}
      {recording && (
        <View style={{ position: 'absolute', top: 100, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#e74c3c' }}/>
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Recording</Text>
        </View>
      )}

      {/* Bottom controls */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 50, paddingHorizontal: 20 }}>
        {/* Mode selector */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, marginBottom: 28 }}>
          {['Story', 'Post', 'Reel'].map(mode => (
            <TouchableOpacity key={mode}>
              <Text style={{ color: mode === 'Story' ? '#fff' : 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: mode === 'Story' ? '800' : '500', letterSpacing: 0.5 }}>
                {mode.toUpperCase()}
              </Text>
              {mode === 'Story' && <View style={{ height: 2, backgroundColor: '#fff', borderRadius: 1, marginTop: 3 }}/>}
            </TouchableOpacity>
          ))}
        </View>

        {/* Shutter row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity style={{ width: 50, height: 50, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' }}>
            <Image source={{ uri: 'https://picsum.photos/seed/gallery/50/50' }} style={{ width: 50, height: 50 }}/>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleShutterPress}
            onLongPress={handleShutterLongPress}
            onPressOut={handleShutterRelease}
            activeOpacity={0.8}
          >
            <Animated.View style={{ transform: [{ scale: recordAnim }] }}>
              <View style={{ width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: recording ? 40 : 60, height: recording ? 40 : 60, borderRadius: recording ? 8 : 30, backgroundColor: '#fff' }}/>
              </View>
            </Animated.View>
          </TouchableOpacity>

          <View style={{ width: 50 }}/>
        </View>
      </View>
    </View>
  );
}
