// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — SettingsScreen
// Router IP, upload quality, watermark toggle
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  SafeAreaView, ScrollView, Switch, Alert,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import auth from '@react-native-firebase/auth'

type Props = { onBack: () => void }

const STORAGE_KEYS = {
  ROUTER_IP:      'lens_router_ip',
  UPLOAD_QUALITY: 'lens_upload_quality',
  WATERMARK:      'lens_watermark',
  WATCH_PATH:     'lens_watch_path',
}

export function SettingsScreen({ onBack }: Props) {
  const [routerIp,      setRouterIp]      = useState('192.168.8.1')
  const [watchPath,     setWatchPath]     = useState('/mnt/sda1/DCIM')
  const [uploadQuality, setUploadQuality] = useState('0.9')
  const [watermark,     setWatermark]     = useState(false)
  const [saved,         setSaved]         = useState(false)

  useEffect(() => {
    AsyncStorage.multiGet(Object.values(STORAGE_KEYS)).then(pairs => {
      const map = Object.fromEntries(pairs.map(([k, v]) => [k, v]))
      if (map[STORAGE_KEYS.ROUTER_IP])      setRouterIp(map[STORAGE_KEYS.ROUTER_IP]!)
      if (map[STORAGE_KEYS.WATCH_PATH])     setWatchPath(map[STORAGE_KEYS.WATCH_PATH]!)
      if (map[STORAGE_KEYS.UPLOAD_QUALITY]) setUploadQuality(map[STORAGE_KEYS.UPLOAD_QUALITY]!)
      if (map[STORAGE_KEYS.WATERMARK])      setWatermark(map[STORAGE_KEYS.WATERMARK] === 'true')
    })
  }, [])

  async function save() {
    await AsyncStorage.multiSet([
      [STORAGE_KEYS.ROUTER_IP,      routerIp],
      [STORAGE_KEYS.WATCH_PATH,     watchPath],
      [STORAGE_KEYS.UPLOAD_QUALITY, uploadQuality],
      [STORAGE_KEYS.WATERMARK,      String(watermark)],
    ])
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const user = auth().currentUser

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <SafeAreaView>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' }}>
          <TouchableOpacity onPress={onBack}>
            <Text style={{ color: '#2a7a5a', fontSize: 14, fontWeight: '600' }}>← Back</Text>
          </TouchableOpacity>
          <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>Settings</Text>
          <TouchableOpacity onPress={save}>
            <Text style={{ color: saved ? '#2a7a5a' : '#2a7a5a', fontSize: 14, fontWeight: '700' }}>
              {saved ? 'Saved ✓' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 24 }}>

        {/* Router config */}
        <View>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 4 }}>Camera Router</Text>
          <Text style={{ color: '#555', fontSize: 12, marginBottom: 16, lineHeight: 18 }}>
            GL.iNet Slate AX settings. Connect your phone to the router WiFi first, then enable router sync in the Live Feed.
          </Text>
          <View style={{ gap: 12 }}>
            <View>
              <Text style={{ color: '#777', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>ROUTER IP ADDRESS</Text>
              <TextInput
                value={routerIp}
                onChangeText={setRouterIp}
                placeholder="192.168.8.1"
                placeholderTextColor="#444"
                keyboardType="decimal-pad"
                autoCapitalize="none"
                style={{ backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, color: '#fff', fontSize: 15, fontFamily: 'Courier' }}
              />
              <Text style={{ color: '#444', fontSize: 11, marginTop: 4 }}>Default: 192.168.8.1 (GL.iNet default)</Text>
            </View>
            <View>
              <Text style={{ color: '#777', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>PHOTO WATCH PATH</Text>
              <TextInput
                value={watchPath}
                onChangeText={setWatchPath}
                placeholder="/mnt/sda1/DCIM"
                placeholderTextColor="#444"
                autoCapitalize="none"
                autoCorrect={false}
                style={{ backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, color: '#fff', fontSize: 15, fontFamily: 'Courier' }}
              />
              <Text style={{ color: '#444', fontSize: 11, marginTop: 4 }}>Sony/Canon write here via WiFi sync</Text>
            </View>
          </View>
        </View>

        {/* Upload quality */}
        <View>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 4 }}>Upload Quality</Text>
          <Text style={{ color: '#555', fontSize: 12, marginBottom: 16 }}>Higher quality = larger files + slower uploads</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[
              { label: 'High',    value: '0.95', note: '~4MB' },
              { label: 'Medium',  value: '0.85', note: '~2MB' },
              { label: 'Fast',    value: '0.7',  note: '~1MB' },
            ].map(opt => (
              <TouchableOpacity
                key={opt.value}
                onPress={() => setUploadQuality(opt.value)}
                style={{ flex: 1, backgroundColor: uploadQuality === opt.value ? '#2a7a5a' : '#1a1a1a', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: uploadQuality === opt.value ? '#2a7a5a' : '#2a2a2a' }}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{opt.label}</Text>
                <Text style={{ color: uploadQuality === opt.value ? '#a8e6cf' : '#555', fontSize: 11, marginTop: 2 }}>{opt.note}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Watermark toggle */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1a1a1a', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#2a2a2a' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Wugi Watermark</Text>
            <Text style={{ color: '#555', fontSize: 12, marginTop: 2 }}>Add subtle Wugi branding to uploaded photos</Text>
          </View>
          <Switch value={watermark} onValueChange={setWatermark} trackColor={{ false: '#2a2a2a', true: '#2a7a5a' }} thumbColor="#fff"/>
        </View>

        {/* Account */}
        <View style={{ backgroundColor: '#1a1a1a', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#2a2a2a' }}>
          <Text style={{ color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4 }}>SIGNED IN AS</Text>
          <Text style={{ color: '#fff', fontSize: 14 }}>{user?.email}</Text>
          <TouchableOpacity
            onPress={() => Alert.alert('Sign Out', 'Are you sure?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign Out', style: 'destructive', onPress: () => auth().signOut() }
            ])}
            style={{ marginTop: 14, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#ef4444', borderRadius: 10 }}
          >
            <Text style={{ color: '#ef4444', fontSize: 14, fontWeight: '600' }}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ color: '#333', fontSize: 11, textAlign: 'center' }}>
          Wugi Lens v1.0.0 · com.wugi.lens
        </Text>
      </ScrollView>
    </View>
  )
}
