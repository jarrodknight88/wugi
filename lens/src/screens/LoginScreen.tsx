// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — LoginScreen
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  SafeAreaView, ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native'
import auth from '@react-native-firebase/auth'

type Props = { onLogin: () => void }

export function LoginScreen({ onLogin }: Props) {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleLogin() {
    if (!email.trim() || !password) { Alert.alert('Missing fields', 'Enter email and password'); return }
    setLoading(true)
    try {
      await auth().signInWithEmailAndPassword(email.trim(), password)
      onLogin()
    } catch (e: unknown) {
      Alert.alert('Login failed', e instanceof Error ? e.message : 'Check your credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 32 }}>
        {/* Logo */}
        <View style={{ alignItems: 'center', marginBottom: 48 }}>
          <Text style={{ color: '#2a7a5a', fontSize: 42, fontWeight: '900', letterSpacing: -2 }}>wugi</Text>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', letterSpacing: 4, marginTop: 4 }}>LENS</Text>
          <Text style={{ color: '#555', fontSize: 13, marginTop: 8 }}>Photographer Portal</Text>
        </View>

        {/* Form */}
        <View style={{ gap: 12 }}>
          <View>
            <Text style={{ color: '#777', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>EMAIL</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@email.com"
              placeholderTextColor="#444"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={{ backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: '#fff', fontSize: 15 }}
            />
          </View>
          <View>
            <Text style={{ color: '#777', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>PASSWORD</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#444"
              secureTextEntry
              style={{ backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: '#fff', fontSize: 15 }}
            />
          </View>

          <TouchableOpacity
            onPress={handleLogin}
            disabled={loading}
            style={{ backgroundColor: '#2a7a5a', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8, opacity: loading ? 0.7 : 1 }}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small"/>
              : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Sign In</Text>
            }
          </TouchableOpacity>
        </View>

        <Text style={{ color: '#444', fontSize: 12, textAlign: 'center', marginTop: 32 }}>
          Wugi Lens is for authorized photographers only.
        </Text>
      </SafeAreaView>
    </KeyboardAvoidingView>
  )
}
