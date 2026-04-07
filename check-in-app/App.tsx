import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from './src/context/SessionContext';
import PINScreen from './src/screens/PINScreen';
import MainTabs from './src/screens/MainTabs';

// TerminalProvider is only active after Apple approves the Tap to Pay entitlement
// and the @stripe/stripe-terminal-react-native plugin is re-enabled in app.json
const TAP_TO_PAY_ENABLED = false;

function RootNavigator() {
  const { session } = useSession();
  if (!session) return <PINScreen />;

  if (TAP_TO_PAY_ENABLED) {
    // Lazy import to avoid bundling Terminal SDK until entitlement is approved
    const { TerminalProvider } = require('./src/context/TerminalContext');
    return (
      <TerminalProvider venueId={session.venueId}>
        <MainTabs />
      </TerminalProvider>
    );
  }

  return <MainTabs />;
}

export default function App() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </SessionProvider>
  );
}
