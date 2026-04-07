// ─────────────────────────────────────────────────────────────────────
// PINScreen — Staff PIN entry
// Auto-submits on 6th digit, no Enter button needed
// Backspace only shown once at least 1 digit entered
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Vibration,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import { useSession, EventSession } from '../context/SessionContext';
import { useLocationCheck } from '../hooks/useLocationCheck';

const MAX_ATTEMPTS    = 5;
const LOCKOUT_MINUTES = 30;

export default function PINScreen() {
  const [pin,        setPin]        = useState('');
  const [loading,    setLoading]    = useState(false);
  const [attempts,   setAttempts]   = useState(0);
  const [lockedUntil,setLockedUntil]= useState<Date | null>(null);
  const { setSession }              = useSession();
  const { verifyAtVenue, checking, error: locationError, setError } = useLocationCheck();

  const isLocked = lockedUntil !== null && new Date() < lockedUntil;

  function handleDigit(d: string) {
    if (isLocked || loading || checking) return;
    if (pin.length < 6) {
      const next = pin + d;
      setPin(next);
      if (next.length === 6) setTimeout(() => handleSubmitWithPin(next), 80);
    }
  }

  function handleDelete() {
    if (loading || checking) return;
    setPin(prev => prev.slice(0, -1));
  }

  async function handleSubmitWithPin(pinValue: string) {
    if (pinValue.length !== 6) return;
    if (isLocked) {
      Alert.alert('Too many attempts', `Try again in ${Math.ceil((lockedUntil!.getTime() - Date.now()) / 60000)} minute(s).`);
      return;
    }
    setLoading(true); setError(null);
    try {
      // 1. Try super admin PIN
      try {
        const fn     = httpsCallable(getFunctions(), 'validateSuperAdminPin');
        const result = await fn({ pin: pinValue });
        const data   = result.data as any;
        if (data?.isSuperAdmin) {
          setAttempts(0);
          setSession({
            eventId: '__super_admin__', eventName: 'All Events',
            venueName: 'Super Admin', venueId: '__super_admin__',
            venueLatitude: 0, venueLongitude: 0,
            date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            role: 'super_admin', pin: pinValue, isSuperAdmin: true,
          });
          return;
        }
      } catch (_) { /* wrong PIN or error — fall through */ }

      // 2. Regular event PIN
      const snap = await firestore()
        .collection('eventPins')
        .where('pin', '==', pinValue)
        .where('active', '==', true)
        .limit(1).get();

      if (snap.empty) {
        Vibration.vibrate(400);
        const next = attempts + 1;
        setAttempts(next);
        if (next >= MAX_ATTEMPTS) {
          const until = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
          setLockedUntil(until); setPin('');
          Alert.alert('Device locked', `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`);
        } else {
          Alert.alert('Invalid PIN', `${MAX_ATTEMPTS - next} attempt(s) remaining.`);
          setPin('');
        }
        return;
      }

      const pinDoc = snap.docs[0].data();
      if (pinDoc.expiresAt && pinDoc.expiresAt.toDate() < new Date()) {
        Alert.alert('PIN expired', 'This PIN is no longer active. Contact your manager.'); setPin(''); return;
      }
      const atVenue = await verifyAtVenue(pinDoc.venueLatitude, pinDoc.venueLongitude);
      if (!atVenue) { setPin(''); return; }

      setAttempts(0);
      setSession({
        eventId: pinDoc.eventId, eventName: pinDoc.eventName,
        venueName: pinDoc.venueName, venueId: pinDoc.venueId,
        venueLatitude: pinDoc.venueLatitude, venueLongitude: pinDoc.venueLongitude,
        date: pinDoc.date, role: pinDoc.role ?? 'door',
        pin: pinValue, isSuperAdmin: false,
      });
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally { setLoading(false); }
  }

  // Keypad: digits 1-9, blank, 0, and backspace (only shown if pin has digits)
  const ROWS = [
    ['1','2','3'],
    ['4','5','6'],
    ['7','8','9'],
    ['', '0', pin.length > 0 ? '⌫' : ''],
  ];

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>wugi</Text>
      <Text style={styles.title}>Staff Check-In</Text>
      <Text style={styles.subtitle}>Enter your 6-digit PIN</Text>

      {/* PIN dots */}
      <View style={styles.dotsRow}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={[styles.dot, pin.length > i && styles.dotFilled]} />
        ))}
      </View>

      {/* Error / locked messages */}
      {locationError ? <Text style={styles.errorText}>{locationError}</Text> : null}
      {isLocked && (
        <Text style={styles.errorText}>
          Locked. Try again in {Math.ceil((lockedUntil!.getTime() - Date.now()) / 60000)} min.
        </Text>
      )}

      {/* Keypad */}
      <View style={styles.keypad}>
        {ROWS.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((k, ci) => {
              const isEmpty = k === '';
              const isBack  = k === '⌫';
              return (
                <TouchableOpacity
                  key={ci}
                  style={[styles.key, isEmpty && styles.keyHidden]}
                  onPress={() => {
                    if (isEmpty) return;
                    if (isBack) handleDelete();
                    else handleDigit(k);
                  }}
                  disabled={isEmpty || isLocked}
                  activeOpacity={0.5}>
                  {isBack
                    ? <Text style={styles.backspaceText}>⌫</Text>
                    : <Text style={styles.keyText}>{k}</Text>
                  }
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* Loading spinner replaces keypad when submitting */}
      {(loading || checking) && (
        <View style={styles.spinnerRow}>
          <ActivityIndicator color="#2a7a5a" size="large" />
          <Text style={styles.spinnerText}>{checking ? 'Checking location…' : 'Verifying…'}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#0a0a0a',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24,
  },
  logo: {
    fontSize: 42, fontWeight: '900', color: '#2a7a5a',
    letterSpacing: 2, marginBottom: 6,
  },
  title: {
    fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 4,
  },
  subtitle: {
    fontSize: 15, color: '#666', marginBottom: 36,
  },
  dotsRow: {
    flexDirection: 'row', gap: 16, marginBottom: 24,
  },
  dot: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#333', backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: '#2a7a5a', borderColor: '#2a7a5a',
  },
  errorText: {
    color: '#ff6b6b', fontSize: 14, textAlign: 'center',
    marginBottom: 14, paddingHorizontal: 8,
  },
  keypad: {
    gap: 16, marginTop: 8,
  },
  row: {
    flexDirection: 'row', gap: 20, justifyContent: 'center',
  },
  key: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: '#1c1c1e',
    alignItems: 'center', justifyContent: 'center',
  },
  keyHidden: {
    backgroundColor: 'transparent',
  },
  keyText: {
    fontSize: 32, fontWeight: '400', color: '#fff',
  },
  backspaceText: {
    fontSize: 28, color: '#aaa',
  },
  spinnerRow: {
    marginTop: 32, alignItems: 'center', gap: 10,
  },
  spinnerText: {
    color: '#555', fontSize: 14,
  },
});
