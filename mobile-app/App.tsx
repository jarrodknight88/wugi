import React from 'react';
import { ScrollView, View, Text, Image, StyleSheet, Dimensions, Platform } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const FLYER_WIDTH = SCREEN_WIDTH - 32;
const FLYER_HEIGHT = FLYER_WIDTH * 1.25;

const VENUE = {
  name: 'The Ivy Buckhead',
  address: '3717 Roswell Rd NE, Atlanta, GA 30342',
};

const PILLS = [
  { label: 'SAT MAR 22' },
  { label: '8 PM – 2 AM' },
  { label: '21+' },
];

function VenueInfo() {
  return (
    <View style={styles.venueRow}>
      <View style={styles.venueLogo} />
      <View style={styles.venueText}>
        <Text style={styles.venueName}>{VENUE.name}</Text>
        <Text style={styles.venueAddress}>{VENUE.address}</Text>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Event Detail — Compare Styles</Text>

      {/* Option A: Dark Pills */}
      <View style={styles.optionContainer}>
        <Text style={styles.optionLabel}>Option A — Dark Pills</Text>
        <View style={[styles.flyer, { backgroundColor: '#333' }]} />
        <View style={styles.pillRow}>
          {PILLS.map((p) => (
            <View key={p.label} style={styles.darkPill}>
              <Text style={styles.darkPillText}>{p.label}</Text>
            </View>
          ))}
        </View>
        <VenueInfo />
      </View>

      {/* Option B: Dark Strip */}
      <View style={styles.optionContainer}>
        <Text style={styles.optionLabel}>Option B — Dark Strip</Text>
        <View style={[styles.flyerNoBottomRadius, { backgroundColor: '#333' }]} />
        <View style={styles.darkStrip}>
          {PILLS.map((p, i) => (
            <View key={p.label} style={[styles.stripColumn, i < PILLS.length - 1 && styles.stripColumnBorder]}>
              <Text style={styles.stripText}>{p.label}</Text>
            </View>
          ))}
        </View>
        <VenueInfo />
      </View>

      {/* Hybrid: Frosted Glass */}
      <View style={styles.optionContainer}>
        <Text style={styles.optionLabel}>Hybrid — Frosted Glass Pills</Text>
        <View style={styles.flyerWrapper}>
          <View style={[styles.flyer, { backgroundColor: '#333' }]} />
          <View style={styles.frostedOverlay}>
            {PILLS.map((p) => (
              <View key={p.label} style={styles.frostedPill}>
                <Text style={styles.frostedPillText}>{p.label}</Text>
              </View>
            ))}
          </View>
        </View>
        <VenueInfo />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0e0e0e' },
  content: { paddingTop: Platform.OS === 'ios' ? 60 : 44, paddingBottom: 60, alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 24, textAlign: 'center' },
  optionContainer: { width: FLYER_WIDTH, marginBottom: 40 },
  optionLabel: { fontSize: 14, fontWeight: '700', color: '#2a7a5a', letterSpacing: 0.5, marginBottom: 10, textTransform: 'uppercase' },
  flyer: { width: FLYER_WIDTH, height: FLYER_HEIGHT, borderRadius: 16 },
  flyerNoBottomRadius: { width: FLYER_WIDTH, height: FLYER_HEIGHT, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  flyerWrapper: { position: 'relative' },
  pillRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 },
  darkPill: { backgroundColor: '#1a1a1a', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#333' },
  darkPillText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  darkStrip: { backgroundColor: '#111', flexDirection: 'row', borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  stripColumn: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  stripColumnBorder: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#333' },
  stripText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  frostedOverlay: { position: 'absolute', bottom: 14, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  frostedPill: { backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  frostedPillText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  venueRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingHorizontal: 4 },
  venueLogo: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#333', marginRight: 12 },
  venueText: { flex: 1 },
  venueName: { color: '#fff', fontSize: 15, fontWeight: '700' },
  venueAddress: { color: '#888', fontSize: 12, marginTop: 2 },
});