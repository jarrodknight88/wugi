// ─────────────────────────────────────────────────────────────────────
// DashboardScreen — capacity gauge + activity feed, per
// docs/DOOR-REDESIGN-SPEC.md §6 ("Dashboard: restyle + capacity gauge").
// System font only — PP Neue Montreal is not yet an approved dependency.
// No expo-haptics / expo-av in this build; see TODOs below for the spots
// that want them once approved.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Alert, Modal,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { useSession } from '../context/SessionContext';
import { COLORS, PASS_FALLBACK } from '../constants/colors';
import CapacityCard from '../components/CapacityCard';
import RecentActivityList, { ActivityItem } from '../components/RecentActivityList';
import SellSheet, { SellableType } from '../components/SellSheet';

const TAP_TO_PAY_ENABLED = true;
type PaymentMode = any;

interface TicketTypeStat {
  id: string; name: string; total: number; checkedIn: number;
  color: string; price: number; remaining: number;
}

// Builds the live activity feed from a pass query snapshot's docs. Only
// 'success' items are ever produced today — see RecentActivityList.tsx for
// why denials can't be populated yet.
function buildRecentActivity(docs: any[]): ActivityItem[] {
  return docs
    .filter(d => d.data().scanStatus === 'scanned' && !!d.data().scannedAt?.toDate)
    .map(d => ({
      id: d.id,
      name: d.data().holderName || 'Guest',
      tier: d.data().ticketTypeName || '',
      at: d.data().scannedAt.toDate() as Date,
      status: 'success' as const,
    }))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 8);
}

interface Props {
  /** Wired up by MainTabs once it owns real tab switching — see PR notes. */
  onScanPress?: () => void;
  onLookupPress?: () => void;
}

export default function DashboardScreen({ onScanPress, onLookupPress }: Props = {}) {
  const { session, clearSession, setSession } = useSession();
  const [totalTickets, setTotalTickets]     = useState(0);
  const [checkedInCount, setCheckedInCount] = useState(0);
  const [balanceDueCount, setBalanceDueCount] = useState(0);
  const [typeStats, setTypeStats]           = useState<TicketTypeStat[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [lastUpdated, setLastUpdated]       = useState<Date>(new Date());
  const [paymentMode, setPaymentMode]       = useState<PaymentMode | null>(null);
  const [sellSheetVisible, setSellSheetVisible] = useState(false);

  // Live ticket stats — venue event OR super admin aggregate
  useEffect(() => {
    if (!session) return;

    if (session.isSuperAdmin) {
      // Super admin: aggregate across all passes
      const unsub = firestore()
        .collection('passes')
        .onSnapshot(snap => {
          const active = snap.docs.filter(d => d.data().source !== 'door');
          setTotalTickets(active.length);
          setCheckedInCount(active.filter(d => d.data().scanStatus === 'scanned').length);
          setBalanceDueCount(active.filter(d => (d.data().balanceDue ?? 0) > 0).length);
          setRecentActivity(buildRecentActivity(active));
          setLastUpdated(new Date());
        }, () => {});
      return unsub;
    }

    // Venue staff: single event — query passes collection by eventId
    const unsub = firestore()
      .collection('passes')
      .where('eventId', '==', session.eventId)
      .where('source', '!=', 'door')
      .onSnapshot(snap => {
        setTotalTickets(snap.docs.length);
        setCheckedInCount(snap.docs.filter(d => d.data().scanStatus === 'scanned').length);
        setBalanceDueCount(snap.docs.filter(d => (d.data().balanceDue ?? 0) > 0).length);
        setRecentActivity(buildRecentActivity(snap.docs));
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
          color: d.data().color || PASS_FALLBACK,
          price: d.data().price || 0,
          remaining: d.data().remaining ?? d.data().capacity ?? 0,
        })));
      }, () => {});
    return unsub;
  }, [session]);

  const remaining = totalTickets - checkedInCount;

  // Event capacity, derived from the ticket-type schema (sum of
  // ticketTypes[].capacity) rather than a dedicated field — none exists.
  // Unavailable for super-admin aggregate mode or events with no ticket
  // types configured; CapacityCard degrades to count-only in that case.
  const totalCapacity = useMemo(() => {
    if (session?.isSuperAdmin || typeStats.length === 0) return null;
    const sum = typeStats.reduce((acc, t) => acc + (t.total || 0), 0);
    return sum > 0 ? sum : null;
  }, [typeStats, session?.isSuperAdmin]);

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

  function handleScanPress() {
    // TODO(haptics): light impact on press once expo-haptics is approved.
    // MainTabs owns real tab switching and isn't touched by this task —
    // it can pass a real onScanPress once it's ready (see PR notes).
    if (onScanPress) onScanPress();
    else Alert.alert('Scan', 'Tap the Scan tab below to check in a ticket.');
  }

  function handleLookupPress() {
    if (onLookupPress) onLookupPress();
    else Alert.alert('Look Up', 'Tap the Lookup tab below to find a guest by name.');
  }

  function handleSell(type: SellableType) {
    setSellSheetVisible(false);
    setPaymentMode({
      type: 'walkin',
      ticketTypeName: type.name,
      ticketTypeId: type.id,
      price: type.price,
      color: type.color,
    });
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

      <SellSheet
        visible={sellSheetVisible}
        types={typeStats}
        onSelect={handleSell}
        onClose={() => setSellSheetVisible(false)}
      />

      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.subtitle}>{session?.eventName}</Text>
          <Text style={styles.venue}>{session?.venueName} · {session?.date}</Text>
          {session?.isSuperAdmin && (
            // NOTE: #7c3aed/#a78bfa here are the "Super Admin" badge chrome,
            // NOT the getPassStyle VIP pass colour — verified no pass data
            // flows through this badge. No token in the given set covers an
            // admin/purple accent, so left as literals. See PR description.
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <View style={{ backgroundColor: '#7c3aed', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: COLORS.text, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>⚡ SUPER ADMIN</Text>
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

      {/* Capacity gauge — hero */}
      <CapacityCard checkedIn={checkedInCount} capacity={totalCapacity} />

      {/* Balance due warning */}
      {balanceDueCount > 0 && (
        <View style={styles.balanceCard}>
          <Text style={styles.balanceCardText}>⚠️  {balanceDueCount} ticket{balanceDueCount !== 1 ? 's' : ''} with balance due at door</Text>
        </View>
      )}

      {/* Primary action */}
      <TouchableOpacity style={styles.primaryBtn} onPress={handleScanPress} activeOpacity={0.85}>
        <Text style={styles.primaryBtnText}>Scan ticket / QR check-in</Text>
      </TouchableOpacity>

      {/* Secondary actions */}
      <View style={styles.secondaryRow}>
        <TouchableOpacity style={styles.secondaryTile} onPress={() => setSellSheetVisible(true)} activeOpacity={0.8}>
          <Text style={styles.secondaryTileIcon}>💳</Text>
          <Text style={styles.secondaryTileLabel}>Sell / Tap to Pay</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryTile} onPress={handleLookupPress} activeOpacity={0.8}>
          <Text style={styles.secondaryTileIcon}>🔍</Text>
          <Text style={styles.secondaryTileLabel}>Look up / By name</Text>
        </TouchableOpacity>
      </View>

      {/* Recent activity */}
      <RecentActivityList items={recentActivity} />

      {/* Ticket type breakdown — venue only */}
      {!session?.isSuperAdmin && typeStats.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Ticket Types</Text>
          {typeStats.map(stat => (
            <View key={stat.id} style={styles.typeRow}>
              <View style={[styles.typeAccent, { backgroundColor: stat.color }]} />
              <View style={styles.typeBody}>
                <Text style={styles.typeName}>{stat.name}</Text>
                <Text style={styles.typeSub}>
                  {stat.remaining} left · ${(stat.price / 100).toFixed(2)}
                </Text>
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
          {/* Same admin-purple family as the badge above — left as literals for the same reason. */}
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
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 60 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  subtitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  venue: { fontSize: 12, color: COLORS.subtext, marginTop: 2 },
  endBtn: { backgroundColor: COLORS.stopDeep, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: COLORS.stop },
  endBtnText: { color: COLORS.stop, fontWeight: '700', fontSize: 14 },
  balanceCard: { backgroundColor: COLORS.warnDeep, borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: COLORS.warn },
  balanceCardText: { color: COLORS.warn, fontWeight: '700', fontSize: 14 },
  primaryBtn: { backgroundColor: COLORS.brand, borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginBottom: 12 },
  primaryBtnText: { color: COLORS.onBrand, fontWeight: '800', fontSize: 17 },
  secondaryRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  secondaryTile: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: COLORS.divider,
    paddingVertical: 16, alignItems: 'center', gap: 6,
  },
  secondaryTileIcon: { fontSize: 20 },
  secondaryTileLabel: { fontSize: 13, fontWeight: '700', color: COLORS.text, textAlign: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 14, marginTop: 8 },
  typeRow: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.divider, overflow: 'hidden' },
  typeAccent: { width: 5 },
  typeBody: { flex: 1, padding: 14 },
  typeName: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  typeSub: { fontSize: 12, color: COLORS.subtext, marginTop: 2, marginBottom: 10 },
  typeBarBg: { height: 5, backgroundColor: COLORS.card2, borderRadius: 3, overflow: 'hidden' },
  typeBarFill: { height: '100%', borderRadius: 3 },
  updated: { fontSize: 11, color: '#333', textAlign: 'center', marginTop: 24 },
});
