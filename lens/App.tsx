// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — App.tsx
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react'
import { View, ActivityIndicator, TouchableOpacity, Text, SafeAreaView } from 'react-native'
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { LoginScreen }         from './src/screens/LoginScreen'
import { EventSelectorScreen } from './src/screens/EventSelectorScreen'
import { LiveFeedScreen }      from './src/screens/LiveFeedScreen'
import { SettingsScreen }      from './src/screens/SettingsScreen'
import type { LensEvent } from './src/types'

type Screen = 'loading' | 'login' | 'events' | 'live' | 'settings'

export default function App() {
  const [screen,      setScreen]      = useState<Screen>('loading')
  const [user,        setUser]        = useState<FirebaseAuthTypes.User | null>(null)
  const [activeEvent, setActiveEvent] = useState<LensEvent | null>(null)
  const [routerIp,    setRouterIp]    = useState('192.168.8.1')

  useEffect(() => {
    // Load saved router IP
    AsyncStorage.getItem('lens_router_ip').then(ip => { if (ip) setRouterIp(ip) })

    const unsub = auth().onAuthStateChanged(u => {
      setUser(u)
      setScreen(u ? 'events' : 'login')
    })
    return unsub
  }, [])

  if (screen === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#2a7a5a" size="large"/>
      </View>
    )
  }

  if (screen === 'login' || !user) {
    return <LoginScreen onLogin={() => setScreen('events')}/>
  }

  if (screen === 'settings') {
    return <SettingsScreen onBack={() => {
      // Reload router IP after settings change
      AsyncStorage.getItem('lens_router_ip').then(ip => { if (ip) setRouterIp(ip) })
      setScreen(activeEvent ? 'live' : 'events')
    }}/>
  }

  if (screen === 'events' || !activeEvent) {
    return (
      <View style={{ flex: 1 }}>
        <EventSelectorScreen onSelect={event => { setActiveEvent(event); setScreen('live') }}/>
        {/* Settings gear in top right */}
        <SafeAreaView style={{ position: 'absolute', top: 0, right: 0 }}>
          <TouchableOpacity
            onPress={() => setScreen('settings')}
            style={{ padding: 16 }}
          >
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
