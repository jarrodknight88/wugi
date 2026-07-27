// ─────────────────────────────────────────────────────────────────────
// TopBar — venue name, settings control, online/offline indicator
// Standalone component only — not wired into any screen in this task.
// Status-bar offset via expo-constants (no react-native-safe-area-context
// in this codebase). Per docs/DOOR-REDESIGN-SPEC.md §6.
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Constants from 'expo-constants';
import { COLORS } from '../constants/colors';

interface Props {
  venueName: string;
  online: boolean;
  onSettingsPress: () => void;
}

export default function TopBar({ venueName, online, onSettingsPress }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.venueName} numberOfLines={1}>{venueName}</Text>

        <View style={styles.right}>
          <View
            style={styles.statusPill}
            accessibilityLabel={online ? 'Online' : 'Offline — scans queued'}>
            <Text style={[styles.statusIcon, !online && styles.statusIconOffline]}>
              {/* TODO: swap for a proper wifi glyph (expo-av/expo-haptics not yet approved; using text glyph for now) */}
              {online ? '●' : '○'}
            </Text>
            {!online && <Text style={styles.statusText}>Offline — scans queued</Text>}
          </View>

          <TouchableOpacity onPress={onSettingsPress} activeOpacity={0.6} style={styles.settingsButton}>
            <Text style={styles.settingsIcon}>{'⚙'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.bg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
    paddingTop: Constants.statusBarHeight,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  venueName: { flex: 1, fontSize: 16, fontWeight: '700', color: COLORS.text, marginRight: 12 },
  right:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  statusIcon:        { fontSize: 10, color: COLORS.go },
  statusIconOffline: { color: COLORS.warn },
  statusText:        { fontSize: 12, fontWeight: '600', color: COLORS.warn },
  settingsButton:    { padding: 4 },
  settingsIcon:      { fontSize: 18, color: COLORS.subtext },
});
