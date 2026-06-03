// ─────────────────────────────────────────────────────────────────────
// Wugi — HeartIconBordered
//
// A drop-in wrapper around HeartIcon that adds a thin white outline
// around the heart shape, improving legibility when the colored heart
// sits on top of a busy photo. Stacks two HeartIcons in a relative View:
//   • bottom layer: slightly larger white-filled heart (the outline)
//   • top layer:    original colored heart (filled or stroked)
//
// Built as a wrapper so icons/index.tsx stays untouched (do-not-touch).
// Used on Saved-tab cards/rows where the heart is the primary unsave
// affordance.
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View } from 'react-native';
import { HeartIcon } from './icons';

type Props = {
  color: string;         // colored heart (the unsave/save affordance)
  filled?: boolean;      // matches HeartIcon's filled prop
  size?: number;         // visual size of the colored heart (default 22)
  borderColor?: string;  // outline color (default #fff)
  borderWidth?: number;  // outline thickness in px (default 1.5)
};

export function HeartIconBordered({
  color,
  filled,
  size = 22,
  borderColor = '#ffffff',
  borderWidth = 1.5,
}: Props) {
  // Bottom heart is sized larger by 2× borderWidth so it peeks out
  // evenly around the top heart, producing a uniform stroke. Always
  // filled so the colored heart sits on a solid white silhouette.
  const outlineSize = size + borderWidth * 2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute' }}>
        <HeartIcon color={borderColor} filled size={outlineSize}/>
      </View>
      <HeartIcon color={color} filled={filled} size={size}/>
    </View>
  );
}
