// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — App.tsx
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth'
import { LoginScreen }         from './src/screens/LoginScreen'
import { EventSelectorScreen } from './src/screens/EventSelectorScreen'
import { LiveFeedScreen }      from './src/screens/LiveFeedScreen'
import type { LensEvent } from './src/types'

const DEFAULT_ROUTER_IP = '192.168.8.1'

type Screen = 'loading' | 'login' | 'events' | 'live'

export default function App() {
  const [screen,      setScreen]      = useState<Screen>('loading')
  const [user,        setUser]        = useState<FirebaseAuthTypes.User | null>(null)
  const [activeEvent, setActiveEvent] = useState<LensEvent | null>(null)

  useEffect(() => {
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

  if (screen === 'events' || !activeEvent) {
    return (
      <EventSelectorScreen
        onSelect={event => {
          setActiveEvent(event)
          setScreen('live')
        }}
      />
    )
  }

  return (
    <LiveFeedScreen
      event={activeEvent}
      onBack={() => { setActiveEvent(null); setScreen('events') }}
      routerIp={DEFAULT_ROUTER_IP}
    />
  )
}
