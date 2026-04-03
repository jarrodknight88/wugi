import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
} from 'react-native';
import { useSession } from '../context/SessionContext';
import ScannerScreen from './ScannerScreen';
import ManualLookupScreen from './ManualLookupScreen';
import DashboardScreen from './DashboardScreen';

type Tab = 'scan' | 'lookup' | 'dashboard';

export default function MainTabs() {
  const [activeTab, setActiveTab] = React.useState<Tab>('scan');
  const { session } = useSession();

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'scan', label: 'Scan', icon: '⬛' },
    { id: 'lookup', label: 'Lookup', icon: '🔍' },
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screens}>
        <View style={{ display: activeTab === 'scan' ? 'flex' : 'none', flex: 1 }}>
          <ScannerScreen />
        </View>
        <View style={{ display: activeTab === 'lookup' ? 'flex' : 'none', flex: 1 }}>
          <ManualLookupScreen />
        </View>
        <View style={{ display: activeTab === 'dashboard' ? 'flex' : 'none', flex: 1 }}>
          <DashboardScreen />
        </View>
      </View>

      <View style={styles.tabBar}>
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.id}
            style={styles.tabItem}
            onPress={() => setActiveTab(tab.id)}
          >
            <Text style={styles.tabIcon}>{tab.icon}</Text>
            <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>
              {tab.label}
            </Text>
            {activeTab === tab.id && <View style={styles.tabIndicator} />}
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  screens: { flex: 1 },
  tabBar: {
    flexDirection: 'row', backgroundColor: '#111',
    borderTopWidth: 1, borderTopColor: '#1e1e1e',
    paddingBottom: 4,
  },
  tabItem: {
    flex: 1, alignItems: 'center', paddingVertical: 10, position: 'relative',
  },
  tabIcon: { fontSize: 18, marginBottom: 2 },
  tabLabel: { fontSize: 11, color: '#555', fontWeight: '500' },
  tabLabelActive: { color: '#2a7a5a', fontWeight: '700' },
  tabIndicator: {
    position: 'absolute', top: 0, left: '25%', right: '25%',
    height: 2, backgroundColor: '#2a7a5a', borderRadius: 1,
  },
});
