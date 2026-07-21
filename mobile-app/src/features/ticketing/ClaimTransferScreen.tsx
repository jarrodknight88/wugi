// ─────────────────────────────────────────────────────────────────────
// Wugi — ClaimTransferScreen
// Reached via the wugi://tickets/claim/{token} deep link (RootNavigator's
// Linking handler). Mirrors web/app/tickets/claim/[token]/ClaimForm.tsx so
// the in-app and browser claim flows feel identical — same fields, same
// copy, same claimTransfer Cloud Function.
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  SafeAreaView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';

const CLAIM_URL = 'https://us-central1-wugi-prod.cloudfunctions.net/claimTransfer';

type Props = {
  token:     string;
  userId:    string | null;
  userEmail: string;
  userName:  string;
  onClaimed: (orderId: string, isGuest: boolean) => void;
  onClose:   () => void;
};

export function ClaimTransferScreen({ token, userId, userEmail, userName, onClaimed, onClose }: Props) {
  const [name,    setName]    = useState(userName || '');
  const [email,   setEmail]   = useState(userEmail || '');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleAccept() {
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(CLAIM_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          token,
          claimerName:  name.trim() || email.trim(),
          claimerEmail: email.trim(),
          claimerUid:   userId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Claim failed');
      onClaimed(data.orderId, !userId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: '#111' }}>
        <SafeAreaView style={{ flex: 1 }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ color: '#aaa', fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>Accept Ticket</Text>
            <View style={{ width: 60 }}/>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <View style={{ backgroundColor: '#1a1a1a', borderRadius: 16, padding: 20, marginBottom: 24, borderWidth: 1, borderColor: '#2a2a2a', alignItems: 'center' }}>
              <Text style={{ fontSize: 40, marginBottom: 8 }}>🎟️</Text>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' }}>Someone sent you a ticket</Text>
              <Text style={{ color: '#888', fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 18 }}>
                Enter your info to claim it. Once accepted, it'll appear in your Wugi passes.
              </Text>
            </View>

            <Text style={{ color: '#888', fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8 }}>YOUR NAME (OPTIONAL)</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor="#555"
              style={{ backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: '#fff', fontSize: 16, marginBottom: 16 }}
            />

            <Text style={{ color: '#888', fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8 }}>YOUR EMAIL *</Text>
            <TextInput
              value={email}
              onChangeText={t => { setEmail(t); setError(''); }}
              placeholder="you@email.com"
              placeholderTextColor="#555"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={{ backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: error ? '#e74c3c' : '#2a2a2a', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: '#fff', fontSize: 16, marginBottom: 8 }}
            />
            {error ? <Text style={{ color: '#e74c3c', fontSize: 13, marginBottom: 16 }}>{error}</Text> : <View style={{ height: 16 }}/>}

            <View style={{ backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 24, borderWidth: 1, borderColor: '#2a2a2a', flexDirection: 'row', gap: 10 }}>
              <Text style={{ fontSize: 18 }}>⚠️</Text>
              <Text style={{ color: '#888', fontSize: 13, flex: 1, lineHeight: 18 }}>
                By accepting you agree to Wugi's no-refund policy. The original holder will lose access to this ticket.
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleAccept}
              disabled={loading}
              style={{ backgroundColor: '#2a7a5a', borderRadius: 14, paddingVertical: 16, alignItems: 'center', opacity: loading ? 0.7 : 1 }}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small"/>
                : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>✓ Accept Ticket</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    </KeyboardAvoidingView>
  );
}
