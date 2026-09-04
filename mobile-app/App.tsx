// ─────────────────────────────────────────────────────────────────────
// Wugi — App.tsx
// Entry point. Wraps with StripeProvider for payment sheet support.
// InputAccessoryView lives here at root level (correct iOS pattern).
// KBContext provides prev/next field navigation to the toolbar.
// ─────────────────────────────────────────────────────────────────────
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, Keyboard, InputAccessoryView, Platform } from 'react-native';
import type { TextInput } from 'react-native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { useFonts } from 'expo-font';
import Constants from 'expo-constants';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useNotifications, setNotificationTapHandler } from './src/hooks/useNotifications';
import { KB_ACCESSORY_ID, KBContext } from './src/constants/keyboard';
import { initRemoteConfig, getMinSupportedVersion } from './src/lib/remoteConfig';
import { watchTransactionUpdates } from './src/lib/iap';
import { isVersionBelow } from './src/utils/version';
import { ForceUpdateScreen } from './src/screens/ForceUpdateScreen';

// Publishable key is non-secret by design (Stripe ships it in every client
// bundle) but lives in app.json → extra so it has one canonical source,
// matching the googleWebClientId pattern below.
const STRIPE_PUBLISHABLE_KEY = (Constants.expoConfig?.extra as { stripePublishableKey?: string } | undefined)?.stripePublishableKey ?? '';

export default function App() {
  useNotifications();

  // PP Neue Montreal — brand typeface. Runtime registration here works on
  // the existing native build (expo-font module already ships with the SDK);
  // the app.json config plugin embeds them natively on the next prebuild.
  const [fontsLoaded] = useFonts({
    'PPNeueMontreal-Thin':           require('./assets/fonts/ppneuemontreal-thin.otf'),
    'PPNeueMontreal-Book':           require('./assets/fonts/ppneuemontreal-book.otf'),
    'PPNeueMontreal-Medium':         require('./assets/fonts/ppneuemontreal-medium.otf'),
    'PPNeueMontreal-Bold':           require('./assets/fonts/ppneuemontreal-bold.otf'),
    'PPNeueMontreal-Italic':         require('./assets/fonts/ppneuemontreal-italic.otf'),
    'PPNeueMontreal-SemiBoldItalic': require('./assets/fonts/ppneuemontreal-semibolditalic.otf'),
  });

  const navigateRef  = useRef<((data: Record<string, string>) => void) | null>(null);
  const fieldRefsRef = useRef<React.RefObject<TextInput>[]>([]);

  setNotificationTapHandler((data) => { navigateRef.current?.(data); });

  // ── Min-version forced-update gate ──────────────────────────────────
  // Races the config/appConfig Firestore fetch against a 3s timeout so a
  // slow/offline network can never hang launch. min_supported_version
  // defaults to "0.0.0" (no-op) until an admin publishes a real threshold,
  // so this fails open rather than locking anyone out.
  const [gateState, setGateState] = useState<'checking' | 'ok' | 'blocked'>('checking');
  useEffect(() => {
    let cancelled = false;
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
    Promise.race([initRemoteConfig(), timeout]).then(() => {
      if (cancelled) return;
      const installedVersion = (Constants.expoConfig as any)?.version ?? '0.0.0';
      setGateState(isVersionBelow(installedVersion, getMinSupportedVersion()) ? 'blocked' : 'ok');
    });
    return () => { cancelled = true; };
  }, []);

  // ── StoreKit transaction listener (Asana 1216729383901466 / issue #252) ──
  // Catches purchases StoreKit delivers outside a direct purchase() call
  // (Ask to Buy approval landing later, a purchase syncing in from
  // another device) for the whole app session — see
  // mobile-app/src/lib/iap.ts watchTransactionUpdates doc comment.
  useEffect(() => {
    const unsubscribe = watchTransactionUpdates();
    return unsubscribe;
  }, []);

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

  // Hold the (dark) background until the brand font is ready and the
  // version gate has resolved, so text doesn't flash in the system
  // fallback and the app tree never mounts ahead of a blocked launch.
  if (!fontsLoaded || gateState === 'checking') {
    return <View style={{ flex: 1, backgroundColor: '#0e0c08' }} />;
  }

  if (gateState === 'blocked') {
    return <ForceUpdateScreen />;
  }

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
