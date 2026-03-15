import React from 'react';
import {
  ScrollView,
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  Platform,
} from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const FLYER_WIDTH = SCREEN_WIDTH - 32;
const FLYER_HEIGHT = FLYER_WIDTH * 1.25;

const flyerImage = require('../../assets/flyer-taco.jpg');

const VENUE = {
  name: 'The Ivy Buckhead',
  address: '3717 Roswell Rd NE, Atlanta, GA 30342',
};

const PILLS = [
  { label: 'SAT MAR 22' },
  { label: '8 PM – 2 AM' },
  { label: '21+' },
];

// ── Venue Info Block ──────────────────────────────────────────────────
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

// ── Option A: Dark Pills ──────────────────────────────────────────────
function OptionA() {
  return (
    <View style={styles.optionContainer}>
      <Text style={styles.optionLabel}>Option A — Dark Pills</Text>
      <Image source={flyerImage} style={styles.flyer} resizeMode="cover" />
      <View style={styles.pillRow}>
        {PILLS.map((p) => (
          <View key={p.label} style={styles.darkPill}>
            <Text style={styles.darkPillText}>{p.label}</Text>
          </View>
        ))}
      </View>
      <VenueInfo />
    </View>
  );
}

// ── Option B: Dark Strip ──────────────────────────────────────────────
function OptionB() {
  return (
    <View style={styles.optionContainer}>
      <Text style={styles.optionLabel}>Option B — Dark Strip</Text>
      <Image source={flyerImage} style={styles.flyerNoBottomRadius} resizeMode="cover" />
      <View style={styles.darkStrip}>
        {PILLS.map((p, i) => (
          <View
            key={p.label}
            style={[
              styles.stripColumn,
              i < PILLS.length - 1 && styles.stripColumnBorder,
            ]}
          >
            <Text style={styles.stripText}>{p.label}</Text>
          </View>
        ))}
      </View>
      <VenueInfo />
    </View>
  );
}

// ── Hybrid: Frosted Glass Pills ───────────────────────────────────────
function OptionHybrid() {
  return (
    <View style={styles.optionContainer}>
      <Text style={styles.optionLabel}>Hybrid — Frosted Glass Pills</Text>
      <View style={styles.flyerWrapper}>
        <Image source={flyerImage} style={styles.flyer} resizeMode="cover" />
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
  );
}

// ── Main Screen ───────────────────────────────────────────────────────
export default function EventProfileTest() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Event Detail — Compare Styles</Text>
      <OptionA />
      <OptionB />
      <OptionHybrid />
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0e0e0e',
  },
  content: {
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingBottom: 60,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 24,
    textAlign: 'center',
  },

  // Option wrapper
  optionContainer: {
    width: FLYER_WIDTH,
    marginBottom: 40,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2a7a5a',
    letterSpacing: 0.5,
    marginBottom: 10,
    textTransform: 'uppercase',
  },

  // Flyer image
  flyer: {
    width: FLYER_WIDTH,
    height: FLYER_HEIGHT,
    borderRadius: 16,
  },
  flyerNoBottomRadius: {
    width: FLYER_WIDTH,
    height: FLYER_HEIGHT,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  flyerWrapper: {
    position: 'relative',
  },

  // ── Option A: Dark pills ──
  pillRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  darkPill: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  darkPillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // ── Option B: Dark strip ──
  darkStrip: {
    backgroundColor: '#111',
    flexDirection: 'row',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    overflow: 'hidden',
  },
  stripColumn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
  },
  stripColumnBorder: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#333',
  },
  stripText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // ── Hybrid: Frosted glass pills ──
  frostedOverlay: {
    position: 'absolute',
    bottom: 14,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  frostedPill: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  frostedPillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // ── Venue info ──
  venueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingHorizontal: 4,
  },
  venueLogo: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#333',
    marginRight: 12,
  },
  venueText: {
    flex: 1,
  },
  venueName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  venueAddress: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
});
