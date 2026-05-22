// ─────────────────────────────────────────────────────────────────────
// Wugi — HeartBurst
// Instagram-style double-tap heart bloom. Imperative API via ref:
//
//   const heart = useRef<HeartBurstHandle>(null);
//   const onDoubleTap = useDoubleTap({ onDoubleTap: () => { heart.current?.burst(); save(); } });
//   <Pressable onPress={onDoubleTap}>
//     <Image …/>
//     <HeartBurst ref={heart}/>
//   </Pressable>
//
// The component overlays the parent (StyleSheet.absoluteFill) and is
// pointerEvents="none" so it never swallows taps. Each burst() call
// resets the animation in case the user double-taps repeatedly.
// ─────────────────────────────────────────────────────────────────────
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export type HeartBurstHandle = {
  burst: () => void;
};

type Props = {
  size?: number;       // heart icon size in px (default 96)
  color?: string;      // heart fill colour (default #ffffff)
};

const HeartBurstInner = forwardRef<HeartBurstHandle, Props>(({ size = 96, color = '#ffffff' }, ref) => {
  const scale   = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const burst = () => {
    scale.setValue(0.4);
    opacity.setValue(0);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 90, useNativeDriver: true }),
        Animated.delay(220),
        Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }),
      ]),
      Animated.spring(scale, {
        toValue: 1.15,
        useNativeDriver: true,
        friction: 4,
        tension: 80,
      }),
    ]).start();
  };

  useImperativeHandle(ref, () => ({ burst }), []);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]}>
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M12 21s-7-4.5-9.5-9C.7 8.6 2.7 5 6 5c2 0 3.3 1 4 2.2C10.7 6 12 5 14 5c3.3 0 5.3 3.6 3.5 7-2.5 4.5-9.5 9-9.5 9z"
            fill={color}
            stroke={color}
            strokeWidth={1}
          />
        </Svg>
      </Animated.View>
    </View>
  );
});
HeartBurstInner.displayName = 'HeartBurst';

export const HeartBurst = HeartBurstInner;
