// ─────────────────────────────────────────────────────────────────────
// VenueSelectScreen — pick which venue to work tonight
// Presentation only: venues come in via props, no fetching here.
// Generalises SuperAdminEventSelector's venue picking to all staff
// per docs/DOOR-REDESIGN-SPEC.md §6 (wiring is a separate task).
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
} from 'react-native';
import { COLORS } from '../constants/colors';

export interface Venue {
  id: string;
  name: string;
  secondaryLine?: string;
}

interface Props {
  venues: Venue[];
  onPick: (venue: Venue) => void;
  onBack: () => void;
}

export default function VenueSelectScreen({ venues, onPick, onBack }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} activeOpacity={0.6} style={styles.backButton}>
          <Text style={styles.backButtonText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Pick your venue</Text>
        <Text style={styles.subtitle}>Where are you working tonight?</Text>
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}>
        {venues.map(venue => (
          <TouchableOpacity
            key={venue.id}
            style={styles.row}
            onPress={() => onPick(venue)}
            activeOpacity={0.7}>
            <View style={styles.rowBody}>
              <Text style={styles.rowName} numberOfLines={1}>{venue.name}</Text>
              {!!venue.secondaryLine && (
                <Text style={styles.rowSecondary} numberOfLines={1}>{venue.secondaryLine}</Text>
              )}
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        ))}

        {venues.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No venues assigned to your account.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: COLORS.bg },
  header:      { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  backButton:  { alignSelf: 'flex-start', marginBottom: 12 },
  backButtonText: { color: COLORS.subtext, fontSize: 15 },
  title:       { fontSize: 22, fontWeight: '700', color: COLORS.text, letterSpacing: -0.4 },
  subtitle:    { fontSize: 13, color: COLORS.subtext, marginTop: 4 },
  list:        { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.divider,
    padding: 16, marginBottom: 10,
  },
  rowBody:      { flex: 1 },
  rowName:      { fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  rowSecondary: { fontSize: 13, color: COLORS.subtext },
  arrow:        { fontSize: 22, color: COLORS.card2 },
  empty:        { paddingTop: 60, alignItems: 'center' },
  emptyText:    { color: COLORS.subtext, fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
});
