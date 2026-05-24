// ─────────────────────────────────────────────────────────────────────
// Wugi — ForgotPasswordScreen
// S1-1d: dedicated reset-password screen, reachable from both Sign In
// and Create Account forms via the "Forgot password?" link.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  SafeAreaView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { getAuth, sendPasswordResetEmail } from '@react-native-firebase/auth';
import { friendlyAuthError } from '../context/FirebaseContext';
import { KB_ACCESSORY_ID, useKBContext } from '../constants/keyboard';

type Props = {
  initialEmail?: string;
  onBack: () => void;
};

export function ForgotPasswordScreen({ initialEmail = '', onBack }: Props) {
  const [email,      setEmail]      = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);
  const [sent,       setSent]       = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const emailRef = useRef<TextInput>(null);
  const kb = useKBContext();

  useEffect(() => { kb?.register([emailRef as React.RefObject<TextInput>]); }, []);

  const isValidEmail = email.trim().length > 0 && /\S+@\S+\.\S+/.test(email.trim());

  const handleSubmit = async () => {
    if (!isValidEmail || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await sendPasswordResetEmail(getAuth(), email.trim());
      setSent(true);
    } catch (e: any) {
      setError(friendlyAuthError(e?.code));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Field style helpers (match SignupScreen) ───────────────────────
  const fieldBox   = { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 14, paddingVertical: 14 };
  const label      = { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '700' as const, marginBottom: 6, letterSpacing: 0.8 };
  const inputStyle = { flex: 1, color: '#fff', fontSize: 15, padding: 0 };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#0a0a0a' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView style={{ flex: 1 }}>
        <TouchableOpacity onPress={onBack}
          style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Path d="M19 12H5M12 5l-7 7 7 7" stroke="rgba(255,255,255,0.5)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
          </Svg>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginLeft: 6 }}>Back</Text>
        </TouchableOpacity>

        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center', paddingTop: 32, paddingBottom: 28 }}>
            <Text style={{ color: '#2a7a5a', fontSize: 36, fontWeight: '900', letterSpacing: -1.5, marginBottom: 10 }}>wugi</Text>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 8 }}>Reset your password</Text>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
              Enter your email and we'll send you a reset link.
            </Text>
          </View>

          {sent ? (
            <View style={{ alignItems: 'center', paddingTop: 8 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#2a7a5a22', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
                  <Path d="M5 13l4 4L19 7" stroke="#2a7a5a" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
                </Svg>
              </View>
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 6 }}>Email sent!</Text>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 }}>
                Check your inbox at{'\n'}
                <Text style={{ color: '#fff', fontWeight: '600' }}>{email.trim()}</Text>
              </Text>
              <TouchableOpacity onPress={onBack} style={{ paddingVertical: 12 }}>
                <Text style={{ color: '#2a7a5a', fontSize: 14, fontWeight: '700' }}>← Back to Sign In</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {error && (
                <View style={{ backgroundColor: '#e74c3c22', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#e74c3c44' }}>
                  <Text style={{ color: '#e74c3c', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>{error}</Text>
                </View>
              )}

              <View style={{ gap: 14 }}>
                <View>
                  <Text style={label}>EMAIL</Text>
                  <View style={fieldBox}>
                    <TextInput
                      ref={emailRef}
                      placeholder="you@email.com"
                      placeholderTextColor="rgba(255,255,255,0.25)"
                      value={email}
                      onChangeText={t => { setEmail(t); setError(null); }}
                      style={inputStyle}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="email"
                      textContentType="emailAddress"
                      returnKeyType="send"
                      onSubmitEditing={handleSubmit}
                      inputAccessoryViewID={KB_ACCESSORY_ID}
                      autoFocus={!initialEmail}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={{
                    backgroundColor: '#2a7a5a',
                    borderRadius: 12,
                    paddingVertical: 16,
                    alignItems: 'center',
                    marginTop: 8,
                    opacity: !isValidEmail || submitting ? 0.5 : 1,
                    shadowColor: '#2a7a5a', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
                  }}
                  onPress={handleSubmit}
                  disabled={!isValidEmail || submitting}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" size="small"/>
                    : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Send Reset Email</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
