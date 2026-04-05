// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — App.tsx
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, Component } from 'react'
import { View, Text, ActivityIndicator, TouchableOpacity, SafeAreaView, ScrollView } from 'react-native'
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { LoginScreen }         from './src/screens/LoginScreen'
import { EventSelectorScreen } from './src/screens/EventSelectorScreen'
import { LiveFeedScreen }      from './src/screens/LiveFeedScreen'
import { SettingsScreen }      from './src/screens/SettingsScreen'
import type { LensEvent } from './src/types'

// ── Error Boundary ────────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0a0a0a', padding: 32, justifyContent: 'center' }}>
          <Text style={{ color: '#ef4444', fontSize: 16, fontWeight: '700', marginBottom: 12 }}>
            Wugi Lens crashed
          </Text>
          <ScrollView>
            <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'Courier' }}>
              {this.state.error?.message}
            </Text>
            <Text style={{ color: '#666', fontSize: 11, marginTop: 12, fontFamily: 'Courier' }}>
              {this.state.error?.stack?.slice(0, 500)}
            </Text>
          </ScrollView>
          <TouchableOpacity
            onPress={() => this.setState({ error: null })}
            style={{ marginTop: 24, backgroundColor: '#2a7a5a', borderRadius: 10, padding: 14, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )
    }
    return this.props.children
  }
}

type Screen = 'loading' | 'login' | 'events' | 'live' | 'settings'

function AppInner() {
  const [screen,      setScreen]      = useState<Screen>('loading')
  const [user,        setUser]        = useState<FirebaseAuthTypes.User | null>(null)
  const [activeEvent, setActiveEvent] = useState<LensEvent | null>(null)
  const [routerIp,    setRouterIp]    = useState('192.168.8.1')

  useEffect(() => {
    AsyncStorage.getItem('lens_router_ip').then(ip => { if (ip) setRouterIp(ip) }).catch(() => {})
    const unsub = auth().onAuthStateChanged(u => {
      setUser(u)
      setScreen(u ? 'events' : 'login')
    })
    return unsub
  }, [])

  if (screen === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#2a7a5a', fontSize: 28, fontWeight: '900', letterSpacing: -1, marginBottom: 20 }}>wugi lens</Text>
        <ActivityIndicator color="#2a7a5a" size="large"/>
      </View>
    )
  }

  if (screen === 'login' || !user) {
    return <LoginScreen onLogin={() => setScreen('events')}/>
  }

  if (screen === 'settings') {
    return <SettingsScreen onBack={() => {
      AsyncStorage.getItem('lens_router_ip').then(ip => { if (ip) setRouterIp(ip) }).catch(() => {})
      setScreen(activeEvent ? 'live' : 'events')
    }}/>
  }

  if (screen === 'events' || !activeEvent) {
    return (
      <View style={{ flex: 1 }}>
        <EventSelectorScreen onSelect={event => { setActiveEvent(event); setScreen('live') }}/>
        <SafeAreaView style={{ position: 'absolute', top: 0, right: 0 }}>
          <TouchableOpacity onPress={() => setScreen('settings')} style={{ padding: 16 }}>
            <Text style={{ fontSize: 20 }}>⚙️</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    )
  }

  return (
    <LiveFeedScreen
      event={activeEvent}
      routerIp={routerIp}
      onBack={() => { setActiveEvent(null); setScreen('events') }}
      onSettings={() => setScreen('settings')}
    />
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner/>
    </ErrorBoundary>
  )
}
