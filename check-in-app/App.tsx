import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from './src/context/SessionContext';
import PINScreen from './src/screens/PINScreen';
import MainTabs from './src/screens/MainTabs';

function RootNavigator() {
  const { session } = useSession();
  return session ? <MainTabs /> : <PINScreen />;
}

export default function App() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </SessionProvider>
  );
}
