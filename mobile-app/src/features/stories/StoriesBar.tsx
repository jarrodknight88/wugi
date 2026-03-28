// ─────────────────────────────────────────────────────────────────────
// Wugi — StoriesBar
// Horizontal venue avatar bar with unseen/seen/ad ring states
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../../constants/colors';
import type { StoryGroup } from '../../types';
import { MOCK_STORIES } from '../../constants/mockData';
import { StoryViewer } from './StoryViewer';

type Props = {
  theme: Theme;
  onAddStory: () => void;
};

export function StoriesBar({ theme, onAddStory }: Props) {
  const [stories,      setStories]      = useState<StoryGroup[]>(MOCK_STORIES);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);

  const openStory = (index: number) => {
    setViewingIndex(index);
    setStories(prev => prev.map((s, i) => i === index ? { ...s, seen: true } : s));
  };

  return (
    <>
      {/* Full screen story viewer overlay */}
      {viewingIndex !== null && (
        <StoryViewer
          groups={stories}
          startIndex={viewingIndex}
          onClose={() => setViewingIndex(null)}
        />
      )}

      <View style={{ borderBottomWidth: 1, borderBottomColor: theme.divider }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12, gap: 14 }}
        >
          {/* Add your story */}
          <TouchableOpacity onPress={onAddStory} style={{ alignItems: 'center', gap: 5 }}>
            <View style={{
              width: 62, height: 62, borderRadius: 31,
              backgroundColor: theme.card,
              borderWidth: 2, borderColor: theme.accent,
              borderStyle: 'dashed',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                <Path d="M12 5v14M5 12h14" stroke={theme.accent} strokeWidth={2.5} strokeLinecap="round"/>
              </Svg>
            </View>
            <Text style={{ color: theme.subtext, fontSize: 10, fontWeight: '600', width: 62, textAlign: 'center' }} numberOfLines={1}>
              Your Story
            </Text>
          </TouchableOpacity>

          {/* Venue rings */}
          {stories.map((group, index) => (
            <TouchableOpacity key={group.id} onPress={() => openStory(index)} style={{ alignItems: 'center', gap: 5 }}>
              <View style={{
                width: 66, height: 66, borderRadius: 33, padding: 2.5,
                backgroundColor: group.isAd ? '#FFD700' : group.seen ? theme.border : theme.accent,
              }}>
                <Image
                  source={{ uri: group.venueImage }}
                  style={{ width: '100%', height: '100%', borderRadius: 30, borderWidth: 2.5, borderColor: theme.bg }}
                  resizeMode="cover"
                />
                {group.isAd && (
                  <View style={{ position: 'absolute', bottom: 0, right: 0, backgroundColor: '#FFD700', borderRadius: 8, paddingHorizontal: 4, paddingVertical: 1 }}>
                    <Text style={{ color: '#000', fontSize: 7, fontWeight: '900' }}>AD</Text>
                  </View>
                )}
              </View>
              <Text
                style={{ color: group.seen ? theme.subtext : theme.text, fontSize: 10, fontWeight: group.seen ? '400' : '700', width: 62, textAlign: 'center' }}
                numberOfLines={1}
              >
                {group.venueName}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </>
  );
}
