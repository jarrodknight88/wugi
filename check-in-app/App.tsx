import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from './src/context/SessionContext';
import PINScreen from './src/screens/PINScreen';
import MainTabs from './src/screens/MainTabs';
import SuperAdminEventSelector from './src/screens/SuperAdminEventSelector';

const TAP_TO_PAY_ENABLED = true;

function RootNavigator() {
  const { session } = useSession();

  // No session — show PIN entry
  if (!session) return <PINScreen />;

  // Super admin authenticated but hasn't selected an event yet
  if (session.isSuperAdmin && session.eventId === '__super_admin__') {
    return <SuperAdminEventSelector />;
  }

  // Regular staff or super admin with event selected — show main tabs
  if (TAP_TO_PAY_ENABLED) {
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
