// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — EventSelectorScreen
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView,
  SafeAreaView, ActivityIndicator, RefreshControl,
} from 'react-native'
import auth from '@react-native-firebase/auth'
import { getActiveEvents } from '../lib/firebase'
import type { LensEvent } from '../types'

type Props = { onSelect: (event: LensEvent) => void }

export function EventSelectorScreen({ onSelect }: Props) {
  const [events,    setEvents]    = useState<LensEvent[]>([])
  const [loading,   setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const user = auth().currentUser

  async function load() {
    try {
      const data = await getActiveEvents()
      setEvents(data)
    } catch (e) { console.log('EventSelector error:', e) }
    finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => { load() }, [])

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <SafeAreaView>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' }}>
          <View>
            <Text style={{ color: '#2a7a5a', fontSize: 20, fontWeight: '900', letterSpacing: -0.5 }}>wugi lens</Text>
            <Text style={{ color: '#555', fontSize: 12, marginTop: 2 }}>{user?.email}</Text>
          </View>
          <TouchableOpacity onPress={() => auth().signOut()} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a' }}>
            <Text style={{ color: '#666', fontSize: 13 }}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor="#2a7a5a"/>}
        contentContainerStyle={{ padding: 16 }}
      >
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 4 }}>Select Event</Text>
        <Text style={{ color: '#555', fontSize: 14, marginBottom: 20 }}>Choose the event you're shooting tonight</Text>

        {loading ? (
          <ActivityIndicator color="#2a7a5a" size="large" style={{ marginTop: 40 }}/>
        ) : events.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>📷</Text>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>No active events</Text>
            <Text style={{ color: '#555', fontSize: 13, marginTop: 6, textAlign: 'center' }}>Pull to refresh or check back later</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {events.map(event => (
              <TouchableOpacity
                key={event.id}
                onPress={() => onSelect(event)}
                activeOpacity={0.85}
                style={{ backgroundColor: '#111', borderRadius: 16, borderWidth: 1, borderColor: '#1e1e1e', padding: 18 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 4 }} numberOfLines={1}>{event.title}</Text>
                    <Text style={{ color: '#666', fontSize: 13 }}>{event.venueName}</Text>
                    <Text style={{ color: '#555', fontSize: 12, marginTop: 2 }}>{event.date}</Text>
                  </View>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#2a7a5a22', alignItems: 'center', justifyContent: 'center', marginLeft: 12 }}>
                    <Text style={{ fontSize: 18 }}>→</Text>
                  </View>
                </View>
                {event.galleryId && (
                  <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#2a7a5a' }}/>
                    <Text style={{ color: '#2a7a5a', fontSize: 11, fontWeight: '600' }}>Gallery active</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  )
}
