// ─────────────────────────────────────────────────────────────────────
// CapacityCard — Dashboard hero: checked-in count against event capacity
// Per docs/DOOR-REDESIGN-SPEC.md §6 (Dashboard: "restyle + capacity gauge").
// Capacity is derived (sum of ticketTypes[].capacity) — see DashboardScreen.
// When it can't be derived (super admin aggregate, or no ticket types with
// a capacity set), this degrades to showing the count alone rather than
// inventing a number.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { COLORS } from '../constants/colors';

interface Props {
  checkedIn: number;
  capacity: number | null;
}

export default function CapacityCard({ checkedIn, capacity }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const hasCapacity = capacity != null && capacity > 0;
  const pct = hasCapacity ? (checkedIn / capacity) * 100 : 0;
  const barPct = Math.max(0, Math.min(100, pct));
  const spotsLeft = hasCapacity ? Math.max(0, capacity - checkedIn) : null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>CHECKED IN TONIGHT</Text>
        <View style={styles.liveRow}>
          {/* LIVE dot — genuine status feedback, COLORS.go per the design's color rule */}
          <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      <View style={styles.countRow}>
        <View style={styles.countLeft}>
          <Text style={styles.countNum}>{checkedIn}</Text>
          {hasCapacity && <Text style={styles.countCap}> / {capacity}</Text>}
        </View>
        {hasCapacity && <Text style={styles.pct}>{Math.round(pct)}%</Text>}
      </View>

      {hasCapacity ? (
        <>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${barPct}%` as any }]} />
          </View>
          <Text style={styles.secondaryLine}>
            {spotsLeft} spot{spotsLeft === 1 ? '' : 's'} left
          </Text>
        </>
      ) : (
        <Text style={styles.secondaryLine}>
          Capacity not set for this event
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.divider,
    padding: 20,
    marginBottom: 16,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  headerLabel: { fontSize: 12, fontWeight: '700', color: COLORS.subtext, letterSpacing: 1 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.go },
  liveText: { fontSize: 11, fontWeight: '700', color: COLORS.go, letterSpacing: 0.5 },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 },
  countLeft: { flexDirection: 'row', alignItems: 'baseline' },
  countNum: { fontSize: 48, fontWeight: '800', color: COLORS.text, lineHeight: 52 },
  countCap: { fontSize: 20, fontWeight: '600', color: COLORS.subtext },
  pct: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  progressBg: { height: 8, backgroundColor: COLORS.card2, borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  // Progress fill is status feedback (how full the room is), not chrome — COLORS.go.
  progressFill: { height: '100%', backgroundColor: COLORS.go, borderRadius: 4 },
  secondaryLine: { fontSize: 13, color: COLORS.subtext },
});
