import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Vibration,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { useSession, EventSession } from '../context/SessionContext';
import { useLocationCheck } from '../hooks/useLocationCheck';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

export default function PINScreen() {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const { setSession } = useSession();
  const { verifyAtVenue, checking, error: locationError, setError } = useLocationCheck();

  const isLocked = lockedUntil !== null && new Date() < lockedUntil;

  function handleDigit(d: string) {
    if (isLocked || loading || checking) return;
    if (pin.length < 6) setPin(prev => prev + d);
  }

  function handleDelete() {
    setPin(prev => prev.slice(0, -1));
  }

  async function handleSubmit() {
    if (pin.length !== 6) return;
    if (isLocked) {
      const mins = Math.ceil((lockedUntil!.getTime() - Date.now()) / 60000);
      Alert.alert('Too many attempts', `Try again in ${mins} minute(s).`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Look up PIN in Firestore
      const snap = await firestore()
        .collection('eventPins')
        .where('pin', '==', pin)
        .where('active', '==', true)
        .limit(1)
        .get();

      if (snap.empty) {
        Vibration.vibrate(400);
        const next = attempts + 1;
        setAttempts(next);
        if (next >= MAX_ATTEMPTS) {
          const until = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
          setLockedUntil(until);
          setPin('');
          Alert.alert('Device locked', `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`);
        } else {
          Alert.alert('Invalid PIN', `${MAX_ATTEMPTS - next} attempt(s) remaining.`);
          setPin('');
        }
        return;
      }

      const pinDoc = snap.docs[0].data();

      // 2. Check PIN expiry
      if (pinDoc.expiresAt && pinDoc.expiresAt.toDate() < new Date()) {
        Alert.alert('PIN expired', 'This PIN is no longer active. Contact your manager.');
        setPin('');
        return;
      }

      // 3. Verify location
      const atVenue = await verifyAtVenue(pinDoc.venueLatitude, pinDoc.venueLongitude);
      if (!atVenue) {
        setPin('');
        return;
      }

      // 4. Set session
      const session: EventSession = {
        eventId: pinDoc.eventId,
        eventName: pinDoc.eventName,
        venueName: pinDoc.venueName,
        venueId: pinDoc.venueId,
        venueLatitude: pinDoc.venueLatitude,
        venueLongitude: pinDoc.venueLongitude,
        date: pinDoc.date,
        role: pinDoc.role ?? 'door',
        pin,
      };
      setAttempts(0);
      setSession(session);

    } catch (e) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>Wugi</Text>
      <Text style={styles.title}>Staff Check-In</Text>
      <Text style={styles.subtitle}>Enter your 6-digit event PIN</Text>

      {/* Dev bypass banner */}
      {__DEV__ && (
        <View style={styles.devBanner}>
          <Text style={styles.devBannerText}>⚠️ DEV MODE — Location check bypassed</Text>
        </View>
      )}

      {/* PIN dots */}
      <View style={styles.dotsRow}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, pin.length > i && styles.dotFilled]}
          />
        ))}
      </View>

      {/* Error messages */}
      {(locationError) ? (
        <Text style={styles.errorText}>{locationError}</Text>
      ) : null}

      {isLocked && (
        <Text style={styles.errorText}>
          Device locked. Try again in {Math.ceil((lockedUntil!.getTime() - Date.now()) / 60000)} min.
        </Text>
      )}

      {/* Keypad */}
      <View style={styles.keypad}>
        {KEYS.map((k, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.key, k === '' && styles.keyEmpty]}
            onPress={() => {
              if (k === '⌫') handleDelete();
              else if (k === '') {}
              else handleDigit(k);
            }}
            disabled={k === '' || isLocked}
            activeOpacity={0.6}
          >
            <Text style={styles.keyText}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submitBtn, pin.length !== 6 && styles.submitDisabled]}
        onPress={handleSubmit}
        disabled={pin.length !== 6 || loading || checking || isLocked}
      >
        {loading || checking ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitText}>
            {checking ? 'Checking location…' : 'Enter'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    fontSize: 36,
    fontWeight: '800',
    color: '#2a7a5a',
    letterSpacing: 2,
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 32,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 20,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#444',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: '#2a7a5a',
    borderColor: '#2a7a5a',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 270,
    gap: 16,
    marginBottom: 28,
    justifyContent: 'center',
  },
  key: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyEmpty: {
    backgroundColor: 'transparent',
  },
  keyText: {
    fontSize: 24,
    fontWeight: '500',
    color: '#fff',
  },
  submitBtn: {
    backgroundColor: '#2a7a5a',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 60,
    alignItems: 'center',
  },
  submitDisabled: {
    opacity: 0.4,
  },
  submitText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  devBanner: {
    backgroundColor: '#2a1f00',
    borderWidth: 1,
    borderColor: '#e6a817',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  devBannerText: {
    color: '#e6a817',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});
