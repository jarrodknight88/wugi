// ─────────────────────────────────────────────────────────────────────
// Wugi — Skeleton
//
// Shimmer loading primitives. A solid placeholder block with a gradient
// band that sweeps left→right on a loop (expo-linear-gradient + RN's
// built-in Animated — no reanimated dependency). Screens compose these
// into shapes that mirror their real content layout, so structure is
// visible immediately instead of a centered spinner on a blank screen.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, StyleSheet, Easing, ViewStyle, DimensionValue } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Theme } from '../constants/colors';

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

// Base shimmering rectangle. Width/height accept numbers or percentages;
// percentage widths are measured via onLayout so the sweep still spans
// the rendered box exactly.
export function SkeletonBlock({
  theme, width = '100%', height = 14, borderRadius = 6, style,
}: {
  theme: Theme;
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  style?: ViewStyle;
}) {
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const span = Math.max(measuredWidth, 1);
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-span, span] });

  return (
    <View
      onLayout={e => setMeasuredWidth(e.nativeEvent.layout.width)}
      style={[{ width, height, borderRadius, backgroundColor: theme.surface, overflow: 'hidden' }, style]}
    >
      {measuredWidth > 0 && (
        <AnimatedGradient
          colors={[theme.surface, theme.border, theme.surface]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}
        />
      )}
    </View>
  );
}

// Round placeholder — avatars, logo badges, icon circles.
export function SkeletonCircle({ theme, size = 40, style }: { theme: Theme; size?: number; style?: ViewStyle }) {
  return <SkeletonBlock theme={theme} width={size} height={size} borderRadius={size / 2} style={style}/>;
}

// A single line of "text" — shorthand for a short rounded bar.
export function SkeletonLine({
  theme, width = '100%', height = 12, style,
}: {
  theme: Theme; width?: DimensionValue; height?: number; style?: ViewStyle;
}) {
  return <SkeletonBlock theme={theme} width={width} height={height} borderRadius={4} style={style}/>;
}
