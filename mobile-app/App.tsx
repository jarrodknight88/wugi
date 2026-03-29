// ─────────────────────────────────────────────────────────────────────
// Wugi — App.tsx
// Entry point. Wraps with StripeProvider for payment sheet support.
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { StripeProvider } from '@stripe/stripe-react-native';
import { RootNavigator } from './src/navigation/RootNavigator';

// Sandbox publishable key — swap for live key before launch
// See docs/launch-checklist.md → Stripe section
const STRIPE_PUBLISHABLE_KEY = 'pk_test_REPLACE_WITH_YOUR_KEY';

export default function App() {
  return (
    <StripeProvider
      publishableKey={STRIPE_PUBLISHABLE_KEY}
      merchantIdentifier="merchant.com.wugi.wugi"
      urlScheme="wugi"
    >
      <RootNavigator/>
    </StripeProvider>
  );
}
