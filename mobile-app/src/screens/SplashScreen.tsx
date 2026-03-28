// ─────────────────────────────────────────────────────────────────────
// Wugi — SplashScreen
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef } from 'react';
import { View, Text, Animated } from 'react-native';

type Props = {
  onFinish: () => void;
};

export function SplashScreen({ onFinish }: Props) {
  const scale         = useRef(new Animated.Value(0.8)).current;
  const opacity       = useRef(new Animated.Value(0)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const dotOpacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 60, friction: 8 }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
      Animated.delay(300),
      Animated.timing(taglineOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(dotOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(1000),
    ]).start(() => onFinish());
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' }}>
      {/* Glow rings */}
      <View style={{ position: 'absolute', width: 320, height: 320, borderRadius: 160, backgroundColor: '#2a7a5a', opacity: 0.08, top: '30%', alignSelf: 'center' }}/>
      <View style={{ position: 'absolute', width: 180, height: 180, borderRadius: 90,  backgroundColor: '#2a7a5a', opacity: 0.06, top: '38%', alignSelf: 'center' }}/>

      {/* Logo */}
      <Animated.View style={{ alignItems: 'center', opacity, transform: [{ scale }] }}>
        <Text style={{ color: '#fff', fontSize: 80, fontWeight: '900', letterSpacing: -5, lineHeight: 80 }}>
          wugi
        </Text>
        <View style={{ width: 48, height: 3, backgroundColor: '#2a7a5a', borderRadius: 2, marginTop: 8 }}/>
      </Animated.View>

      {/* Tagline */}
      <Animated.View style={{ position: 'absolute', bottom: 130, alignItems: 'center', opacity: taglineOpacity }}>
        <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: '600', letterSpacing: 4 }}>
          ATLANTA NIGHTLIFE
        </Text>
      </Animated.View>

      {/* Loading dots */}
      <Animated.View style={{ position: 'absolute', bottom: 52, opacity: dotOpacity }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {[0, 1, 2].map(i => (
            <View key={i} style={{
              width: 5, height: 5, borderRadius: 3,
              backgroundColor: i === 1 ? '#2a7a5a' : 'rgba(255,255,255,0.2)',
            }}/>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}
