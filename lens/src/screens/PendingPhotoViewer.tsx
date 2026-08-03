// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — PendingPhotoViewer (Phase 1)
// Full-screen single-photo review: web rendition + Approve/Reject for one
// photo at a time. Approving/rejecting advances to the next pending photo;
// closes back to the grid once the pool is exhausted.
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react'
import { View, Text, TouchableOpacity, Image, SafeAreaView, ActivityIndicator, Alert } from 'react-native'
import { moderatePhotos } from '../lib/firebase'
import type { PendingPhoto } from '../types'

type Props = {
  galleryId:  string
  photos:     PendingPhoto[]
  startIndex: number
  onClose:    () => void
}

export function PendingPhotoViewer({ galleryId, photos, startIndex, onClose }: Props) {
  const [index, setIndex] = useState(startIndex)
  const [busy,  setBusy]  = useState(false)

  const photo = photos[index]
  if (!photo) {
    onClose()
    return null
  }

  function advance() {
    if (index < photos.length - 1) setIndex(index + 1)
    else onClose()
  }

  async function act(action: 'approve' | 'reject') {
    if (busy) return
    setBusy(true)
    try {
      await moderatePhotos(galleryId, [photo.id], action)
      advance()
    } catch (e: unknown) {
      Alert.alert('Error', `Could not ${action}: ` + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
          <TouchableOpacity onPress={onClose} disabled={busy}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>✕</Text>
          </TouchableOpacity>
          <Text style={{ color: '#888', fontSize: 13, fontWeight: '600' }}>{index + 1} / {photos.length}</Text>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <TouchableOpacity onPress={() => setIndex(i => Math.max(0, i - 1))} disabled={busy || index === 0}>
              <Text style={{ color: index === 0 ? '#333' : '#fff', fontSize: 20 }}>‹</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIndex(i => Math.min(photos.length - 1, i + 1))} disabled={busy || index === photos.length - 1}>
              <Text style={{ color: index === photos.length - 1 ? '#333' : '#fff', fontSize: 20 }}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Image source={{ uri: photo.url || photo.thumbUrl }} style={{ width: '100%', height: '100%' }} resizeMode="contain"/>
        </View>

        <View style={{ flexDirection: 'row', padding: 16, gap: 10 }}>
          <TouchableOpacity
            onPress={() => act('reject')}
            disabled={busy}
            style={{
              flex: 1, backgroundColor: '#ef444422', borderRadius: 14, paddingVertical: 14,
              alignItems: 'center', borderWidth: 1, borderColor: '#ef4444', opacity: busy ? 0.4 : 1,
            }}
          >
            <Text style={{ color: '#ef4444', fontSize: 14, fontWeight: '700' }}>Reject</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => act('approve')}
            disabled={busy}
            style={{
              flex: 1, backgroundColor: '#2a7a5a', borderRadius: 14, paddingVertical: 14,
              alignItems: 'center', opacity: busy ? 0.4 : 1,
            }}
          >
            {busy
              ? <ActivityIndicator color="#fff" size="small"/>
              : <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Approve & Publish</Text>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  )
}
