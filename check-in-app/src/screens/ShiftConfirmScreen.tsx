// ─────────────────────────────────────────────────────────────────────
// ShiftConfirmScreen — confirm venue + shift window before starting
// Presentation only. shiftLabel is formatted upstream — never hardcode
// a date here. Per docs/DOOR-REDESIGN-SPEC.md §6 (wiring is a
// separate task).
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS } from '../constants/colors';
import type { Venue } from './VenueSelectScreen';

interface Props {
  venue: Venue;
  returning: boolean;
  shiftLabel: string;
  onConfirm: () => void;
  onSwitch: () => void;
}

export default function ShiftConfirmScreen({ venue, returning, shiftLabel, onConfirm, onSwitch }: Props) {
  const confirmLabel = returning ? `Stay at ${venue.name}` : 'Start shift';

  return (
    <View style={styles.container}>
      <View style={styles.body}>
        <Text style={styles.venueName} numberOfLines={2}>{venue.name}</Text>
        <Text style={styles.shiftLabel}>{shiftLabel}</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.confirmButton} onPress={onConfirm} activeOpacity={0.8}>
          <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onSwitch} activeOpacity={0.6}>
          <Text style={styles.switchText}>Switch venue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: COLORS.bg,
    justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 48,
  },
  body:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  venueName: {
    fontSize: 28, fontWeight: '800', color: COLORS.text,
    textAlign: 'center', letterSpacing: -0.4, marginBottom: 10,
  },
  shiftLabel: { fontSize: 14, color: COLORS.subtext, textAlign: 'center' },
  actions:    { alignItems: 'center' },
  confirmButton: {
    backgroundColor: COLORS.brand, borderRadius: 12, alignSelf: 'stretch',
    alignItems: 'center', justifyContent: 'center', paddingVertical: 15,
  },
  confirmButtonText: { color: COLORS.onBrand, fontSize: 16, fontWeight: '700' },
  switchText: { color: COLORS.subtext, fontSize: 14, fontWeight: '600', marginTop: 18 },
});
