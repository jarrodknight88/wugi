// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — LiveFeedScreen
// Main shooting screen — shows upload queue, stats, router status
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, FlatList,
  SafeAreaView, Image, Alert, ActivityIndicator, Dimensions,
} from 'react-native'
import { getOrCreateGallery } from '../lib/firebase'
import { useUploadQueue } from '../hooks/useUploadQueue'
import { useRouterSync } from '../hooks/useRouterSync'
import type { LensEvent, PhotoItem } from '../types'

const { width: SW } = Dimensions.get('window')
const THUMB_SIZE    = (SW - 48) / 3

type Props = {
  event:      LensEvent
  onBack:     () => void
  onSettings: () => void
  routerIp:   string
}

// Status badge colors
const STATUS_COLORS: Record<string, string> = {
  queued:    '#555',
  uploading: '#f59e0b',
  done:      '#2a7a5a',
  error:     '#ef4444',
}

function PhotoThumb({ photo }: { photo: PhotoItem }) {
  const color = STATUS_COLORS[photo.status] || '#555'
  return (
    <View style={{ width: THUMB_SIZE, height: THUMB_SIZE, margin: 2, borderRadius: 8, overflow: 'hidden', backgroundColor: '#1a1a1a' }}>
      <Image source={{ uri: photo.remoteUrl || photo.localUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover"/>
      {photo.status !== 'done' && (
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
          {photo.status === 'uploading'
            ? <ActivityIndicator color="#f59e0b" size="small"/>
            : <Text style={{ color, fontSize: 18 }}>{photo.status === 'error' ? '✕' : '⏳'}</Text>
          }
          {photo.status === 'uploading' && (
            <Text style={{ color: '#f59e0b', fontSize: 10, marginTop: 4, fontWeight: '700' }}>{photo.progress}%</Text>
          )}
        </View>
      )}
      <View style={{ position: 'absolute', bottom: 4, right: 4, width: 10, height: 10, borderRadius: 5, backgroundColor: color }}/>
    </View>
  )
}

// Need StyleSheet import
import { StyleSheet } from 'react-native'

export function LiveFeedScreen({ event, onBack, onSettings, routerIp }: Props) {
  const [galleryId,    setGalleryId]    = useState<string | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [routerEnabled, setRouterEnabled] = useState(false)

  const { photos, uploading, enqueue, retryFailed, publishedCount, queuedCount, errorCount } =
    useUploadQueue(galleryId)

  const handleNewRouterFiles = useCallback((files: { path: string }[]) => {
    enqueue(files.map(f => f.path))
  }, [enqueue])

  const { status: routerStatus, fileCount: routerFileCount } = useRouterSync({
    routerIp,
    onNewFiles: handleNewRouterFiles,
    enabled:    routerEnabled && !!galleryId,
  })

  useEffect(() => {
    getOrCreateGallery(event).then(id => {
      setGalleryId(id)
      setInitializing(false)
    }).catch(e => {
      Alert.alert('Error', 'Could not start gallery: ' + e.message)
      setInitializing(false)
    })
  }, [event])

  async function handlePickPhotos() {
    Alert.alert('Coming Soon', 'Photo library import will be available in the next update. Use the router sync or camera mode.')
  }

  async function handleCamera() {
    Alert.alert('Coming Soon', 'Direct camera capture will be available in the next update. Use router sync for automatic uploads.')
  }

  if (initializing) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#2a7a5a" size="large"/>
        <Text style={{ color: '#555', fontSize: 14, marginTop: 12 }}>Starting gallery...</Text>
      </View>
    )
  }

  const routerStatusColor = routerStatus === 'connected' ? '#2a7a5a' : routerStatus === 'connecting' ? '#f59e0b' : '#555'
  const routerStatusLabel = { disconnected: 'Router: Off', connecting: 'Connecting...', connected: 'Router: Live', scanning: 'Scanning...' }[routerStatus]

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <SafeAreaView>
        {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <TouchableOpacity onPress={onBack} style={{ paddingRight: 12 }}>
              <Text style={{ color: '#2a7a5a', fontSize: 14, fontWeight: '600' }}>← Events</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }} numberOfLines={1}>{event.title}</Text>
              <Text style={{ color: '#555', fontSize: 12 }}>{event.venueName}</Text>
            </View>
            {uploading
              ? <ActivityIndicator color="#2a7a5a" size="small"/>
              : <TouchableOpacity onPress={onSettings} style={{ padding: 4 }}>
                  <Text style={{ fontSize: 18 }}>⚙️</Text>
                </TouchableOpacity>
            }
          </View>
        </View>
      </SafeAreaView>

      {/* Stats bar */}
      <View style={{ flexDirection: 'row', backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' }}>
        {[
          { label: 'Published', value: publishedCount, color: '#2a7a5a' },
          { label: 'Queued',    value: queuedCount,    color: '#f59e0b' },
          { label: 'Errors',    value: errorCount,     color: errorCount > 0 ? '#ef4444' : '#555' },
        ].map((stat, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRightWidth: i < 2 ? 1 : 0, borderRightColor: '#1a1a1a' }}>
            <Text style={{ color: stat.color, fontSize: 24, fontWeight: '900' }}>{stat.value}</Text>
            <Text style={{ color: '#555', fontSize: 10, fontWeight: '600', letterSpacing: 0.5 }}>{stat.label.toUpperCase()}</Text>
          </View>
        ))}
      </View>

      {/* Router toggle */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#0d0d0d', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: routerStatusColor }}/>
          <Text style={{ color: routerStatusColor, fontSize: 12, fontWeight: '600' }}>{routerStatusLabel}</Text>
          {routerFileCount > 0 && (
            <Text style={{ color: '#555', fontSize: 11 }}>· {routerFileCount} detected</Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => setRouterEnabled(e => !e)}
          style={{ backgroundColor: routerEnabled ? '#2a7a5a22' : '#1a1a1a', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: routerEnabled ? '#2a7a5a' : '#2a2a2a' }}
        >
          <Text style={{ color: routerEnabled ? '#2a7a5a' : '#555', fontSize: 12, fontWeight: '700' }}>
            {routerEnabled ? 'Router On' : 'Router Off'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Photo grid */}
      {photos.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ fontSize: 56, marginBottom: 16 }}>📷</Text>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 8 }}>Ready to shoot</Text>
          <Text style={{ color: '#555', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
            Enable the router to auto-sync from your camera, or tap the buttons below to add photos manually.
          </Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={p => p.id}
          numColumns={3}
          contentContainerStyle={{ padding: 6 }}
          renderItem={({ item }) => <PhotoThumb photo={item}/>}
        />
      )}

      {/* Action buttons */}
      <SafeAreaView style={{ borderTopWidth: 1, borderTopColor: '#1a1a1a', backgroundColor: '#0d0d0d' }}>
        <View style={{ flexDirection: 'row', padding: 12, gap: 10 }}>
          <TouchableOpacity
            onPress={handleCamera}
            style={{ flex: 1, backgroundColor: '#2a7a5a', borderRadius: 14, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
          >
            <Text style={{ fontSize: 18 }}>📸</Text>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Camera</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handlePickPhotos}
            style={{ flex: 1, backgroundColor: '#1a1a1a', borderRadius: 14, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#2a2a2a' }}
          >
            <Text style={{ fontSize: 18 }}>🖼️</Text>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Library</Text>
          </TouchableOpacity>

          {errorCount > 0 && (
            <TouchableOpacity
              onPress={retryFailed}
              style={{ backgroundColor: '#ef444422', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ef4444' }}
            >
              <Text style={{ color: '#ef4444', fontSize: 14, fontWeight: '700' }}>Retry {errorCount}</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </View>
  )
}
