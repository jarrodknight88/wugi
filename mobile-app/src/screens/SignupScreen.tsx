// ─────────────────────────────────────────────────────────────────────
// Wugi — SignupScreen
// S1-1 UAT fixes:
//   - Sign In CTA above Create Account on landing
//   - Confirm password field on signup
//   - Password strength indicator + requirements
//   - Forgot password link on email-already-exists error
//   - Email keyboard type verified (email-address)
//   - Keyboard up/down toolbar between fields (InputAccessoryView)
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  SafeAreaView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useFirebase } from '../context/FirebaseContext';
import { getAuth, sendPasswordResetEmail } from '@react-native-firebase/auth';
import { KB_ACCESSORY_ID, useKBContext } from '../constants/keyboard';

type Mode = 'landing' | 'signin' | 'signup';

type Props = {
  onSignupComplete: () => void;
  onSignInComplete: () => void;
  onGuest: () => void;
};

// ── Password strength ─────────────────────────────────────────────────
type StrengthLevel = 'weak' | 'fair' | 'strong';
function getPasswordStrength(pw: string): { level: StrengthLevel; score: number; checks: Record<string, boolean> } {
  const checks = {
    length:  pw.length >= 8,
    upper:   /[A-Z]/.test(pw),
    lower:   /[a-z]/.test(pw),
    number:  /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const level: StrengthLevel = score <= 2 ? 'weak' : score <= 3 ? 'fair' : 'strong';
  return { level, score, checks };
}
const STRENGTH_COLOR = { weak: '#e74c3c', fair: '#f39c12', strong: '#2a7a5a' };
const STRENGTH_LABEL = { weak: 'Weak', fair: 'Fair', strong: 'Strong' };

export function SignupScreen({ onSignupComplete, onSignInComplete, onGuest }: Props) {
  const { signIn, signUp, authError, clearAuthError } = useFirebase();

  const [mode,            setMode]            = useState<Mode>('landing');
  const [email,           setEmail]           = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName,     setDisplayName]     = useState('');
  const [showPassword,    setShowPassword]    = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);
  const [submitting,      setSubmitting]      = useState(false);
  const [resetSent,       setResetSent]       = useState(false);
  const [localError,      setLocalError]      = useState<string | null>(null);

  // Field refs for keyboard toolbar navigation
  const nameRef    = useRef<TextInput>(null);
  const emailRef   = useRef<TextInput>(null);
  const passRef    = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const strength = getPasswordStrength(password);
  const kb = useKBContext();

  // Register active fields with the keyboard toolbar context
  // so ⬆⬇ buttons know which refs to navigate
  useEffect(() => {
    if (!kb) return;
    if (mode === 'signup')  kb.register([nameRef, emailRef, passRef, confirmRef]);
    if (mode === 'signin')  kb.register([emailRef, passRef]);
    if (mode === 'landing') kb.register([]);
  }, [mode]);

  const switchMode = (next: Mode) => {
    clearAuthError(); setLocalError(null); setResetSent(false);
    setEmail(''); setPassword(''); setConfirmPassword(''); setDisplayName('');
    setMode(next);
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) { setLocalError('Enter your email above to reset your password.'); return; }
    try {
      await sendPasswordResetEmail(getAuth(), email.trim());
      setResetSent(true); setLocalError(null);
    } catch { setLocalError('Could not send reset email. Check the address and try again.'); }
  };

  const handleSignUp = async () => {
    if (!email.trim() || !password || !displayName.trim()) {
      setLocalError('Please fill in all fields.'); return;
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.'); return;
    }
    if (strength.level === 'weak') {
      setLocalError('Password is too weak. Add uppercase, numbers, or symbols.'); return;
    }
    setSubmitting(true); clearAuthError(); setLocalError(null);
    try {
      await signUp(email.trim(), password, displayName.trim());
      onSignupComplete();
    } catch { /* authError shown via context */ }
    finally { setSubmitting(false); }
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password) return;
    setSubmitting(true); clearAuthError(); setLocalError(null);
    try {
      await signIn(email.trim(), password);
      onSignInComplete();
    } catch { /* authError shown via context */ }
    finally { setSubmitting(false); }
  };

  const displayError = localError || authError;
  const showForgotLink = !resetSent && mode === 'signin' &&
    (authError?.toLowerCase().includes('incorrect') || authError?.toLowerCase().includes('password'));

  // ── Landing screen ────────────────────────────────────────────────
  if (mode === 'landing') {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
        <SafeAreaView style={{ flex: 1, justifyContent: 'space-between', paddingHorizontal: 28, paddingTop: 60, paddingBottom: 36 }}>
          <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}>
            <View style={{ position: 'absolute', width: 280, height: 280, borderRadius: 140, backgroundColor: '#2a7a5a', opacity: 0.08 }}/>
            <Text style={{ color: '#2a7a5a', fontSize: 72, fontWeight: '900', letterSpacing: -4, marginBottom: 12 }}>wugi</Text>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 16, textAlign: 'center', lineHeight: 24 }}>
              Atlanta's nightlife, curated{'\n'}for your vibe.
            </Text>
          </View>
          <View style={{ gap: 12 }}>
            {/* Sign In first per UAT #2 */}
            <TouchableOpacity onPress={() => switchMode('signin')}
              style={{ backgroundColor: '#2a7a5a', borderRadius: 14, paddingVertical: 17, alignItems: 'center', shadowColor: '#2a7a5a', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => switchMode('signup')}
              style={{ borderRadius: 14, paddingVertical: 17, alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)' }}>
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>Create Account</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onGuest} style={{ alignItems: 'center', paddingVertical: 14 }}>
              <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>Continue as Guest</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Shared field style helpers ─────────────────────────────────────
  const fieldBox = { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 14, paddingVertical: 14 };
  const label    = { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '700' as const, marginBottom: 6, letterSpacing: 0.8 };
  const inputStyle = { flex: 1, color: '#fff', fontSize: 15, padding: 0 };
  const isSignup = mode === 'signup';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#0a0a0a' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

      <SafeAreaView style={{ flex: 1 }}>
        <TouchableOpacity onPress={() => switchMode('landing')}
          style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Path d="M19 12H5M12 5l-7 7 7 7" stroke="rgba(255,255,255,0.5)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
          </Svg>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginLeft: 6 }}>Back</Text>
        </TouchableOpacity>

        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center', paddingTop: 32, paddingBottom: 28 }}>
            <Text style={{ color: '#2a7a5a', fontSize: 36, fontWeight: '900', letterSpacing: -1.5, marginBottom: 10 }}>wugi</Text>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 8 }}>{isSignup ? 'Create your account' : 'Welcome back'}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
              {isSignup ? "Join Atlanta's most vibrant nightlife community" : 'Sign in to access your saved spots and passes'}
            </Text>
          </View>

          {/* Error / success banner */}
          {resetSent && (
            <View style={{ backgroundColor: '#2a7a5a22', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#2a7a5a44' }}>
              <Text style={{ color: '#2a7a5a', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>Reset email sent! Check your inbox.</Text>
            </View>
          )}
          {displayError && !resetSent && (
            <View style={{ backgroundColor: '#e74c3c22', borderRadius: 10, padding: 12, marginBottom: 4, borderWidth: 1, borderColor: '#e74c3c44' }}>
              <Text style={{ color: '#e74c3c', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>{displayError}</Text>
            </View>
          )}
          {/* Forgot password link — shows when sign-in fails */}
          {showForgotLink && (
            <TouchableOpacity onPress={handleForgotPassword} style={{ alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: '#2a7a5a', fontSize: 13, fontWeight: '600' }}>Forgot password? Send reset email →</Text>
            </TouchableOpacity>
          )}

          <View style={{ gap: 14 }}>
            {/* Full name — signup only */}
            {isSignup && (
              <View>
                <Text style={label}>FULL NAME</Text>
                <View style={fieldBox}>
                  <TextInput ref={nameRef} placeholder="Your name" placeholderTextColor="rgba(255,255,255,0.25)" value={displayName} onChangeText={setDisplayName} style={inputStyle} autoCapitalize="words" autoComplete="name" textContentType="name" returnKeyType="next" onSubmitEditing={() => setTimeout(() => emailRef.current?.focus(), 50)} inputAccessoryViewID={KB_ACCESSORY_ID}/>
                </View>
              </View>
            )}

            {/* Email */}
            <View>
              <Text style={label}>EMAIL</Text>
              <View style={fieldBox}>
                <TextInput ref={emailRef} placeholder="you@email.com" placeholderTextColor="rgba(255,255,255,0.25)" value={email} onChangeText={t => { setEmail(t); clearAuthError(); setLocalError(null); setResetSent(false); }} style={inputStyle} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={() => setTimeout(() => passRef.current?.focus(), 50)} inputAccessoryViewID={KB_ACCESSORY_ID}/>
              </View>
            </View>

            {/* Password */}
            <View>
              <Text style={label}>PASSWORD</Text>
              <View style={fieldBox}>
                <TextInput ref={passRef} placeholder="••••••••" placeholderTextColor="rgba(255,255,255,0.25)" value={password} onChangeText={t => { setPassword(t); clearAuthError(); setLocalError(null); }} secureTextEntry={!showPassword} style={inputStyle} autoCapitalize="none" autoComplete="off" textContentType="none" returnKeyType={isSignup ? 'next' : 'done'} onSubmitEditing={isSignup ? () => setTimeout(() => confirmRef.current?.focus(), 50) : handleSignIn} inputAccessoryViewID={KB_ACCESSORY_ID}/>
                <TouchableOpacity onPress={() => setShowPassword(p => !p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    {showPassword
                      ? (<><Path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" stroke="rgba(255,255,255,0.4)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Path d="M1 1l22 22" stroke="rgba(255,255,255,0.4)" strokeWidth={1.8} strokeLinecap="round"/></>)
                      : (<><Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="rgba(255,255,255,0.4)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Circle cx={12} cy={12} r={3} stroke="rgba(255,255,255,0.4)" strokeWidth={1.8}/></>)
                    }
                  </Svg>
                </TouchableOpacity>
              </View>

              {/* Password strength — signup only */}
              {isSignup && password.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>
                    {[1,2,3,4,5].map(i => (
                      <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= strength.score ? STRENGTH_COLOR[strength.level] : 'rgba(255,255,255,0.1)' }}/>
                    ))}
                  </View>
                  <Text style={{ color: STRENGTH_COLOR[strength.level], fontSize: 11, fontWeight: '700', marginBottom: 4 }}>{STRENGTH_LABEL[strength.level]}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {[
                      { key: 'length',  label: '8+ chars' },
                      { key: 'upper',   label: 'Uppercase' },
                      { key: 'number',  label: 'Number' },
                      { key: 'special', label: 'Symbol' },
                    ].map(r => (
                      <Text key={r.key} style={{ fontSize: 11, color: (strength.checks as any)[r.key] ? '#2a7a5a' : 'rgba(255,255,255,0.3)', fontWeight: '600' }}>
                        {(strength.checks as any)[r.key] ? '✓' : '○'} {r.label}
                      </Text>
                    ))}
                  </View>
                </View>
              )}
            </View>

            {/* Confirm password — signup only */}
            {isSignup && (
              <View>
                <Text style={label}>CONFIRM PASSWORD</Text>
                <View style={{ ...fieldBox, borderColor: confirmPassword && confirmPassword !== password ? '#e74c3c' : 'rgba(255,255,255,0.1)' }}>
                  <TextInput ref={confirmRef} placeholder="••••••••" placeholderTextColor="rgba(255,255,255,0.25)" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry={!showConfirm} style={inputStyle} autoCapitalize="none" autoComplete="off" textContentType="none" returnKeyType="done" onSubmitEditing={handleSignUp} inputAccessoryViewID={KB_ACCESSORY_ID}/>
                  <TouchableOpacity onPress={() => setShowConfirm(p => !p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                      {showConfirm
                        ? (<><Path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" stroke="rgba(255,255,255,0.4)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Path d="M1 1l22 22" stroke="rgba(255,255,255,0.4)" strokeWidth={1.8} strokeLinecap="round"/></>)
                        : (<><Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="rgba(255,255,255,0.4)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Circle cx={12} cy={12} r={3} stroke="rgba(255,255,255,0.4)" strokeWidth={1.8}/></>)
                      }
                    </Svg>
                  </TouchableOpacity>
                </View>
                {confirmPassword.length > 0 && confirmPassword !== password && (
                  <Text style={{ color: '#e74c3c', fontSize: 11, fontWeight: '600', marginTop: 4 }}>Passwords don't match</Text>
                )}
              </View>
            )}

            {/* Submit */}
            <TouchableOpacity
              style={{ backgroundColor: '#2a7a5a', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8, opacity: submitting ? 0.7 : 1, shadowColor: '#2a7a5a', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}
              onPress={isSignup ? handleSignUp : handleSignIn}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" size="small"/> : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{isSignup ? 'Create Account' : 'Sign In'}</Text>}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={{ alignItems: 'center', marginTop: 24 }} onPress={() => switchMode(isSignup ? 'signin' : 'signup')}>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
              {isSignup ? 'Already have an account? ' : "Don't have an account? "}
              <Text style={{ color: '#2a7a5a', fontWeight: '700' }}>{isSignup ? 'Sign In' : 'Sign Up'}</Text>
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ alignItems: 'center', marginTop: 16 }} onPress={onGuest}>
            <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>Continue as Guest</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
