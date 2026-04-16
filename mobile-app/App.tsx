// ─────────────────────────────────────────────────────────────────────
// Wugi — App.tsx
// Entry point. Wraps with StripeProvider for payment sheet support.
// InputAccessoryView lives here at root level (correct iOS pattern).
// KBContext provides prev/next field navigation to the toolbar.
// ─────────────────────────────────────────────────────────────────────
import React, { useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Keyboard, InputAccessoryView, Platform } from 'react-native';
import type { TextInput } from 'react-native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useNotifications, setNotificationTapHandler } from './src/hooks/useNotifications';
import { KB_ACCESSORY_ID, KBContext } from './src/constants/keyboard';

const STRIPE_PUBLISHABLE_KEY = 'pk_live_51TFpeBDdJ1ZAq3aIiX3I2pInGOK0BlYZI38eqkhQz5OAK6g9Dw1cjcu2iHEc6eQRrYxqKBHWsCkGOi7G9WaTCyaZ00gfpRKfzK';

export default function App() {
  useNotifications();

  const navigateRef  = useRef<((data: Record<string, string>) => void) | null>(null);
  const fieldRefsRef = useRef<React.RefObject<TextInput>[]>([]);

  setNotificationTapHandler((data) => { navigateRef.current?.(data); });

  const register = useCallback((refs: React.RefObject<TextInput>[]) => {
    fieldRefsRef.current = refs;
  }, []);

  const focusPrev = useCallback(() => {
    const refs = fieldRefsRef.current;
    const idx  = refs.findIndex(r => r.current?.isFocused?.());
    if (idx > 0) refs[idx - 1].current?.focus();
    else if (refs.length > 0) refs[0].current?.focus();
  }, []);

  const focusNext = useCallback(() => {
    const refs = fieldRefsRef.current;
    const idx  = refs.findIndex(r => r.current?.isFocused?.());
    if (idx >= 0 && idx < refs.length - 1) refs[idx + 1].current?.focus();
    else if (refs.length > 0) refs[refs.length - 1].current?.focus();
  }, []);

  return (
    <KBContext.Provider value={{ register, focusPrev, focusNext }}>
      <StripeProvider
        publishableKey={STRIPE_PUBLISHABLE_KEY}
        merchantIdentifier="merchant.com.wugimedia.wugitest"
        urlScheme="wugi"
      >
        <RootNavigator onNotificationNavigate={(fn) => { navigateRef.current = fn; }} />
      </StripeProvider>

      {/* InputAccessoryView MUST be outside all providers/wrappers
          to register correctly with the iOS native bridge */}
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={KB_ACCESSORY_ID}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1c1c1e', borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 16, paddingVertical: 10 }}>
            <View style={{ flexDirection: 'row', gap: 32 }}>
              <TouchableOpacity hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} onPress={focusPrev}>
                <Text style={{ color: '#2a7a5a', fontSize: 20, fontWeight: '600' }}>⬆</Text>
              </TouchableOpacity>
              <TouchableOpacity hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} onPress={focusNext}>
                <Text style={{ color: '#2a7a5a', fontSize: 20, fontWeight: '600' }}>⬇</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} onPress={() => Keyboard.dismiss()}>
              <Text style={{ color: '#2a7a5a', fontSize: 15, fontWeight: '600' }}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}
    </KBContext.Provider>
  );
}
