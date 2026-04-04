// ─────────────────────────────────────────────────────────────────────
// Wugi — App.tsx
// Entry point. Wraps with StripeProvider for payment sheet support.
// ─────────────────────────────────────────────────────────────────────
import React, { useRef } from 'react';
import { StripeProvider } from '@stripe/stripe-react-native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useNotifications, setNotificationTapHandler } from './src/hooks/useNotifications';

const STRIPE_PUBLISHABLE_KEY = 'pk_test_51TFpeHDDSZf3J4DjpTFGgwaSnxBHlsoxyR6HBNs3k8EQTxY1BNAHF9si4aEwarzzdWKhRXLPHgDBVSqhQS5jcTQB00HIlmINiE';

export default function App() {
  useNotifications()

  // navigateFromNotification is set by RootNavigator once nav is ready
  const navigateRef = useRef<((data: Record<string, string>) => void) | null>(null)

  // Register handler so notification taps route into the app
  setNotificationTapHandler((data) => {
    navigateRef.current?.(data)
  })

  return (
    <StripeProvider
      publishableKey={STRIPE_PUBLISHABLE_KEY}
      merchantIdentifier="merchant.com.wugi.wugi"
      urlScheme="wugi"
    >
      <RootNavigator onNotificationNavigate={(fn) => { navigateRef.current = fn }} />
    </StripeProvider>
  )
}
