// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — PendingPoolScreen (Phase 1)
// Review pool for hardware-ingested photos: thumbnail grid with
// tap-to-select, approve/reject for single photos or batches. Approving
// publishes into the existing consumer gallery surfaces (approved:true).
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, FlatList, SafeAreaView,
  Image, Alert, ActivityIndicator, Dimensions,
} from 'react-native'
import { subscribePendingPhotos, moderatePhotos } from '../lib/firebase'
import type { PendingPhoto } from '../types'

const { width: SW } = Dimensions.get('window')
const THUMB_SIZE    = (SW - 24) / 3

type Props = {
  galleryId: string
  onClose:   () => void
}

function PendingThumb({ photo, selected, onToggle }: {
  photo: PendingPhoto
  selected: boolean
  onToggle: () => void
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.8}
      style={{
        width: THUMB_SIZE, height: THUMB_SIZE, margin: 2, borderRadius: 8,
        overflow: 'hidden', backgroundColor: '#1a1a1a',
        borderWidth: 2, borderColor: selected ? '#2a7a5a' : 'transparent',
      }}
    >
      <Image source={{ uri: photo.thumbUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover"/>
      <View style={{
        position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11,
        backgroundColor: selected ? '#2a7a5a' : 'rgba(0,0,0,0.5)',
        borderWidth: 1.5, borderColor: selected ? '#2a7a5a' : '#888',
        alignItems: 'center', justifyContent: 'center',
      }}>
        {selected && <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>✓</Text>}
      </View>
    </TouchableOpacity>
  )
}

export function PendingPoolScreen({ galleryId, onClose }: Props) {
  const [photos,   setPhotos]   = useState<PendingPhoto[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading,  setLoading]  = useState(true)
  const [busy,     setBusy]     = useState(false)

  useEffect(() => {
    const unsub = subscribePendingPhotos(
      galleryId,
      p  => { setPhotos(p); setLoading(false) },
      e  => { setLoading(false); Alert.alert('Error', 'Could not load pending photos: ' + e.message) },
    )
    return unsub
  }, [galleryId])

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const allSelected = photos.length > 0 && selected.size === photos.length
  const selectAll = () => {
    setSelected(allSelected ? new Set() : new Set(photos.map(p => p.id)))
  }

  async function act(action: 'approve' | 'reject') {
    const ids = [...selected]
    if (ids.length === 0 || busy) return

    const run = async () => {
      setBusy(true)
      try {
        await moderatePhotos(galleryId, ids, action)
        setSelected(new Set())
      } catch (e: unknown) {
        Alert.alert('Error', `Could not ${action}: ` + (e instanceof Error ? e.message : String(e)))
      } finally {
        setBusy(false)
      }
    }

    if (action === 'reject') {
      Alert.alert(
        `Reject ${ids.length} photo${ids.length > 1 ? 's' : ''}?`,
        'Rejected photos are hidden from all gallery surfaces.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Reject', style: 'destructive', onPress: run }],
      )
    } else {
      run()
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <SafeAreaView>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' }}>
          <TouchableOpacity onPress={onClose} style={{ paddingRight: 12 }}>
            <Text style={{ color: '#2a7a5a', fontSize: 14, fontWeight: '600' }}>← Live Feed</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>Pending Pool</Text>
            <Text style={{ color: '#555', fontSize: 12 }}>
              {photos.length} awaiting review{selected.size > 0 ? ` · ${selected.size} selected` : ''}
            </Text>
          </View>
          {photos.length > 0 && (
            <TouchableOpacity onPress={selectAll} style={{ padding: 4 }}>
              <Text style={{ color: '#2a7a5a', fontSize: 13, fontWeight: '700' }}>
                {allSelected ? 'Clear' : 'Select All'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#2a7a5a" size="large"/>
        </View>
      ) : photos.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>✅</Text>
          <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 8 }}>All clear</Text>
          <Text style={{ color: '#555', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
            New photos from your Lens device will appear here for review as they upload.
          </Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={p => p.id}
          numColumns={3}
          contentContainerStyle={{ padding: 6, paddingBottom: 120 }}
          renderItem={({ item }) => (
            <PendingThumb photo={item} selected={selected.has(item.id)} onToggle={() => toggle(item.id)}/>
          )}
        />
      )}

      {/* Action bar */}
      <SafeAreaView style={{ borderTopWidth: 1, borderTopColor: '#1a1a1a', backgroundColor: '#0d0d0d' }}>
        <View style={{ flexDirection: 'row', padding: 12, gap: 10 }}>
          <TouchableOpacity
            onPress={() => act('reject')}
            disabled={selected.size === 0 || busy}
            style={{
              flex: 1, backgroundColor: '#ef444422', borderRadius: 14, paddingVertical: 14,
              alignItems: 'center', borderWidth: 1, borderColor: '#ef4444',
              opacity: selected.size === 0 || busy ? 0.4 : 1,
            }}
          >
            <Text style={{ color: '#ef4444', fontSize: 14, fontWeight: '700' }}>
              Reject{selected.size > 0 ? ` (${selected.size})` : ''}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => act('approve')}
            disabled={selected.size === 0 || busy}
            style={{
              flex: 1, backgroundColor: '#2a7a5a', borderRadius: 14, paddingVertical: 14,
              alignItems: 'center', opacity: selected.size === 0 || busy ? 0.4 : 1,
            }}
          >
            {busy
              ? <ActivityIndicator color="#fff" size="small"/>
              : <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
                  Approve & Publish{selected.size > 0 ? ` (${selected.size})` : ''}
                </Text>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  )
}
