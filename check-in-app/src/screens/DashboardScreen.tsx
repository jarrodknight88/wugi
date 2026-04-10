import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Alert, Modal,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { useSession } from '../context/SessionContext';

const TAP_TO_PAY_ENABLED = true;
type PaymentMode = any;

interface TicketTypeStat {
  id: string; name: string; total: number; checkedIn: number;
  color: string; price: number; remaining: number;
}

export default function DashboardScreen() {
  const { session, clearSession, setSession } = useSession();
  const [totalTickets, setTotalTickets]     = useState(0);
  const [checkedInCount, setCheckedInCount] = useState(0);
  const [balanceDueCount, setBalanceDueCount] = useState(0);
  const [typeStats, setTypeStats]           = useState<TicketTypeStat[]>([]);
  const [lastUpdated, setLastUpdated]       = useState<Date>(new Date());
  const [paymentMode, setPaymentMode]       = useState<PaymentMode | null>(null);

  // Live ticket stats — venue event OR super admin aggregate
  useEffect(() => {
    if (!session) return;

    if (session.isSuperAdmin) {
      // Super admin: aggregate across all events by listening to each event's tickets subcollection
      // We use a collection group query for efficiency
      const unsub = firestore()
        .collectionGroup('tickets')
        .onSnapshot(snap => {
          const docs = snap.docs.map(d => d.data() as any);
          setTotalTickets(docs.length);
          setCheckedInCount(docs.filter(d => d.checkedIn).length);
          setBalanceDueCount(docs.filter(d => (d.balanceDue ?? 0) > 0).length);
          setLastUpdated(new Date());
        }, () => {});
      return unsub;
    }

    // Venue staff: single event
    const unsub = firestore()
      .collection('events').doc(session.eventId)
      .collection('tickets')
      .onSnapshot(snap => {
        const docs = snap.docs.map(d => d.data() as any);
        setTotalTickets(docs.length);
        setCheckedInCount(docs.filter(d => d.checkedIn).length);
        setBalanceDueCount(docs.filter(d => (d.balanceDue ?? 0) > 0).length);
        setLastUpdated(new Date());
      }, () => {});
    return unsub;
  }, [session]);

  // Live ticket type breakdown (venue only — super admin shows aggregate counts instead)
  useEffect(() => {
    if (!session || session.isSuperAdmin) return;
    const unsub = firestore()
      .collection('events').doc(session.eventId)
      .collection('ticketTypes')
      .onSnapshot(snap => {
        setTypeStats(snap.docs.map(d => ({
          id: d.id,
          name: d.data().name || '',
          total: d.data().capacity || 0,
          checkedIn: 0,
          color: d.data().color || '#2a7a5a',
          price: d.data().price || 0,
          remaining: d.data().remaining ?? d.data().capacity ?? 0,
        })));
      }, () => {});
    return unsub;
  }, [session]);

  const remaining = totalTickets - checkedInCount;
  const pct = totalTickets > 0 ? (checkedInCount / totalTickets) * 100 : 0;

  function handleLogOut() {
    Alert.alert('Log Out', 'Return to PIN entry screen?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: clearSession },
    ]);
  }

  function handleEndSession() {
    Alert.alert('End Session', 'This will log you out of the current event.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End Session', style: 'destructive', onPress: clearSession },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Payment modal */}
      <Modal visible={TAP_TO_PAY_ENABLED && !!paymentMode} animationType="slide" presentationStyle="pageSheet">
        {TAP_TO_PAY_ENABLED && paymentMode && (() => {
          const PaymentScreen = require('./PaymentScreen').default;
          return (
            <PaymentScreen mode={paymentMode}
              onSuccess={() => setPaymentMode(null)}
              onCancel={() => setPaymentMode(null)} />
          );
        })()}
      </Modal>

      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Dashboard</Text>
          <Text style={styles.subtitle}>{session?.eventName}</Text>
          <Text style={styles.venue}>{session?.venueName} · {session?.date}</Text>
          {session?.isSuperAdmin && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <View style={{ backgroundColor: '#7c3aed', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>⚡ SUPER ADMIN</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  if (session) setSession({ ...session, eventId: '__super_admin__', eventName: 'All Events', venueName: 'Super Admin', venueId: '__super_admin__' });
                }}
                style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#7c3aed' }}>
                <Text style={{ color: '#a78bfa', fontSize: 10, fontWeight: '700' }}>Switch Event</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        {session?.isSuperAdmin ? (
          <TouchableOpacity style={styles.endBtn} onPress={handleLogOut}>
            <Text style={styles.endBtnText}>Log Out</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.endBtn} onPress={handleEndSession}>
            <Text style={styles.endBtnText}>End</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Stat cards */}
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

      {/* Balance due warning */}
      {balanceDueCount > 0 && (
        <View style={styles.balanceCard}>
          <Text style={styles.balanceCardText}>⚠️  {balanceDueCount} ticket{balanceDueCount !== 1 ? 's' : ''} with balance due at door</Text>
        </View>
      )}

      {/* Progress bar */}
      <View style={styles.progressWrap}>
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
        </View>
        <Text style={styles.progressPct}>{Math.round(pct)}% checked in</Text>
      </View>

      {/* Ticket type breakdown — venue only */}
      {!session?.isSuperAdmin && (
        <>
          <Text style={styles.sectionTitle}>Ticket Types</Text>
          {typeStats.map(stat => (
            <View key={stat.id} style={styles.typeRow}>
              <View style={[styles.typeAccent, { backgroundColor: stat.color }]} />
              <View style={styles.typeBody}>
                <View style={styles.typeTop}>
                  <View>
                    <Text style={styles.typeName}>{stat.name}</Text>
                    <Text style={styles.typeSub}>
                      {stat.remaining} left · ${(stat.price / 100).toFixed(2)}
                    </Text>
                  </View>
                  {stat.remaining > 0 && (
                    <TouchableOpacity
                      style={[styles.doorSaleBtn, { backgroundColor: stat.color }]}
                      onPress={() => setPaymentMode({
                        type: 'walkin',
                        ticketTypeName: stat.name,
                        ticketTypeId: stat.id,
                        price: stat.price,
                        color: stat.color,
                      })}>
                      <Text style={styles.doorSaleBtnText}>💳 Door Sale</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.typeBarBg}>
                  <View style={[styles.typeBarFill, {
                    width: `${stat.total > 0 ? ((stat.total - stat.remaining) / stat.total) * 100 : 0}%` as any,
                    backgroundColor: stat.color,
                  }]} />
                </View>
              </View>
            </View>
          ))}
        </>
      )}

      {/* Super admin note */}
      {session?.isSuperAdmin && (
        <View style={{ backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#7c3aed33', marginTop: 8 }}>
          <Text style={{ color: '#a78bfa', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
            ⚡ Showing aggregate across all active events
          </Text>
        </View>
      )}

      <Text style={styles.updated}>Live · Updated {lastUpdated.toLocaleTimeString()}</Text>
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
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  statCard: { flex: 1, backgroundColor: '#161616', borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#222' },
  statGreen: { borderColor: '#2a7a5a', backgroundColor: '#0d1f16' },
  statNum: { fontSize: 32, fontWeight: '800', color: '#fff' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 4 },
  balanceCard: { backgroundColor: '#2a1a00', borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#e6a817' },
  balanceCardText: { color: '#e6a817', fontWeight: '700', fontSize: 14 },
  progressWrap: { marginBottom: 28 },
  progressBg: { height: 8, backgroundColor: '#1a1a1a', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', backgroundColor: '#2a7a5a', borderRadius: 4 },
  progressPct: { fontSize: 12, color: '#555', textAlign: 'right' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 14 },
  typeRow: { flexDirection: 'row', backgroundColor: '#161616', borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: '#222', overflow: 'hidden' },
  typeAccent: { width: 5 },
  typeBody: { flex: 1, padding: 14 },
  typeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  typeName: { fontSize: 15, fontWeight: '600', color: '#fff' },
  typeSub: { fontSize: 12, color: '#888', marginTop: 2 },
  doorSaleBtn: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  doorSaleBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  typeBarBg: { height: 5, backgroundColor: '#2a2a2a', borderRadius: 3, overflow: 'hidden' },
  typeBarFill: { height: '100%', borderRadius: 3 },
  updated: { fontSize: 11, color: '#333', textAlign: 'center', marginTop: 24 },
});
