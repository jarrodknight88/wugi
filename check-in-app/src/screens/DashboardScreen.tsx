import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { useSession } from '../context/SessionContext';

interface TicketTypeStat {
  type: string;
  total: number;
  checkedIn: number;
}

export default function DashboardScreen() {
  const { session, clearSession } = useSession();
  const [totalTickets, setTotalTickets] = useState(0);
  const [checkedInCount, setCheckedInCount] = useState(0);
  const [typeStats, setTypeStats] = useState<TicketTypeStat[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  useEffect(() => {
    if (!session) return;
    const unsub = firestore()
      .collection('tickets')
      .where('eventId', '==', session.eventId)
      .onSnapshot(snap => {
        const docs = snap.docs.map(d => d.data());
        setTotalTickets(docs.length);
        setCheckedInCount(docs.filter(d => d.checkedIn).length);
        setLastUpdated(new Date());

        // Group by ticket type
        const map: Record<string, TicketTypeStat> = {};
        docs.forEach(d => {
          const t = d.ticketType ?? 'General';
          if (!map[t]) map[t] = { type: t, total: 0, checkedIn: 0 };
          map[t].total += 1;
          if (d.checkedIn) map[t].checkedIn += 1;
        });
        setTypeStats(Object.values(map).sort((a, b) => b.total - a.total));
      });
    return unsub;
  }, [session]);

  const remaining = totalTickets - checkedInCount;
  const pct = totalTickets > 0 ? (checkedInCount / totalTickets) * 100 : 0;

  function handleEndSession() {
    Alert.alert('End Session', 'This will log you out of the current event.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End Session', style: 'destructive', onPress: clearSession },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Dashboard</Text>
          <Text style={styles.subtitle}>{session?.eventName}</Text>
          <Text style={styles.venue}>{session?.venueName} · {session?.date}</Text>
        </View>
        <TouchableOpacity style={styles.endBtn} onPress={handleEndSession}>
          <Text style={styles.endBtnText}>End</Text>
        </TouchableOpacity>
      </View>

      {/* Big stat cards */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, styles.statGreen]}>
          <Text style={styles.statNum}>{checkedInCount}</Text>
          <Text style={styles.statLabel}>Checked In</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{remaining}</Text>
          <Text style={styles.statLabel}>Remaining</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{totalTickets}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressWrap}>
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.progressPct}>{Math.round(pct)}% checked in</Text>
      </View>

      {/* Ticket type breakdown */}
      <Text style={styles.sectionTitle}>Ticket Types</Text>
      {typeStats.map(stat => (
        <View key={stat.type} style={styles.typeRow}>
          <View style={styles.typeLeft}>
            <Text style={styles.typeName}>{stat.type}</Text>
            <Text style={styles.typeSub}>{stat.checkedIn} / {stat.total} checked in</Text>
          </View>
          <View style={styles.typeBarWrap}>
            <View style={styles.typeBarBg}>
              <View
                style={[
                  styles.typeBarFill,
                  { width: `${stat.total > 0 ? (stat.checkedIn / stat.total) * 100 : 0}%` }
                ]}
              />
            </View>
          </View>
        </View>
      ))}

      <Text style={styles.updated}>
        Live · Updated {lastUpdated.toLocaleTimeString()}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 60 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  title: { fontSize: 26, fontWeight: '800', color: '#fff' },
  subtitle: { fontSize: 15, color: '#aaa', marginTop: 2 },
  venue: { fontSize: 12, color: '#555', marginTop: 1 },
  endBtn: { backgroundColor: '#2a1a1a', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: '#cc3333' },
  endBtnText: { color: '#cc3333', fontWeight: '700', fontSize: 14 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1, backgroundColor: '#161616', borderRadius: 16,
    padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#222',
  },
  statGreen: { borderColor: '#2a7a5a', backgroundColor: '#0d1f16' },
  statNum: { fontSize: 32, fontWeight: '800', color: '#fff' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 4 },
  progressWrap: { marginBottom: 28 },
  progressBg: { height: 8, backgroundColor: '#1a1a1a', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', backgroundColor: '#2a7a5a', borderRadius: 4 },
  progressPct: { fontSize: 12, color: '#555', textAlign: 'right' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 14 },
  typeRow: {
    backgroundColor: '#161616', borderRadius: 14, padding: 16,
    marginBottom: 10, borderWidth: 1, borderColor: '#222',
  },
  typeLeft: { marginBottom: 10 },
  typeName: { fontSize: 15, fontWeight: '600', color: '#fff' },
  typeSub: { fontSize: 12, color: '#888', marginTop: 2 },
  typeBarWrap: {},
  typeBarBg: { height: 6, backgroundColor: '#2a2a2a', borderRadius: 3, overflow: 'hidden' },
  typeBarFill: { height: '100%', backgroundColor: '#2a7a5a', borderRadius: 3 },
  updated: { fontSize: 11, color: '#333', textAlign: 'center', marginTop: 24 },
});
