// ─────────────────────────────────────────────────────────────────────
// TransactionsScreen — Tonight's door sales & balance payments
// Shows walk-up tickets and balance collections for the current event
// Allows staff to capture pending or refund completed transactions
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, Modal, RefreshControl, TextInput,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import { useSession } from '../context/SessionContext';

interface Transaction {
  id: string;
  paymentIntentId: string;
  amountCents: number;
  bookingFeeCents: number;
  venuePayout: number;
  holderName?: string;
  ticketTypeName?: string;
  source: string;
  status: string;
  transferStatus?: string;
  idVerification?: any;
  createdAt: any;
  eventId: string;
  venueId: string;
  isBalance?: boolean;
  cardLast4?: string | null;
  cardBrand?: string | null;
  cardholderName?: string | null;
  chargeId?: string | null;
}

export default function TransactionsScreen() {
  const { session } = useSession();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  function load(isRefresh = false) {
    if (!session) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    // Query terminalPayments — covers both walk-up sales and balance collections
    const query = session.isSuperAdmin
      ? firestore().collection('terminalPayments').orderBy('createdAt', 'desc').limit(100)
      : firestore().collection('terminalPayments')
          .where('eventId', '==', session.eventId)
          .orderBy('createdAt', 'desc').limit(100);

    query.get().then(snap => {
      const docs = snap.docs.map(d => {
        const data = d.data() as any;
        return {
          id: d.id,
          paymentIntentId: data.paymentIntentId || '',
          amountCents: data.amountCents || 0,
          bookingFeeCents: data.bookingFeeCents || 0,
          venuePayout: data.venuePayout || 0,
          holderName: data.newTicketData?.holderName || data.holderName || null,
          ticketTypeName: data.newTicketData?.ticketTypeName || data.ticketTypeName || null,
          ticketId: data.ticketId || null,
          source: data.source || 'tap_to_pay',
          status: data.status || 'succeeded',
          transferStatus: data.transferStatus,
          idVerification: data.idVerification || null,
          createdAt: data.createdAt,
          eventId: data.eventId,
          venueId: data.venueId,
          isBalance: !!data.ticketId && !data.newTicketData,
          cardLast4: data.cardLast4 || null,
          cardBrand: data.cardBrand || null,
          cardholderName: data.cardholderName || null,
          chargeId: data.chargeId || null,
        } as Transaction;
      });
      // Sort newest first
      docs.sort((a: any, b: any) => {
        const ta = a.createdAt?.toDate?.() || new Date(0);
        const tb = b.createdAt?.toDate?.() || new Date(0);
        return tb.getTime() - ta.getTime();
      });
      setTransactions(docs);
    }).catch((e) => {
      console.warn('Transaction load error:', e.message);
    }).finally(() => {
      setLoading(false);
      setRefreshing(false);
    });
  }

  useEffect(() => { load(); }, [session]);

  async function handleRefund(tx: Transaction) {
    Alert.alert(
      'Refund Payment',
      `Refund $${(tx.amountCents / 100).toFixed(2)} to ${tx.holderName || 'guest'}?\n\nThis will appear on their card within minutes.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Refund', style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              const fn = httpsCallable(getFunctions(), 'refundDoorSale');
              await fn({
                paymentIntentId: tx.paymentIntentId,
                reason: 'venue_denied',
                staffNote: 'Refunded by door staff via transactions screen',
              });
              Alert.alert('Refunded', 'The customer will see the refund within minutes.');
              setSelected(null);
              load(true);
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Refund failed');
            } finally {
              setActionLoading(false);
            }
          }
        }
      ]
    );
  }

  function formatTime(ts: any): string {
    if (!ts) return '';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function statusColor(status: string): string {
    if (status === 'succeeded') return '#2a7a5a';
    if (status === 'refunded') return '#cc3333';
    if (status === 'pending') return '#e6a817';
    return '#555';
  }

  function statusLabel(tx: Transaction): string {
    if (tx.status === 'refunded') return 'REFUNDED';
    if (tx.status === 'succeeded') return 'PAID';
    if (tx.status === 'pending') return 'PENDING';
    return tx.status?.toUpperCase() || 'UNKNOWN';
  }

  // Filter transactions by search query (name or last 4)
  const filteredTransactions = searchQuery.trim()
    ? transactions.filter(t => {
        const q = searchQuery.trim().toLowerCase();
        return (
          (t.holderName || '').toLowerCase().includes(q) ||
          (t.cardholderName || '').toLowerCase().includes(q) ||
          (t.cardLast4 || '').includes(q)
        );
      })
    : transactions;

  const totalRevenue = transactions
    .filter(t => t.status === 'succeeded')
    .reduce((sum, t) => sum + t.amountCents, 0);
  const totalPayout = transactions
    .filter(t => t.status === 'succeeded')
    .reduce((sum, t) => sum + (t.venuePayout || 0), 0);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color="#2a7a5a" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Detail modal */}
      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet">
        {selected && (
          <View style={styles.detailContainer}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>Transaction Detail</Text>
              <TouchableOpacity onPress={() => setSelected(null)}>
                <Text style={styles.detailClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.detailCard}>
              <Text style={styles.detailAmount}>${(selected.amountCents / 100).toFixed(2)}</Text>
              <Text style={[styles.detailStatus, { color: statusColor(selected.status) }]}>
                {statusLabel(selected)}
              </Text>
              <Text style={styles.detailGuest}>{selected.holderName || 'Walk-up guest'}</Text>
              {selected.ticketTypeName && (
                <Text style={styles.detailType}>{selected.ticketTypeName}</Text>
              )}
            </View>

            <View style={styles.detailRows}>
              <DetailRow label="Time" value={formatTime(selected.createdAt)} />
              <DetailRow label="Amount" value={`$${(selected.amountCents / 100).toFixed(2)}`} />
              <DetailRow label="Booking Fee" value={`$${((selected.bookingFeeCents || 0) / 100).toFixed(2)}`} />
              <DetailRow label="Venue Payout" value={`$${((selected.venuePayout || 0) / 100).toFixed(2)}`} />
              <DetailRow label="Transfer" value={selected.transferStatus || 'N/A'} />
              <DetailRow label="Reference" value={selected.paymentIntentId.slice(-8).toUpperCase()} />
              {selected.cardLast4 && (
                <DetailRow label="Card" value={`${selected.cardBrand ? selected.cardBrand.toUpperCase() + ' ' : ''}••••${selected.cardLast4}`} />
              )}
              {selected.cardholderName && (
                <DetailRow label="Card Name" value={selected.cardholderName} />
              )}
              {selected.idVerification && (
                <>
                  <DetailRow label="ID Name" value={selected.idVerification.idName || 'N/A'} />
                  <DetailRow label="ID Age" value={`${selected.idVerification.age || 'N/A'}`} />
                  <DetailRow label="ID Verified" value={selected.idVerification.verified ? '✓ Yes' : '✗ No'} />
                </>
              )}
            </View>

            {selected.status === 'succeeded' && (
              <TouchableOpacity
                style={[styles.refundBtn, actionLoading && { opacity: 0.5 }]}
                onPress={() => handleRefund(selected)}
                disabled={actionLoading}>
                {actionLoading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.refundBtnText}>↩ Issue Refund</Text>
                }
              </TouchableOpacity>
            )}

            {selected.status === 'refunded' && (
              <View style={styles.refundedBadge}>
                <Text style={styles.refundedText}>This transaction has been refunded</Text>
              </View>
            )}
          </View>
        )}
      </Modal>

      {/* Summary header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Tonight's Transactions</Text>
        <Text style={styles.headerSub}>{transactions.length} transactions · ${(totalRevenue / 100).toFixed(2)} total</Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or last 4 of card…"
          placeholderTextColor="#555"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      {/* Summary cards */}
      {transactions.length > 0 && (
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryNum}>{transactions.filter(t => t.status === 'succeeded').length}</Text>
            <Text style={styles.summaryLabel}>Completed</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={[styles.summaryNum, { color: '#2a7a5a' }]}>${(totalRevenue / 100).toFixed(0)}</Text>
            <Text style={styles.summaryLabel}>Charged</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={[styles.summaryNum, { color: '#4ade80' }]}>${(totalPayout / 100).toFixed(0)}</Text>
            <Text style={styles.summaryLabel}>Venue Gets</Text>
          </View>
        </View>
      )}

      {transactions.length === 0 ? (
        <View style={[styles.centered, { flex: 1 }]}>
          <Text style={styles.emptyIcon}>💳</Text>
          <Text style={styles.emptyText}>No door transactions yet</Text>
          <Text style={styles.emptySub}>Walk-up sales and balance payments will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={filteredTransactions}
          keyExtractor={t => t.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#2a7a5a" />}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.txRow} onPress={() => setSelected(item)}>
              <View style={[styles.txDot, { backgroundColor: statusColor(item.status) }]} />
              <View style={styles.txBody}>
                <View style={styles.txTop}>
                  <Text style={styles.txName}>{item.holderName || 'Walk-up guest'}</Text>
                  <Text style={[styles.txAmount, { color: item.status === 'refunded' ? '#555' : '#fff' }]}>
                    {item.status === 'refunded' ? '—' : ''} ${(item.amountCents / 100).toFixed(2)}
                  </Text>
                </View>
                <View style={styles.txBottom}>
                  <Text style={styles.txType}>{item.isBalance ? '⚖️ Balance Payment' : item.ticketTypeName || 'Door Sale'}</Text>
                  <View style={styles.txMeta}>
                    <Text style={[styles.txStatus, { color: statusColor(item.status) }]}>{statusLabel(item)}</Text>
                    <Text style={styles.txTime}>{formatTime(item.createdAt)}</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailRowLabel}>{label}</Text>
      <Text style={styles.detailRowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 13, color: '#555', marginTop: 2 },
  summaryRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  summaryCard: { flex: 1, backgroundColor: '#161616', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#222' },
  summaryNum: { fontSize: 24, fontWeight: '800', color: '#fff' },
  summaryLabel: { fontSize: 10, color: '#555', marginTop: 2 },
  txRow: { flexDirection: 'row', backgroundColor: '#111', marginHorizontal: 16, marginBottom: 8, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#1a1a1a', alignItems: 'center' },
  txDot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  txBody: { flex: 1 },
  txTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  txName: { fontSize: 15, fontWeight: '700', color: '#fff' },
  txAmount: { fontSize: 16, fontWeight: '800' },
  txBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  txType: { fontSize: 12, color: '#555' },
  txMeta: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  txStatus: { fontSize: 11, fontWeight: '700' },
  txTime: { fontSize: 11, color: '#333' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 6 },
  emptySub: { fontSize: 13, color: '#555', textAlign: 'center', paddingHorizontal: 40 },
  // Detail modal
  detailContainer: { flex: 1, backgroundColor: '#0a0a0a', padding: 24, paddingTop: 56 },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  detailTitle: { fontSize: 20, fontWeight: '800', color: '#fff' },
  detailClose: { fontSize: 20, color: '#555', fontWeight: '700' },
  detailCard: { backgroundColor: '#161616', borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#2a2a2a' },
  detailAmount: { fontSize: 48, fontWeight: '800', color: '#fff', marginBottom: 4 },
  detailStatus: { fontSize: 13, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  detailGuest: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 2 },
  detailType: { fontSize: 13, color: '#555' },
  detailRows: { backgroundColor: '#111', borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#1a1a1a' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  detailRowLabel: { fontSize: 13, color: '#555' },
  detailRowValue: { fontSize: 13, color: '#fff', fontWeight: '600' },
  refundBtn: { backgroundColor: '#2a1a1a', borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: '#cc3333', marginBottom: 12 },
  refundBtnText: { color: '#cc3333', fontWeight: '800', fontSize: 16 },
  refundedBadge: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, alignItems: 'center' },
  refundedText: { color: '#555', fontSize: 13 },
  searchRow: { paddingHorizontal: 16, paddingBottom: 12 },
  searchInput: { backgroundColor: '#161616', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#2a2a2a' },
});
