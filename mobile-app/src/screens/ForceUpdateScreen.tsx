// ─────────────────────────────────────────────────────────────────────
// Wugi — ForceUpdateScreen
// Full-screen blocker shown when the installed build is below the
// min_supported_version published in Firebase Remote Config. No
// dismiss/skip path — this is the mobile forward-compatibility
// kill-switch that lets old Firestore fields be retired safely.
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, TouchableOpacity, Linking, useColorScheme } from 'react-native';
import { COLORS } from '../constants/colors';
import { FONTS } from '../constants/fonts';

const APP_STORE_ID  = '829564750'; // ascAppId — production (eas.json submit.production)
const APP_STORE_URL  = `https://apps.apple.com/app/id${APP_STORE_ID}`;
const APP_STORE_DEEP_LINK = `itms-apps://apps.apple.com/app/id${APP_STORE_ID}`;

export function ForceUpdateScreen() {
  const scheme = useColorScheme();
  const theme  = scheme === 'dark' ? COLORS.dark : COLORS.light;

  const openStore = () => {
    Linking.openURL(APP_STORE_DEEP_LINK).catch(() => {
      Linking.openURL(APP_STORE_URL).catch(() => {});
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
      <Text style={{ fontFamily: FONTS.display, color: theme.text, fontSize: 28, textAlign: 'center', marginBottom: 12 }}>
        Update Required
      </Text>
      <Text style={{ fontFamily: FONTS.body, color: theme.subtext, fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 32 }}>
        This version of Wugi is no longer supported. Update to the latest version to keep using the app.
      </Text>
      <TouchableOpacity
        onPress={openStore}
        style={{ backgroundColor: theme.accent, paddingVertical: 14, paddingHorizontal: 36, borderRadius: 100 }}
      >
        <Text style={{ fontFamily: FONTS.medium, color: theme.onAccent, fontSize: 16 }}>
          Update Now
        </Text>
      </TouchableOpacity>
    </View>
  );
}
