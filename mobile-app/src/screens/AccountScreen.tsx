// ─────────────────────────────────────────────────────────────────────
// Wugi — AccountScreen
// Wired to Firebase Auth via FirebaseContext
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  SafeAreaView, TextInput, ActivityIndicator, Alert, Linking,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { OneSignal } from 'react-native-onesignal';
import type { Theme } from '../constants/colors';
import { useFirebase } from '../context/FirebaseContext';
import { ChevronRightIcon } from '../components/icons';
import { checkUsernameAvailable, saveUsername, getUserProfile } from '../../firestoreService';
import { getAuth, sendPasswordResetEmail } from '@react-native-firebase/auth';
import { FONTS, MONO } from '../constants/fonts';

// ── Password strength (mirrors SignupScreen) ──────────────────────────
type StrengthLevel = 'weak' | 'fair' | 'strong';
function getPasswordStrength(pw: string): { level: StrengthLevel; score: number; checks: Record<string, boolean> } {
  const checks = { length: pw.length >= 8, upper: /[A-Z]/.test(pw), lower: /[a-z]/.test(pw), number: /[0-9]/.test(pw), special: /[^A-Za-z0-9]/.test(pw) };
  const score = Object.values(checks).filter(Boolean).length;
  return { level: score <= 2 ? 'weak' : score <= 3 ? 'fair' : 'strong', score, checks };
}
const SC = { weak: '#e74c3c', fair: '#f39c12', strong: '#2a7a5a' };
const SL = { weak: 'Weak', fair: 'Fair', strong: 'Strong' };

const ACCOUNT_VIBES = [
  { label: 'Boujee',      accent: '#9b59b6' },
  { label: 'Divey',       accent: '#e67e22' },
  { label: 'Speakeasy',   accent: '#95a5a6' },
  { label: 'High Energy', accent: '#e74c3c' },
  { label: 'Rooftop',     accent: '#3498db' },
  { label: 'Late Night',  accent: '#2980b9' },
];

type Props = {
  theme:         Theme;
  onViewPasses?: () => void;
};

export function AccountScreen({ theme, onViewPasses }: Props) {
  const { user, userVibes, saveVibes, signIn, signUp, signOut, authError, clearAuthError } = useFirebase();

  // Auth form state
  const [email,           setEmail]           = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName,     setDisplayName]     = useState('');
  const [isSignUp,        setIsSignUp]        = useState(false);
  const [showPassword,    setShowPassword]    = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);
  const [submitting,      setSubmitting]      = useState(false);
  const [localError,      setLocalError]      = useState<string | null>(null);
  const [resetSent,       setResetSent]       = useState(false);

  // Username state (for users who skipped)
  const [savedUsername,    setSavedUsername]   = useState<string | null>(null);
  const [usernameInput,    setUsernameInput]   = useState('');
  const [usernameStatus,   setUsernameStatus]  = useState<'idle'|'checking'|'available'|'taken'|'saving'>('idle');
  const [showUsernamePicker, setShowUsernamePicker] = useState(false);
  const usernameDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const strength = getPasswordStrength(password);

  // Settings state
  const [notifyEnabled,   setNotifyEnabled]   = useState(true);
  const [notifyEvents,    setNotifyEvents]    = useState(true);
  const [notifyDeals,     setNotifyDeals]     = useState(true);
  const [notifyGalleries, setNotifyGalleries] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(true);
  const [notifPermission, setNotifPermission] = useState<'authorized' | 'denied' | 'unknown'>('unknown');

  // Check notification permission on mount + load saved username
  useEffect(() => {
    // Use OneSignal to check real-time permission state
    OneSignal.Notifications.getPermissionAsync().then((granted: boolean) => {
      if (granted) setNotifPermission('authorized');
      else {
        // Check if user has been asked before (denied vs never asked)
        // On iOS, if not granted and previously asked, it's denied
        // We use canRequestPermission to distinguish unknown vs denied
        OneSignal.Notifications.canRequestPermission().then((canRequest: boolean) => {
          setNotifPermission(canRequest ? 'unknown' : 'denied');
        });
      }
    });
    if (user) {
      getUserProfile(user.uid).then(p => { if (p?.username) setSavedUsername(p.username); });
    }
  }, [user]);

  // Username availability debounce
  useEffect(() => {
    if (usernameDebounce.current) clearTimeout(usernameDebounce.current);
    if (!usernameInput || usernameInput.length < 3) { setUsernameStatus('idle'); return; }
    setUsernameStatus('checking');
    usernameDebounce.current = setTimeout(async () => {
      const available = await checkUsernameAvailable(usernameInput);
      setUsernameStatus(available ? 'available' : 'taken');
    }, 500);
    return () => { if (usernameDebounce.current) clearTimeout(usernameDebounce.current); };
  }, [usernameInput]);

  const selectedVibes = userVibes;

  const toggleVibe = async (label: string) => {
    const next = selectedVibes.includes(label)
      ? selectedVibes.filter(v => v !== label)
      : [...selectedVibes, label];
    await saveVibes(next);
  };

  const handleSubmit = async () => {
    setLocalError(null);
    if (!email.trim() || !password.trim()) { setLocalError('Please enter your email and password.'); return; }
    if (isSignUp && !displayName.trim()) { setLocalError('Please enter your full name.'); return; }
    if (isSignUp && password !== confirmPassword) { setLocalError('Passwords do not match.'); return; }
    if (isSignUp && strength.level === 'weak') { setLocalError('Password is too weak. Add uppercase, numbers, or symbols.'); return; }
    setSubmitting(true); clearAuthError();
    try {
      if (isSignUp) await signUp(email.trim(), password, displayName.trim());
      else          await signIn(email.trim(), password);
    } catch {}
    finally { setSubmitting(false); }
  };

  const handleSaveUsername = async () => {
    if (!user || usernameStatus !== 'available') return;
    setUsernameStatus('saving');
    try {
      await saveUsername(user.uid, usernameInput);
      setSavedUsername(usernameInput);
      setShowUsernamePicker(false);
      setUsernameInput('');
    } catch (e: any) {
      setUsernameStatus('taken');
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) { setLocalError('Enter your email above first.'); return; }
    try {
      await sendPasswordResetEmail(getAuth(), email.trim());
      setResetSent(true); setLocalError(null);
    } catch { setLocalError('Could not send reset email. Check the address.'); }
  };

  const showForgotLink = !resetSent && !isSignUp &&
    (authError?.toLowerCase().includes('incorrect') || authError?.toLowerCase().includes('password'));

  const handleSignOut = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const ToggleRow = ({ label, value, onToggle, subtitle }: { label: string; value: boolean; onToggle: () => void; subtitle?: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={{ color: theme.text, fontSize: 14, fontFamily: FONTS.medium }}>{label}</Text>
        {subtitle && <Text style={{ color: theme.subtext, fontSize: 12, fontFamily: FONTS.body, marginTop: 2 }}>{subtitle}</Text>}
      </View>
      <TouchableOpacity onPress={onToggle} style={{ width: 48, height: 28, borderRadius: 14, backgroundColor: value ? theme.accent : theme.border, justifyContent: 'center', paddingHorizontal: 3 }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignSelf: value ? 'flex-end' : 'flex-start', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }}/>
      </TouchableOpacity>
    </View>
  );

  // ── Logged out — Auth screen ──────────────────────────────────────────
  if (!user) {
    const fBox = { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 14 };
    const lbl  = { color: theme.subtext, fontSize: 11, fontFamily: MONO, marginBottom: 6, letterSpacing: 0.5 };
    const inp  = { flex: 1, color: theme.text, fontSize: 15, fontFamily: FONTS.body, padding: 0 };
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <View style={{ alignItems: 'center', paddingTop: 60, paddingBottom: 32 }}>
              <Text style={{ color: theme.accent, fontSize: 48, fontFamily: FONTS.display, letterSpacing: -2, marginBottom: 8 }}>wugi</Text>
              <Text style={{ color: theme.text, fontSize: 22, fontFamily: FONTS.display, marginBottom: 8 }}>{isSignUp ? 'Create your account' : 'Welcome back'}</Text>
              <Text style={{ color: theme.subtext, fontSize: 14, fontFamily: FONTS.body, textAlign: 'center', lineHeight: 20 }}>
                {isSignUp ? "Join Atlanta's most vibrant nightlife community" : 'Sign in to access your saved spots and passes'}
              </Text>
            </View>

            {/* Banners */}
            {resetSent && <View style={{ backgroundColor: '#2a7a5a22', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#2a7a5a44' }}><Text style={{ color: '#2a7a5a', fontSize: 13, fontFamily: FONTS.medium, textAlign: 'center' }}>Reset email sent! Check your inbox.</Text></View>}
            {(localError || authError) && !resetSent && <View style={{ backgroundColor: '#e74c3c22', borderRadius: 10, padding: 12, marginBottom: 4, borderWidth: 1, borderColor: '#e74c3c44' }}><Text style={{ color: '#e74c3c', fontSize: 13, fontFamily: FONTS.medium, textAlign: 'center' }}>{localError || authError}</Text></View>}
            {showForgotLink && <TouchableOpacity onPress={handleForgotPassword} style={{ alignItems: 'center', marginBottom: 16 }}><Text style={{ color: theme.accent, fontSize: 13, fontFamily: FONTS.medium }}>Forgot password? Send reset email →</Text></TouchableOpacity>}

            <View style={{ gap: 14 }}>
              {isSignUp && (
                <View><Text style={lbl}>FULL NAME</Text>
                  <View style={fBox}><TextInput placeholder="Your name" placeholderTextColor={theme.subtext} value={displayName} onChangeText={setDisplayName} style={inp} autoCapitalize="words" returnKeyType="next"/></View>
                </View>
              )}
              <View><Text style={lbl}>EMAIL</Text>
                <View style={fBox}><TextInput placeholder="you@email.com" placeholderTextColor={theme.subtext} value={email} onChangeText={t => { setEmail(t); clearAuthError(); setLocalError(null); setResetSent(false); }} style={inp} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} returnKeyType="next"/></View>
              </View>
              <View>
                <Text style={lbl}>PASSWORD</Text>
                <View style={fBox}>
                  <TextInput placeholder="••••••••" placeholderTextColor={theme.subtext} value={password} onChangeText={t => { setPassword(t); clearAuthError(); setLocalError(null); }} secureTextEntry={!showPassword} style={inp} autoCapitalize="none" autoComplete="off" textContentType="none" returnKeyType={isSignUp ? 'next' : 'done'} onSubmitEditing={isSignUp ? undefined : handleSubmit}/>
                  <TouchableOpacity onPress={() => setShowPassword(p => !p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                      {showPassword ? (<><Path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" stroke={theme.subtext} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Path d="M1 1l22 22" stroke={theme.subtext} strokeWidth={1.8} strokeLinecap="round"/></>) : (<><Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke={theme.subtext} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Circle cx={12} cy={12} r={3} stroke={theme.subtext} strokeWidth={1.8}/></>)}
                    </Svg>
                  </TouchableOpacity>
                </View>
                {isSignUp && password.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>{[1,2,3,4,5].map(i => <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= strength.score ? SC[strength.level] : theme.border }}/>)}</View>
                    <Text style={{ color: SC[strength.level], fontSize: 11, fontFamily: FONTS.medium, marginBottom: 4 }}>{SL[strength.level]}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {[{ key: 'length', label: '8+ chars' }, { key: 'upper', label: 'Uppercase' }, { key: 'number', label: 'Number' }, { key: 'special', label: 'Symbol' }].map(r => (
                        <Text key={r.key} style={{ fontSize: 11, color: (strength.checks as any)[r.key] ? '#2a7a5a' : theme.subtext, fontFamily: FONTS.body }}>{(strength.checks as any)[r.key] ? '✓' : '○'} {r.label}</Text>
                      ))}
                    </View>
                  </View>
                )}
              </View>
              {isSignUp && (
                <View><Text style={lbl}>CONFIRM PASSWORD</Text>
                  <View style={{ ...fBox, borderColor: confirmPassword && confirmPassword !== password ? '#e74c3c' : theme.border }}>
                    <TextInput placeholder="••••••••" placeholderTextColor={theme.subtext} value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry={!showConfirm} style={inp} autoCapitalize="none" autoComplete="off" textContentType="none" returnKeyType="done" onSubmitEditing={handleSubmit}/>
                    <TouchableOpacity onPress={() => setShowConfirm(p => !p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                        {showConfirm ? (<><Path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" stroke={theme.subtext} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Path d="M1 1l22 22" stroke={theme.subtext} strokeWidth={1.8} strokeLinecap="round"/></>) : (<><Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke={theme.subtext} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Circle cx={12} cy={12} r={3} stroke={theme.subtext} strokeWidth={1.8}/></>)}
                      </Svg>
                    </TouchableOpacity>
                  </View>
                  {confirmPassword.length > 0 && confirmPassword !== password && <Text style={{ color: '#e74c3c', fontSize: 11, fontFamily: FONTS.medium, marginTop: 4 }}>Passwords don't match</Text>}
                </View>
              )}
              <TouchableOpacity style={{ backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8, opacity: submitting ? 0.7 : 1 }} onPress={handleSubmit} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" size="small"/> : <Text style={{ color: '#fff', fontSize: 16, fontFamily: FONTS.medium }}>{isSignUp ? 'Create Account' : 'Sign In'}</Text>}
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={{ alignItems: 'center', marginTop: 24 }} onPress={() => { setIsSignUp(p => !p); clearAuthError(); setLocalError(null); setConfirmPassword(''); setResetSent(false); }}>
              <Text style={{ color: theme.subtext, fontSize: 14, fontFamily: FONTS.body }}>
                {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
                <Text style={{ color: theme.accent, fontFamily: FONTS.medium }}>{isSignUp ? 'Sign In' : 'Sign Up'}</Text>
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // ── Logged in — Account screen ────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 36 }}/>
          <Text style={{ color: theme.text, fontSize: 20, fontFamily: FONTS.display, letterSpacing: -0.5 }}>Account</Text>
          <View style={{ width: 36 }}/>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Avatar — initials badge matching design */}
        <View style={{ alignItems: 'center', paddingTop: 28, paddingBottom: 20, paddingHorizontal: 24 }}>
          <View style={{
            width: 84, height: 84, borderRadius: 42,
            backgroundColor: theme.accent,
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 12,
            shadowColor: theme.accent, shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
          }}>
            <Text style={{ color: '#f4efe1', fontSize: 28, fontFamily: FONTS.display, letterSpacing: -1 }}>
              {(user.displayName || 'W').split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
            </Text>
          </View>
          <Text style={{ color: theme.text, fontSize: 20, fontFamily: FONTS.display, letterSpacing: -0.4, marginBottom: 3 }}>
            {user.displayName || 'Wugi User'}
          </Text>
          <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body }}>{user.email}</Text>
        </View>

        {/* Username section */}
        <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
          {savedUsername ? (
            <TouchableOpacity
              onPress={() => setShowUsernamePicker(p => !p)}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 16, paddingVertical: 14 }}
            >
              <View>
                <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.5, marginBottom: 2 }}>USERNAME</Text>
                <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.display }}>@{savedUsername}</Text>
              </View>
              <Text style={{ color: theme.accent, fontSize: 13, fontFamily: FONTS.medium }}>Change</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => setShowUsernamePicker(true)}
              style={{ backgroundColor: theme.accent + '22', borderRadius: 12, borderWidth: 1, borderColor: theme.accent + '44', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <View>
                <Text style={{ color: theme.accent, fontSize: 14, fontFamily: FONTS.display, marginBottom: 2 }}>Claim your username</Text>
                <Text style={{ color: theme.subtext, fontSize: 12, fontFamily: FONTS.body }}>Choose how you appear on Wugi</Text>
              </View>
              <Text style={{ color: theme.accent, fontSize: 18 }}>→</Text>
            </TouchableOpacity>
          )}
          {showUsernamePicker && (
            <View style={{ marginTop: 12, backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 16 }}>
              <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.5, marginBottom: 8 }}>NEW USERNAME</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bg, borderRadius: 10, borderWidth: 1, borderColor: usernameStatus === 'available' ? '#2a7a5a' : usernameStatus === 'taken' ? '#e74c3c' : theme.border, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8 }}>
                <Text style={{ color: theme.subtext, fontSize: 15, marginRight: 2 }}>@</Text>
                <TextInput placeholder="yourname" placeholderTextColor={theme.subtext} value={usernameInput} onChangeText={t => setUsernameInput(t.toLowerCase().replace(/\s/g, ''))} style={{ flex: 1, color: theme.text, fontSize: 15, padding: 0 }} autoCapitalize="none" autoCorrect={false} maxLength={20}/>
                {usernameStatus === 'checking' && <ActivityIndicator size="small" color={theme.accent}/>}
              </View>
              {usernameStatus === 'available' && <Text style={{ color: '#2a7a5a', fontSize: 12, fontFamily: FONTS.medium, marginBottom: 8 }}>✓ Available</Text>}
              {usernameStatus === 'taken' && <Text style={{ color: '#e74c3c', fontSize: 12, fontFamily: FONTS.medium, marginBottom: 8 }}>✗ Already taken</Text>}
              <TouchableOpacity
                onPress={handleSaveUsername}
                disabled={usernameStatus !== 'available'}
                style={{ backgroundColor: usernameStatus === 'available' ? theme.accent : theme.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontFamily: FONTS.medium }}>{usernameStatus === 'saving' ? 'Saving…' : 'Save Username'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
          <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.5, marginBottom: 4 }}>YOUR VIBES</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, letterSpacing: -0.3 }}>What you're into</Text>
          </View>
          <View style={{ backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {ACCOUNT_VIBES.map(vibe => {
                const active = selectedVibes.includes(vibe.label);
                return (
                  <TouchableOpacity
                    key={vibe.label}
                    onPress={() => toggleVibe(vibe.label)}
                    style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: active ? vibe.accent : 'transparent', borderWidth: 1, borderColor: active ? vibe.accent : theme.border + 'aa', flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  >
                    <Text style={{ color: active ? '#f4efe1' : theme.subtext, fontSize: 13, fontFamily: active ? FONTS.medium : FONTS.body }}>{vibe.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* Notifications */}
        <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
          <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, letterSpacing: 0.5, marginBottom: 4 }}>SETTINGS</Text>
          <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, letterSpacing: -0.3, marginBottom: 16 }}>Notifications</Text>

          {notifPermission === 'denied' ? (
            // Denied — show Go to Settings button
            <View style={{ backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 16 }}>
              <Text style={{ color: theme.text, fontSize: 14, fontFamily: FONTS.display, marginBottom: 4 }}>Notifications are disabled</Text>
              <Text style={{ color: theme.subtext, fontSize: 12, fontFamily: FONTS.body, marginBottom: 14, lineHeight: 18 }}>
                Enable notifications in iOS Settings to get alerts for new events, deals, and galleries.
              </Text>
              <TouchableOpacity
                onPress={() => Linking.openSettings()}
                style={{ backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontFamily: FONTS.medium }}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          ) : notifPermission === 'unknown' ? (
            // Not yet asked — show Enable button
            <View style={{ backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 16 }}>
              <Text style={{ color: theme.text, fontSize: 14, fontFamily: FONTS.display, marginBottom: 4 }}>Stay in the loop</Text>
              <Text style={{ color: theme.subtext, fontSize: 12, fontFamily: FONTS.body, marginBottom: 14, lineHeight: 18 }}>
                Get notified about new events, deals, and photo galleries from your favorite Atlanta venues.
              </Text>
              <TouchableOpacity
                onPress={async () => {
                  const granted = await OneSignal.Notifications.requestPermission(true);
                  setNotifPermission(granted ? 'authorized' : 'denied');
                }}
                style={{ backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontFamily: FONTS.medium }}>Enable Notifications</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Authorized — master toggle + collapsible sub-options
            <>
              {/* Master toggle */}
              <ToggleRow
                label="Notifications"
                subtitle={notifyEnabled ? 'On — tap to manage' : 'All notifications off'}
                value={notifyEnabled}
                onToggle={() => {
                  const next = !notifyEnabled;
                  setNotifyEnabled(next);
                  // Sync with OneSignal
                  OneSignal.User.pushSubscription.optIn();
                  if (!next) {
                    setNotifyEvents(false);
                    setNotifyDeals(false);
                    setNotifyGalleries(false);
                    OneSignal.User.addTags({ events: 'off', deals: 'off', galleries: 'off' });
                  } else {
                    setNotifyEvents(true);
                    setNotifyDeals(true);
                    OneSignal.User.addTags({ events: 'on', deals: 'on' });
                  }
                }}
              />
              {/* Sub-options — only show when master is on */}
              {notifyEnabled && (
                <View style={{ marginLeft: 16, borderLeftWidth: 2, borderLeftColor: theme.divider, paddingLeft: 12, marginTop: 4 }}>
                  <ToggleRow label="New Events"       subtitle="When new events are added near you"  value={notifyEvents}    onToggle={() => { const n = !notifyEvents; setNotifyEvents(n); OneSignal.User.addTag('events', n ? 'on' : 'off'); }}/>
                  <ToggleRow label="Deals & Specials" subtitle="Flash deals and happy hour alerts"   value={notifyDeals}     onToggle={() => { const n = !notifyDeals; setNotifyDeals(n); OneSignal.User.addTag('deals', n ? 'on' : 'off'); }}/>
                  <ToggleRow label="New Galleries"    subtitle="When event photos are published"     value={notifyGalleries} onToggle={() => { const n = !notifyGalleries; setNotifyGalleries(n); OneSignal.User.addTag('galleries', n ? 'on' : 'off'); }}/>
                </View>
              )}
              <TouchableOpacity onPress={() => Linking.openSettings()} style={{ marginTop: 10 }}>
                <Text style={{ color: theme.subtext, fontSize: 12, fontFamily: FONTS.body }}>Manage in iOS Settings →</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* App Settings */}
        <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, letterSpacing: -0.3, marginBottom: 16 }}>App Settings</Text>
          <ToggleRow label="Location Services" subtitle="Used for Near Me and distance info" value={locationEnabled} onToggle={() => setLocationEnabled(p => !p)}/>
        </View>

        {/* My Passes */}
        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <TouchableOpacity
            onPress={onViewPasses}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, paddingHorizontal: 16, borderRadius: 12, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#9C27B022', alignItems: 'center', justifyContent: 'center' }}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h-3zM18 15h3v3h-3zM15 18h3v3h-3zM18 18h3v3h-3z" stroke="#9C27B0" strokeWidth={1.8}/>
                </Svg>
              </View>
              <View>
                <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.display }}>My Passes</Text>
                <Text style={{ color: theme.subtext, fontSize: 12, fontFamily: FONTS.body, marginTop: 1 }}>View your event tickets</Text>
              </View>
            </View>
            <ChevronRightIcon color={theme.subtext}/>
          </TouchableOpacity>
        </View>

        {/* Sign Out */}
        <View style={{ marginHorizontal: 16, marginBottom: 40 }}>
          <TouchableOpacity
            onPress={handleSignOut}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: '#e74c3c' }}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="#e74c3c" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
            <Text style={{ color: '#e74c3c', fontSize: 15, fontFamily: FONTS.medium }}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
