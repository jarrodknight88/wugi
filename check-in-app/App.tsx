import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import auth from '@react-native-firebase/auth';
import { SessionProvider, useSession } from './src/context/SessionContext';
import PINScreen from './src/screens/PINScreen';
import MainTabs from './src/screens/MainTabs';
import SuperAdminEventSelector from './src/screens/SuperAdminEventSelector';

const TAP_TO_PAY_ENABLED = true;

function RootNavigator({ authReady }: { authReady: boolean }) {
  const { session } = useSession();

  // No session — show PIN entry
  if (!session) return <PINScreen />;

  // Super admin authenticated but hasn't selected an event yet
  if (session.isSuperAdmin && session.eventId === '__super_admin__') {
    return <SuperAdminEventSelector />;
  }

  // Regular staff or super admin with event selected — show main tabs
  // Wait for anonymous auth before initializing Stripe Terminal SDK
  if (TAP_TO_PAY_ENABLED && authReady) {
    const { TerminalProvider } = require('./src/context/TerminalContext');
    return (
      <TerminalProvider venueId={session.venueId}>
        <MainTabs />
      </TerminalProvider>
    );
  }

  // Auth not ready yet or Tap to Pay disabled — show tabs without Terminal
  return <MainTabs />;
}

export default function App() {
  const [authReady, setAuthReady] = React.useState(false);

  useEffect(() => {
    // Sign in anonymously so Cloud Functions receive a valid auth context.
    // Wait until auth is ready before rendering Terminal-dependent components.
    const unsub = auth().onAuthStateChanged(user => {
      if (user) {
        setAuthReady(true);
      } else {
        auth().signInAnonymously().catch(() => setAuthReady(true));
      }
    });
    return unsub;
  }, []);

  return (
    <SessionProvider>
      <StatusBar style="light" />
      <RootNavigator authReady={authReady} />
    </SessionProvider>
  );
}
