// ─────────────────────────────────────────────────────────────────────
// Wugi — SignupScreen (auth sheet)
// Pushed at the moment of intent (saving, viewing passes, account) —
// never as an up-front gate. The app is fully browsable without it.
//   - Social sign-in first (Apple / Google), email as fallback
//   - Contextual headline per intent so the ask matches the action
//   - Always dismissible — closing returns to what the user was doing
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  SafeAreaView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useFirebase } from '../context/FirebaseContext';
import { KB_ACCESSORY_ID, useKBContext } from '../constants/keyboard';
import { FONTS } from '../constants/fonts';

type Mode = 'landing' | 'signin' | 'signup';

export type AuthIntent = 'save' | 'passes' | 'general';

type Props = {
  intent?:           AuthIntent;
  // Called after ANY successful auth (social or email). isNewUser lets the
  // navigator route fresh accounts to username selection.
  onDone:            (result: { isNewUser: boolean }) => void;
  // User dismissed the sheet — return them to what they were doing.
  onClose:           () => void;
  onForgotPassword:  (currentEmail: string) => void;
};

const INTENT_COPY: Record<AuthIntent, { title: string; subtitle: string }> = {
  save:    { title: 'Keep your saves',      subtitle: 'Create a free account so your saved spots and events follow you everywhere.' },
  passes:  { title: 'Your passes, saved',   subtitle: 'Sign in to see every ticket you’ve bought, all in one place.' },
  general: { title: 'Join Wugi',            subtitle: 'Save spots, get your passes, and unlock a feed tuned to your vibe.' },
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

// ── Small inline icons ────────────────────────────────────────────────
function AppleLogo() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="#000">
      <Path d="M17.05 20.28c-.98.95-2.05.86-3.08.38-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.38C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
    </Svg>
  );
}
function GoogleLogo() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <Path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <Path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <Path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </Svg>
  );
}
function EyeIcon({ off }: { off: boolean }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      {off
        ? (<><Path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" stroke="rgba(255,255,255,0.4)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Path d="M1 1l22 22" stroke="rgba(255,255,255,0.4)" strokeWidth={1.8} strokeLinecap="round"/></>)
        : (<><Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="rgba(255,255,255,0.4)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Circle cx={12} cy={12} r={3} stroke="rgba(255,255,255,0.4)" strokeWidth={1.8}/></>)
      }
    </Svg>
  );
}

export function SignupScreen({ intent = 'general', onDone, onClose, onForgotPassword }: Props) {
  const {
    signIn, signUp, signInWithApple, signInWithGoogle,
    appleAuthAvailable, googleAuthAvailable,
    authError, clearAuthError,
  } = useFirebase();

  const [mode,            setMode]            = useState<Mode>('landing');
  const [email,           setEmail]           = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName,     setDisplayName]     = useState('');
  const [showPassword,    setShowPassword]    = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);
  const [submitting,      setSubmitting]      = useState(false);
  const [socialBusy,      setSocialBusy]      = useState<'apple' | 'google' | null>(null);
  const [localError,      setLocalError]      = useState<string | null>(null);

  // Field refs for keyboard toolbar navigation
  const nameRef    = useRef<TextInput>(null);
  const emailRef   = useRef<TextInput>(null);
  const passRef    = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const strength = getPasswordStrength(password);
  const kb = useKBContext();
  const copy = INTENT_COPY[intent];

  useEffect(() => {
    if (!kb) return;
    if (mode === 'signup')  kb.register([nameRef, emailRef, passRef, confirmRef]);
    if (mode === 'signin')  kb.register([emailRef, passRef]);
    if (mode === 'landing') kb.register([]);
  }, [mode]);

  const switchMode = (next: Mode) => {
    clearAuthError(); setLocalError(null);
    setEmail(''); setPassword(''); setConfirmPassword(''); setDisplayName('');
    setMode(next);
  };

  const handleSocial = async (provider: 'apple' | 'google') => {
    if (socialBusy) return;
    setSocialBusy(provider); clearAuthError(); setLocalError(null);
    try {
      const result = provider === 'apple' ? await signInWithApple() : await signInWithGoogle();
      onDone(result);
    } catch {
      // Cancelled → silent. Real failures → authError banner via context;
      // the sheet stays open so they can retry or fall back to email.
    } finally {
      setSocialBusy(null);
    }
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
      onDone({ isNewUser: true });
    } catch { /* authError shown via context */ }
    finally { setSubmitting(false); }
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password) return;
    setSubmitting(true); clearAuthError(); setLocalError(null);
    try {
      await signIn(email.trim(), password);
      onDone({ isNewUser: false });
    } catch { /* authError shown via context */ }
    finally { setSubmitting(false); }
  };

  const displayError = localError || authError;
  const hasSocial = appleAuthAvailable || googleAuthAvailable;

  const socialButton = (provider: 'apple' | 'google') => (
    <TouchableOpacity
      key={provider}
      onPress={() => handleSocial(provider)}
      disabled={socialBusy !== null}
      accessibilityRole="button"
      accessibilityLabel={provider === 'apple' ? 'Continue with Apple' : 'Continue with Google'}
      style={{
        backgroundColor: '#fff', borderRadius: 14, paddingVertical: 15,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        opacity: socialBusy && socialBusy !== provider ? 0.5 : 1,
      }}
    >
      {socialBusy === provider
        ? <ActivityIndicator size="small" color="#000"/>
        : <>
            {provider === 'apple' ? <AppleLogo/> : <GoogleLogo/>}
            <Text style={{ color: '#000', fontSize: 16, fontFamily: FONTS.medium }}>
              Continue with {provider === 'apple' ? 'Apple' : 'Google'}
            </Text>
          </>}
    </TouchableOpacity>
  );

  // ── Landing — social first, email second, always dismissible ───────
  if (mode === 'landing') {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
        <SafeAreaView style={{ flex: 1, paddingHorizontal: 28 }}>
          {/* Close — dismissing returns to browsing, never a dead end */}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 8 }}>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{ padding: 8 }}
            >
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path d="M18 6L6 18M6 6l12 12" stroke="rgba(255,255,255,0.5)" strokeWidth={2} strokeLinecap="round"/>
              </Svg>
            </TouchableOpacity>
          </View>

          <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}>
            <View style={{ position: 'absolute', width: 280, height: 280, borderRadius: 140, backgroundColor: '#2a7a5a', opacity: 0.08 }}/>
            <Text style={{ color: '#2a7a5a', fontSize: 56, fontFamily: FONTS.display, letterSpacing: -3, marginBottom: 16 }}>wugi</Text>
            <Text style={{ color: '#fff', fontSize: 24, fontFamily: FONTS.display, textAlign: 'center', marginBottom: 10 }}>
              {copy.title}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15, fontFamily: FONTS.body, textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 }}>
              {copy.subtitle}
            </Text>
            {displayError && (
              <View style={{ backgroundColor: '#e74c3c22', borderRadius: 10, padding: 12, marginTop: 16, borderWidth: 1, borderColor: '#e74c3c44', alignSelf: 'stretch' }}>
                <Text style={{ color: '#e74c3c', fontSize: 13, fontFamily: FONTS.medium, textAlign: 'center' }}>{displayError}</Text>
              </View>
            )}
          </View>

          <View style={{ gap: 12, paddingBottom: 24 }}>
            {appleAuthAvailable  && socialButton('apple')}
            {googleAuthAvailable && socialButton('google')}

            {/* Email path — primary when no social is available */}
            <TouchableOpacity
              onPress={() => switchMode('signup')}
              accessibilityRole="button"
              style={hasSocial
                ? { borderRadius: 14, paddingVertical: 15, alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)' }
                : { backgroundColor: '#2a7a5a', borderRadius: 14, paddingVertical: 16, alignItems: 'center', shadowColor: '#2a7a5a', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontFamily: FONTS.medium }}>Continue with email</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => switchMode('signin')} style={{ alignItems: 'center', paddingVertical: 12 }} accessibilityRole="button">
              <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, fontFamily: FONTS.body }}>
                Already have an account? <Text style={{ color: '#2a7a5a', fontFamily: FONTS.medium }}>Sign in</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Shared field style helpers ─────────────────────────────────────
  const fieldBox = { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 14, paddingVertical: 14 };
  const label    = { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontFamily: FONTS.bold, marginBottom: 6, letterSpacing: 0.8 };
  const inputStyle = { flex: 1, color: '#fff', fontSize: 15, padding: 0 };
  const isSignup = mode === 'signup';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#0a0a0a' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

      <SafeAreaView style={{ flex: 1 }}>
        <TouchableOpacity onPress={() => switchMode('landing')}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Path d="M19 12H5M12 5l-7 7 7 7" stroke="rgba(255,255,255,0.5)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
          </Svg>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginLeft: 6, fontFamily: FONTS.body }}>Back</Text>
        </TouchableOpacity>

        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center', paddingTop: 32, paddingBottom: 28 }}>
            <Text style={{ color: '#2a7a5a', fontSize: 36, fontFamily: FONTS.display, letterSpacing: -1.5, marginBottom: 10 }}>wugi</Text>
            <Text style={{ color: '#fff', fontSize: 22, fontFamily: FONTS.display, marginBottom: 8 }}>{isSignup ? 'Create your account' : 'Welcome back'}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, fontFamily: FONTS.body, textAlign: 'center', lineHeight: 20 }}>
              {isSignup ? copy.subtitle : 'Sign in to access your saved spots and passes'}
            </Text>
          </View>

          {/* Error banner */}
          {displayError && (
            <View style={{ backgroundColor: '#e74c3c22', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#e74c3c44' }}>
              <Text style={{ color: '#e74c3c', fontSize: 13, fontFamily: FONTS.medium, textAlign: 'center' }}>{displayError}</Text>
            </View>
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
                <TextInput ref={emailRef} placeholder="you@email.com" placeholderTextColor="rgba(255,255,255,0.25)" value={email} onChangeText={t => { setEmail(t); clearAuthError(); setLocalError(null); }} style={inputStyle} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={() => setTimeout(() => passRef.current?.focus(), 50)} inputAccessoryViewID={KB_ACCESSORY_ID}/>
              </View>
            </View>

            {/* Password */}
            <View>
              <Text style={label}>PASSWORD</Text>
              <View style={fieldBox}>
                <TextInput ref={passRef} placeholder="••••••••" placeholderTextColor="rgba(255,255,255,0.25)" value={password} onChangeText={t => { setPassword(t); clearAuthError(); setLocalError(null); }} secureTextEntry={!showPassword} style={inputStyle} autoCapitalize="none" autoComplete="off" textContentType="none" returnKeyType={isSignup ? 'next' : 'done'} onSubmitEditing={isSignup ? () => setTimeout(() => confirmRef.current?.focus(), 50) : handleSignIn} inputAccessoryViewID={KB_ACCESSORY_ID}/>
                <TouchableOpacity onPress={() => setShowPassword(p => !p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <EyeIcon off={showPassword}/>
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
                  <Text style={{ color: STRENGTH_COLOR[strength.level], fontSize: 11, fontFamily: FONTS.bold, marginBottom: 4 }}>{STRENGTH_LABEL[strength.level]}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {[
                      { key: 'length',  label: '8+ chars' },
                      { key: 'upper',   label: 'Uppercase' },
                      { key: 'number',  label: 'Number' },
                      { key: 'special', label: 'Symbol' },
                    ].map(r => (
                      <Text key={r.key} style={{ fontSize: 11, color: (strength.checks as any)[r.key] ? '#2a7a5a' : 'rgba(255,255,255,0.3)', fontFamily: FONTS.medium }}>
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
                    <EyeIcon off={showConfirm}/>
                  </TouchableOpacity>
                </View>
                {confirmPassword.length > 0 && confirmPassword !== password && (
                  <Text style={{ color: '#e74c3c', fontSize: 11, fontFamily: FONTS.medium, marginTop: 4 }}>Passwords don't match</Text>
                )}
              </View>
            )}

            {/* Submit */}
            <TouchableOpacity
              style={{ backgroundColor: '#2a7a5a', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8, opacity: submitting ? 0.7 : 1, shadowColor: '#2a7a5a', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}
              onPress={isSignup ? handleSignUp : handleSignIn}
              disabled={submitting}
              accessibilityRole="button"
            >
              {submitting ? <ActivityIndicator color="#fff" size="small"/> : <Text style={{ color: '#fff', fontSize: 16, fontFamily: FONTS.bold }}>{isSignup ? 'Create Account' : 'Sign In'}</Text>}
            </TouchableOpacity>

            {/* Forgot password */}
            <TouchableOpacity
              onPress={() => onForgotPassword(email)}
              style={{ alignItems: 'center', paddingVertical: 6 }}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
              accessibilityRole="button"
            >
              <Text style={{ color: '#2a7a5a', fontSize: 13, fontFamily: FONTS.medium }}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={{ alignItems: 'center', marginTop: 24 }} onPress={() => switchMode(isSignup ? 'signin' : 'signup')} accessibilityRole="button">
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, fontFamily: FONTS.body }}>
              {isSignup ? 'Already have an account? ' : "Don't have an account? "}
              <Text style={{ color: '#2a7a5a', fontFamily: FONTS.bold }}>{isSignup ? 'Sign In' : 'Sign Up'}</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
