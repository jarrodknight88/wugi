// ─────────────────────────────────────────────────────────────────────
// Wugi — UsernameScreen
// S1-2: Username selection shown after vibe onboarding for new users.
// Real-time availability check. Writes to users/{uid} + usernames/{username}.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  SafeAreaView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFirebase } from '../context/FirebaseContext';
import { checkUsernameAvailable, saveUsername } from '../../firestoreService';

type AvailabilityState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

type Props = {
  onComplete: () => void; // → main tabs
};

const USERNAME_REGEX = /^[a-zA-Z0-9_.]{3,20}$/;

function validateFormat(username: string): string | null {
  if (username.length < 3)  return 'At least 3 characters';
  if (username.length > 20) return 'Max 20 characters';
  if (!USERNAME_REGEX.test(username)) return 'Letters, numbers, _ and . only';
  return null;
}

export function UsernameScreen({ onComplete }: Props) {
  const { user } = useFirebase();
  const [username,      setUsername]      = useState('');
  const [availability,  setAvailability]  = useState<AvailabilityState>('idle');
  const [formatError,   setFormatError]   = useState<string | null>(null);
  const [submitting,    setSubmitting]    = useState(false);
  const [saveError,     setSaveError]     = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Real-time availability check with 500ms debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = username.trim();
    const fmtErr  = validateFormat(trimmed);

    if (!trimmed) { setAvailability('idle'); setFormatError(null); return; }
    if (fmtErr)   { setAvailability('invalid'); setFormatError(fmtErr); return; }

    setFormatError(null);
    setAvailability('checking');

    debounceRef.current = setTimeout(async () => {
      const available = await checkUsernameAvailable(trimmed);
      setAvailability(available ? 'available' : 'taken');
    }, 500);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [username]);

  const handleContinue = async () => {
    if (!user || availability !== 'available') return;
    setSubmitting(true);
    setSaveError(null);
    try {
      await saveUsername(user.uid, username.trim());
      onComplete();
    } catch (e: any) {
      setSaveError(e.message ?? 'Failed to save username. Try again.');
      setAvailability('taken');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = availability === 'available' && !submitting;

  // Status indicator color + label
  const statusColor =
    availability === 'available' ? '#2a7a5a' :
    availability === 'taken'     ? '#e74c3c' :
    availability === 'checking'  ? '#f39c12' : 'transparent';

  const statusLabel =
    availability === 'available' ? '✓ Available' :
    availability === 'taken'     ? '✗ Already taken' :
    availability === 'checking'  ? 'Checking…' :
    formatError ?? '';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#0a0a0a' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView style={{ flex: 1, paddingHorizontal: 28 }}>

        {/* Header */}
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ position: 'absolute', width: 240, height: 240, borderRadius: 120, backgroundColor: '#2a7a5a', opacity: 0.07, alignSelf: 'center' }}/>

          <Text style={{ color: '#2a7a5a', fontSize: 36, fontWeight: '900', letterSpacing: -1.5, textAlign: 'center', marginBottom: 10 }}>
            wugi
          </Text>
          <Text style={{ color: '#fff', fontSize: 26, fontWeight: '900', textAlign: 'center', letterSpacing: -0.5, marginBottom: 10 }}>
            Pick your username
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 40 }}>
            This is how you'll appear on Wugi.{'\n'}You can change it later in settings.
          </Text>

          {/* Input */}
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 14, borderWidth: 1.5, borderColor: availability === 'available' ? '#2a7a5a' : availability === 'taken' || availability === 'invalid' ? '#e74c3c' : 'rgba(255,255,255,0.1)', paddingHorizontal: 16, paddingVertical: 16, marginBottom: 10 }}>
            <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 17, fontWeight: '600', marginRight: 2 }}>@</Text>
            <TextInput
              placeholder="yourname"
              placeholderTextColor="rgba(255,255,255,0.2)"
              value={username}
              onChangeText={t => { setSaveError(null); setUsername(t.toLowerCase().replace(/\s/g, '')); }}
              style={{ flex: 1, color: '#fff', fontSize: 17, fontWeight: '600', padding: 0, letterSpacing: 0.3 }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleContinue}
              maxLength={20}
            />
            {availability === 'checking' && <ActivityIndicator size="small" color="#f39c12"/>}
          </View>

          {/* Status label */}
          {availability !== 'idle' && statusLabel ? (
            <Text style={{ color: statusColor, fontSize: 13, fontWeight: '600', marginBottom: 4, marginLeft: 4 }}>
              {statusLabel}
            </Text>
          ) : null}

          {/* Save error */}
          {saveError && (
            <View style={{ backgroundColor: '#e74c3c22', borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: '#e74c3c44' }}>
              <Text style={{ color: '#e74c3c', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>{saveError}</Text>
            </View>
          )}

          {/* Rules hint */}
          <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, marginTop: 12, marginLeft: 4, lineHeight: 18 }}>
            3–20 characters · letters, numbers, _ and . only
          </Text>
        </View>

        {/* CTA */}
        <View style={{ paddingBottom: 12 }}>
          <TouchableOpacity
            onPress={handleContinue}
            disabled={!canSubmit}
            style={{ backgroundColor: canSubmit ? '#2a7a5a' : '#1a3a2a', borderRadius: 14, paddingVertical: 17, alignItems: 'center', shadowColor: '#2a7a5a', shadowOpacity: canSubmit ? 0.35 : 0, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}
          >
            {submitting
              ? <ActivityIndicator color="#fff" size="small"/>
              : <Text style={{ color: canSubmit ? '#fff' : 'rgba(255,255,255,0.3)', fontSize: 17, fontWeight: '800' }}>Continue →</Text>
            }
          </TouchableOpacity>

          {/* Skip — allows bypassing username for now */}
          <TouchableOpacity onPress={onComplete} style={{ alignItems: 'center', paddingVertical: 16 }}>
            <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>Skip for now</Text>
          </TouchableOpacity>
        </View>

      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
