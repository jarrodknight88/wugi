// ─────────────────────────────────────────────────────────────────────
// Wugi — AccountScreen
// Wired to Firebase Auth via FirebaseContext
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  SafeAreaView, TextInput, ActivityIndicator, Alert,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import type { Theme } from '../constants/colors';
import { useFirebase } from '../context/FirebaseContext';
import { ChevronRightIcon } from '../components/icons';

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
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [displayName,  setDisplayName]  = useState('');
  const [isSignUp,     setIsSignUp]     = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting,   setSubmitting]   = useState(false);

  // Settings state
  const [notifyEvents,    setNotifyEvents]    = useState(true);
  const [notifyDeals,     setNotifyDeals]     = useState(true);
  const [notifyGalleries, setNotifyGalleries] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(true);

  const selectedVibes = userVibes;

  const toggleVibe = async (label: string) => {
    const next = selectedVibes.includes(label)
      ? selectedVibes.filter(v => v !== label)
      : [...selectedVibes, label];
    await saveVibes(next);
  };

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    if (isSignUp && !displayName.trim()) {
      Alert.alert('Missing fields', 'Please enter your full name.');
      return;
    }
    setSubmitting(true);
    clearAuthError();
    try {
      if (isSignUp) await signUp(email.trim(), password, displayName.trim());
      else          await signIn(email.trim(), password);
    } catch (e) {
      // Error is shown via authError from context
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const ToggleRow = ({ label, value, onToggle, subtitle }: { label: string; value: boolean; onToggle: () => void; subtitle?: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
        {subtitle && <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 2 }}>{subtitle}</Text>}
      </View>
      <TouchableOpacity onPress={onToggle} style={{ width: 48, height: 28, borderRadius: 14, backgroundColor: value ? theme.accent : theme.border, justifyContent: 'center', paddingHorizontal: 3 }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignSelf: value ? 'flex-end' : 'flex-start', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }}/>
      </TouchableOpacity>
    </View>
  );

  // ── Logged out — Auth screen ──────────────────────────────────────────
  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">

            <View style={{ alignItems: 'center', paddingTop: 60, paddingBottom: 40 }}>
              <Text style={{ color: theme.accent, fontSize: 48, fontWeight: '900', letterSpacing: -2, marginBottom: 8 }}>wugi</Text>
              <Text style={{ color: theme.text, fontSize: 22, fontWeight: '800', marginBottom: 8 }}>
                {isSignUp ? 'Create your account' : 'Welcome back'}
              </Text>
              <Text style={{ color: theme.subtext, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
                {isSignUp ? "Join Atlanta's most vibrant nightlife community" : 'Sign in to access your saved spots and preferences'}
              </Text>
            </View>

            {/* Error banner */}
            {authError && (
              <View style={{ backgroundColor: '#e74c3c22', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#e74c3c44' }}>
                <Text style={{ color: '#e74c3c', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>{authError}</Text>
              </View>
            )}

            <View style={{ gap: 12 }}>
              {isSignUp && (
                <View>
                  <Text style={{ color: theme.subtext, fontSize: 12, fontWeight: '600', marginBottom: 6, letterSpacing: 0.3 }}>FULL NAME</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 14 }}>
                    <TextInput
                      placeholder="Jarrod Knight"
                      placeholderTextColor={theme.subtext}
                      value={displayName}
                      onChangeText={setDisplayName}
                      style={{ flex: 1, color: theme.text, fontSize: 15, padding: 0 }}
                      autoCapitalize="words"
                    />
                  </View>
                </View>
              )}

              <View>
                <Text style={{ color: theme.subtext, fontSize: 12, fontWeight: '600', marginBottom: 6, letterSpacing: 0.3 }}>EMAIL</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 14 }}>
                  <TextInput
                    placeholder="you@email.com"
                    placeholderTextColor={theme.subtext}
                    value={email}
                    onChangeText={t => { setEmail(t); clearAuthError(); }}
                    style={{ flex: 1, color: theme.text, fontSize: 15, padding: 0 }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View>
                <Text style={{ color: theme.subtext, fontSize: 12, fontWeight: '600', marginBottom: 6, letterSpacing: 0.3 }}>PASSWORD</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 14 }}>
                  <TextInput
                    placeholder="••••••••"
                    placeholderTextColor={theme.subtext}
                    value={password}
                    onChangeText={t => { setPassword(t); clearAuthError(); }}
                    secureTextEntry={!showPassword}
                    style={{ flex: 1, color: theme.text, fontSize: 15, padding: 0 }}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => setShowPassword(p => !p)}>
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                      {showPassword
                        ? (<><Path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" stroke={theme.subtext} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Path d="M1 1l22 22" stroke={theme.subtext} strokeWidth={1.8} strokeLinecap="round"/></>)
                        : (<><Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke={theme.subtext} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/><Circle cx={12} cy={12} r={3} stroke={theme.subtext} strokeWidth={1.8}/></>)
                      }
                    </Svg>
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                style={{ backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8, opacity: submitting ? 0.7 : 1 }}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" size="small"/>
                  : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{isSignUp ? 'Create Account' : 'Sign In'}</Text>
                }
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={{ alignItems: 'center', marginTop: 24 }} onPress={() => { setIsSignUp(p => !p); clearAuthError(); }}>
              <Text style={{ color: theme.subtext, fontSize: 14 }}>
                {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
                <Text style={{ color: theme.accent, fontWeight: '700' }}>{isSignUp ? 'Sign In' : 'Sign Up'}</Text>
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
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '900', letterSpacing: -0.5 }}>Account</Text>
          <View style={{ width: 36 }}/>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Avatar */}
        <View style={{ alignItems: 'center', paddingVertical: 28, paddingHorizontal: 24 }}>
          <View style={{ position: 'relative', marginBottom: 14 }}>
            <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: theme.card, borderWidth: 2, borderColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 32 }}>👤</Text>
            </View>
          </View>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800', marginBottom: 4 }}>
            {user.displayName || 'Wugi User'}
          </Text>
          <Text style={{ color: theme.subtext, fontSize: 13 }}>{user.email}</Text>
        </View>

        {/* Vibes */}
        <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800', marginBottom: 4 }}>My Vibes</Text>
          <Text style={{ color: theme.subtext, fontSize: 12, marginBottom: 14 }}>We use these to personalize your For You feed</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ACCOUNT_VIBES.map(vibe => {
              const active = selectedVibes.includes(vibe.label);
              return (
                <TouchableOpacity
                  key={vibe.label}
                  onPress={() => toggleVibe(vibe.label)}
                  style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: active ? vibe.accent : theme.card, borderWidth: 1.5, borderColor: active ? vibe.accent : theme.border, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: active ? '#fff' : vibe.accent }}/>
                  <Text style={{ color: active ? '#fff' : theme.subtext, fontSize: 13, fontWeight: '600' }}>{vibe.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Notifications */}
        <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800', marginBottom: 16 }}>Notifications</Text>
          <ToggleRow label="New Events"       subtitle="Get notified when new events are added"  value={notifyEvents}    onToggle={() => setNotifyEvents(p => !p)}/>
          <ToggleRow label="Deals & Specials" subtitle="Flash deals and happy hour alerts"        value={notifyDeals}    onToggle={() => setNotifyDeals(p => !p)}/>
          <ToggleRow label="New Galleries"    subtitle="When event photos are published"          value={notifyGalleries} onToggle={() => setNotifyGalleries(p => !p)}/>
        </View>

        {/* App Settings */}
        <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800', marginBottom: 16 }}>App Settings</Text>
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
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }}>My Passes</Text>
                <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 1 }}>View your event tickets</Text>
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
            <Text style={{ color: '#e74c3c', fontSize: 15, fontWeight: '700' }}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
