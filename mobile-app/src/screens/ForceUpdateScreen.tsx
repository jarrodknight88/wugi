// ─────────────────────────────────────────────────────────────────────
// Wugi — ForceUpdateScreen
// Blocking screen rendered by App.tsx when the installed build is below
// min_supported_version (config/appConfig in Firestore). No dismiss path —
// this is the mobile forward-compatibility gate, not a dismissible nag.
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, TouchableOpacity, Linking, SafeAreaView } from 'react-native';
import { FONTS } from '../constants/fonts';

// Production App Store listing (submit.production.ios.ascAppId in eas.json).
const APP_STORE_ID = '829564750';
const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;

export function ForceUpdateScreen() {
  const handleUpdate = () => {
    Linking.openURL(APP_STORE_URL).catch(() => { /* nothing else to do here */ });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0e0c08' }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <Text style={{ fontFamily: FONTS.display, fontSize: 26, color: '#fff', textAlign: 'center', marginBottom: 16 }}>
          Update Required
        </Text>
        <Text style={{ fontFamily: FONTS.body, fontSize: 16, color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 22, marginBottom: 32 }}>
          This version of Wugi is no longer supported. Update to the latest version to keep using the app.
        </Text>
        <TouchableOpacity
          onPress={handleUpdate}
          style={{ backgroundColor: '#2a7a5a', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 30 }}
        >
          <Text style={{ fontFamily: FONTS.medium, fontSize: 16, color: '#fff' }}>Update Now</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
