// ─────────────────────────────────────────────────────────────────────
// SignInScreen — Staff email/password sign-in
// Presentation only: local form state, no Firebase calls. Replaces
// PINScreen per docs/DOOR-REDESIGN-SPEC.md §1 (wiring is a separate task).
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard, Platform,
} from 'react-native';
import { COLORS } from '../constants/colors';

interface Props {
  onSignIn: (email: string, password: string) => void;
  onForgotPassword: () => void;
}

export default function SignInScreen({ onSignIn, onForgotPassword }: Props) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');

  const canSubmit = email.trim().length > 0 && password.length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.wordmark}>wugi</Text>
            <Text style={styles.doorLabel}>DOOR</Text>
            <Text style={styles.subtitle}>Staff sign-in</Text>
          </View>

          <View style={styles.form}>
            <TextInput
              style={styles.field}
              placeholder="Email"
              placeholderTextColor={COLORS.subtext}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
            <TextInput
              style={styles.field}
              placeholder="Password"
              placeholderTextColor={COLORS.subtext}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => canSubmit && onSignIn(email.trim(), password)}
            />

            <TouchableOpacity
              style={[styles.signInButton, !canSubmit && styles.signInButtonDisabled]}
              onPress={() => onSignIn(email.trim(), password)}
              disabled={!canSubmit}
              activeOpacity={0.8}>
              <Text style={styles.signInButtonText}>Sign in</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={onForgotPassword} activeOpacity={0.6}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex:      { flex: 1, backgroundColor: COLORS.bg },
  container: {
    flex: 1, backgroundColor: COLORS.bg,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24,
  },
  header:      { alignItems: 'center', marginBottom: 48 },
  wordmark:    { fontSize: 42, fontWeight: '900', color: COLORS.brand, letterSpacing: 2 },
  doorLabel:   { fontSize: 13, fontWeight: '700', color: COLORS.text, letterSpacing: 4, marginTop: 2 },
  subtitle:    { fontSize: 14, color: COLORS.subtext, marginTop: 14 },
  form:        { width: '100%' },
  field: {
    backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    color: COLORS.text, fontSize: 16, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 12,
  },
  signInButton: {
    backgroundColor: COLORS.brand, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 15, marginTop: 8,
  },
  signInButtonDisabled: { opacity: 0.5 },
  signInButtonText:     { color: COLORS.onBrand, fontSize: 16, fontWeight: '700' },
  forgotText: {
    color: COLORS.subtext, fontSize: 13, textAlign: 'center', marginTop: 18,
  },
});
