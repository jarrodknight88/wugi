// ─────────────────────────────────────────────────────────────────────
// Wugi — App.tsx
// Entry point. Wraps with StripeProvider for payment sheet support.
// InputAccessoryView lives here at root level (correct iOS pattern).
// KBContext provides prev/next field navigation to the toolbar.
//
// VENUE-DATA-07 Deliverable E.4 additions:
//  - QueryClientProvider wraps the app for React Query catalog hooks
//  - Background prefetch of venues + events at mount (non-blocking)
//  - AppState foreground listener invalidates catalog after >5min idle
//  - Zustand catalog store hydrates from AsyncStorage automatically
//    via persist() middleware — no explicit hydrate call needed here
// ─────────────────────────────────────────────────────────────────────
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, Keyboard, InputAccessoryView, Platform, AppState, type AppStateStatus } from 'react-native';
import type { TextInput } from 'react-native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { useFonts } from 'expo-font';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useNotifications, setNotificationTapHandler } from './src/hooks/useNotifications';
import { KB_ACCESSORY_ID, KBContext } from './src/constants/keyboard';
import { queryKeys } from './src/hooks/useCatalogQueries';
import { getApprovedVenues, getApprovedEvents } from './firestoreService';

// React Query client — defaults tuned for mobile catalog reads.
// staleTime 1h: most catalog data doesn't churn between sessions.
// retry 3 with default exponential backoff.
// refetchOnWindowFocus disabled: irrelevant on mobile; covered by AppState below.
// refetchOnReconnect true: pick up changes after network outage.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            60 * 60 * 1000,
      retry:                3,
      refetchOnWindowFocus: false,
      refetchOnReconnect:   true,
    },
  },
});

const FOREGROUND_INVALIDATE_AFTER_MS = 5 * 60 * 1000; // 5 min idle threshold

const STRIPE_PUBLISHABLE_KEY = 'pk_live_51TFpeBDdJ1ZAq3aIiX3I2pInGOK0BlYZI38eqkhQz5OAK6g9Dw1cjcu2iHEc6eQRrYxqKBHWsCkGOi7G9WaTCyaZ00gfpRKfzK';

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

  // ── Catalog warm-start (Deliverable E.4) ───────────────────────────
  // Kick off a non-blocking prefetch on mount. Falls into React Query
  // cache, then any consumer using useVenues/useEvents resolves
  // immediately. Errors are swallowed — UI handles loading state.
  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.venues(),
      queryFn:  async () => getApprovedVenues(undefined, 100),
    }).catch(() => { /* non-blocking */ });
    queryClient.prefetchQuery({
      queryKey: queryKeys.events(),
      queryFn:  async () => getApprovedEvents(undefined, 100),
    }).catch(() => { /* non-blocking */ });
  }, []);

  // ── AppState foreground listener (Deliverable E.4) ─────────────────
  // When the app comes back to the foreground after >5min in background,
  // invalidate the catalog so freshness re-checks happen in the background.
  // Cached data still renders immediately; new data swaps in when ready.
  const lastBackgroundedAt = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        lastBackgroundedAt.current = Date.now();
      } else if (next === 'active') {
        const idleMs = lastBackgroundedAt.current ? Date.now() - lastBackgroundedAt.current : 0;
        if (idleMs > FOREGROUND_INVALIDATE_AFTER_MS) {
          queryClient.invalidateQueries({ queryKey: ['venues'] });
          queryClient.invalidateQueries({ queryKey: ['events'] });
        }
        lastBackgroundedAt.current = null;
      }
    });
    return () => sub.remove();
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

  // Hold the (dark) background until the brand font is ready so text doesn't
  // flash in the system fallback first.
  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#0e0c08' }} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  );
}
