// ─────────────────────────────────────────────────────────────────────
// Wugi — StoryViewer
// Full screen story viewer with progress bars, tap zones, ad CTA
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, Image, TouchableOpacity,
  SafeAreaView, Animated, StyleSheet,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { StoryGroup } from '../../types';

const STORY_DURATION = 5000;

type Props = {
  groups: StoryGroup[];
  startIndex: number;
  onClose: () => void;
};

export function StoryViewer({ groups, startIndex, onClose }: Props) {
  const [groupIndex, setGroupIndex] = useState(startIndex);
  const [storyIndex, setStoryIndex] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const progressRef  = useRef<Animated.CompositeAnimation | null>(null);

  const group = groups[groupIndex];
  const story = group?.stories[storyIndex];

  const advance = useCallback(() => {
    if (storyIndex < group.stories.length - 1) {
      setStoryIndex(i => i + 1);
    } else if (groupIndex < groups.length - 1) {
      setGroupIndex(i => i + 1);
      setStoryIndex(0);
    } else {
      onClose();
    }
  }, [storyIndex, groupIndex, group, groups, onClose]);

  const startProgress = useCallback(() => {
    progressAnim.setValue(0);
    progressRef.current = Animated.timing(progressAnim, {
      toValue: 1,
      duration: STORY_DURATION,
      useNativeDriver: false,
    });
    progressRef.current.start(({ finished }) => {
      if (finished) advance();
    });
  }, [groupIndex, storyIndex, advance]);

  useEffect(() => {
    startProgress();
    return () => progressRef.current?.stop();
  }, [groupIndex, storyIndex]);

  const goBack = () => {
    if (storyIndex > 0) setStoryIndex(i => i - 1);
    else if (groupIndex > 0) { setGroupIndex(i => i - 1); setStoryIndex(0); }
  };

  const handleTap = (side: 'left' | 'right') => {
    progressRef.current?.stop();
    if (side === 'right') advance();
    else goBack();
  };

  if (!group || !story) return null;

  return (
    <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 999 }}>
      <Image source={{ uri: story.mediaUri }} style={StyleSheet.absoluteFillObject} resizeMode="cover"/>
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.15)' }}/>

      {/* Progress bars */}
      <SafeAreaView style={{ paddingHorizontal: 8, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', gap: 3, marginBottom: 10 }}>
          {group.stories.map((_, i) => (
            <View key={i} style={{ flex: 1, height: 2.5, backgroundColor: 'rgba(255,255,255,0.35)', borderRadius: 2, overflow: 'hidden' }}>
              <Animated.View style={{
                height: '100%',
                backgroundColor: '#fff',
                borderRadius: 2,
                width: i < storyIndex
                  ? '100%'
                  : i === storyIndex
                  ? progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                  : '0%',
              }}/>
            </View>
          ))}
        </View>

        {/* Story header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Image source={{ uri: group.venueImage }} style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: '#fff' }}/>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>{group.venueName}</Text>
                {group.isAd && (
                  <View style={{ backgroundColor: 'rgba(255,215,0,0.3)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                    <Text style={{ color: '#FFD700', fontSize: 9, fontWeight: '700' }}>SPONSORED</Text>
                  </View>
                )}
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>
                {story.username}{story.timeAgo ? ` · ${story.timeAgo}` : ''}{story.locationVerified ? ' 📍' : ''}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M18 6L6 18M6 6l12 12" stroke="#fff" strokeWidth={2.5} strokeLinecap="round"/>
            </Svg>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Tap zones — left=back, right=next */}
      <View style={{ ...StyleSheet.absoluteFillObject, flexDirection: 'row', marginTop: 80 }}>
        <TouchableOpacity style={{ flex: 1 }} onPress={() => handleTap('left')} activeOpacity={1}/>
        <TouchableOpacity style={{ flex: 2 }} onPress={() => handleTap('right')} activeOpacity={1}/>
      </View>

      {/* Ad CTA */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 40, paddingHorizontal: 16 }}>
        {group.isAd && group.ctaLabel && (
          <TouchableOpacity style={{ backgroundColor: '#fff', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: '#000', fontSize: 14, fontWeight: '800' }}>{group.ctaLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
