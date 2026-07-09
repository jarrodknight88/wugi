// ─────────────────────────────────────────────────────────────────────
// Wugi — StateViews
//
// Honest, designed error/empty states. Replaces the old pattern of
// silently falling back to mock data when Firestore fails or returns
// nothing. Both components are compact: render inline inside a section,
// or wrap in a { flex: 1, justifyContent: 'center' } View for full-screen.
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Svg, { Path, Line, Circle } from 'react-native-svg';
import type { Theme } from '../constants/colors';
import { FONTS } from '../constants/fonts';

// Minimal wifi-off glyph for the error state.
function WifiOffIcon({ color, size = 24 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12.55a11 11 0 0114.08 0" stroke={color} strokeWidth={1.8} strokeLinecap="round"/>
      <Path d="M8.53 16.11a6 6 0 016.95 0" stroke={color} strokeWidth={1.8} strokeLinecap="round"/>
      <Line x1={12} y1={20} x2={12.01} y2={20} stroke={color} strokeWidth={2.4} strokeLinecap="round"/>
      <Line x1={3} y1={3} x2={21} y2={21} stroke={color} strokeWidth={1.8} strokeLinecap="round"/>
    </Svg>
  );
}

// Minimal moon glyph for the empty state — "nothing on right now".
function MoonIcon({ color, size = 24 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
        stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      />
      <Circle cx={17.5} cy={6.5} r={0.6} fill={color}/>
    </Svg>
  );
}

// Shared icon badge — theme.card circle with a 1px border, matching the
// MapPlaceholder treatment on Discover.
function IconBadge({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return (
    <View style={{
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: theme.card,
      borderWidth: 1, borderColor: theme.border,
      alignItems: 'center', justifyContent: 'center',
      marginBottom: 16,
    }}>
      {children}
    </View>
  );
}

// ── ErrorState ────────────────────────────────────────────────────────
// Centered block: wifi-off icon, title, message, solid accent retry button.
export function ErrorState({
  theme,
  title = "Couldn't load this",
  message = 'Check your connection and try again.',
  onRetry,
}: {
  theme: Theme;
  title?: string;
  message?: string;
  onRetry: () => void;
}) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 32 }}>
      <IconBadge theme={theme}>
        <WifiOffIcon color={theme.subtext}/>
      </IconBadge>
      <Text style={{
        color: theme.text, fontSize: 17, fontFamily: FONTS.display,
        letterSpacing: -0.3, marginBottom: 6, textAlign: 'center',
      }}>
        {title}
      </Text>
      <Text style={{
        color: theme.subtext, fontSize: 13, fontFamily: FONTS.body,
        lineHeight: 19, textAlign: 'center', marginBottom: 20,
      }}>
        {message}
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={onRetry}
        activeOpacity={0.85}
        style={{
          backgroundColor: theme.accent,
          borderRadius: 12,
          paddingVertical: 14,
          paddingHorizontal: 28,
          alignSelf: 'center',
        }}
      >
        <Text style={{ color: theme.onAccent, fontSize: 14, fontFamily: FONTS.medium }}>
          Try again
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────
// Same layout as ErrorState, with an optional outline action button.
export function EmptyState({
  theme,
  title,
  message,
  actionLabel,
  onAction,
}: {
  theme: Theme;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 32 }}>
      <IconBadge theme={theme}>
        <MoonIcon color={theme.subtext}/>
      </IconBadge>
      <Text style={{
        color: theme.text, fontSize: 17, fontFamily: FONTS.display,
        letterSpacing: -0.3, marginBottom: 6, textAlign: 'center',
      }}>
        {title}
      </Text>
      <Text style={{
        color: theme.subtext, fontSize: 13, fontFamily: FONTS.body,
        lineHeight: 19, textAlign: 'center',
        marginBottom: actionLabel && onAction ? 20 : 0,
      }}>
        {message}
      </Text>
      {actionLabel && onAction && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onAction}
          activeOpacity={0.85}
          style={{
            backgroundColor: theme.card,
            borderWidth: 1, borderColor: theme.border,
            borderRadius: 12,
            paddingVertical: 14,
            paddingHorizontal: 28,
            alignSelf: 'center',
          }}
        >
          <Text style={{ color: theme.text, fontSize: 14, fontFamily: FONTS.medium }}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
