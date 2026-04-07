import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, FlatList, ActivityIndicator, Alert, Modal,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { useSession } from '../context/SessionContext';

const TAP_TO_PAY_ENABLED = false;
type PaymentMode = any;

interface Ticket {
  id: string;
  holderName: string;
  holderEmail: string;
  ticketTypeName: string;
  ticketTypeId: string;
  color: string;
  quantity: number;
  checkedIn: boolean;
  checkedInAt?: any;
  balanceDue: number;
}

export default function ManualLookupScreen() {
  const { session } = useSession();
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState<Ticket[]>([]);
  const [loading, setLoading]       = useState(false);
  const [searched, setSearched]     = useState(false);
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null);

  async function handleSearch() {
    if (!query.trim() || !session) return;
    setLoading(true); setSearched(true);
    try {
      const snap = await firestore()
        .collection('events').doc(session.eventId)
        .collection('tickets')
        .orderBy('holderName')
        .startAt(query.trim())
        .endAt(query.trim() + '\uf8ff')
        .get();
      setResults(snap.docs.map(d => ({
        id: d.id,
        holderName: d.data().holderName || '',
        holderEmail: d.data().holderEmail || '',
        ticketTypeName: d.data().ticketTypeName || d.data().ticketType || '',
        ticketTypeId: d.data().ticketTypeId || '',
        color: d.data().color || '#2a7a5a',
        quantity: d.data().quantity ?? 1,
        checkedIn: d.data().checkedIn === true,
        checkedInAt: d.data().checkedInAt,
        balanceDue: d.data().balanceDue ?? 0,
      })));
    } catch (e) {
      Alert.alert('Error', 'Search failed. Try again.');
    } finally { setLoading(false); }
  }

  async function handleCheckIn(ticket: Ticket) {
    if (ticket.checkedIn) {
      Alert.alert('Already checked in', `${ticket.holderName} was already checked in.`); return;
    }
    Alert.alert('Check In', `Check in ${ticket.holderName}?\n${ticket.ticketTypeName}`,
      [{ text: 'Cancel', style: 'cancel' }, {
        text: 'Confirm', onPress: async () => {
          await firestore().collection('events').doc(session!.eventId)
            .collection('tickets').doc(ticket.id).update({
              checkedIn: true,
              checkedInAt: firestore.FieldValue.serverTimestamp(),
              checkedInBy: session?.pin,
            });
          setResults(prev => prev.map(t => t.id === ticket.id ? { ...t, checkedIn: true } : t));
        },
      }]
    );
  }

  function handlePayment(ticket: Ticket) {
    setPaymentMode({
      type: 'balance',
      ticketId: ticket.id,
      holderName: ticket.holderName,
      holderEmail: ticket.holderEmail,
      balanceDue: ticket.balanceDue,
    });
  }

  function renderTicket({ item }: { item: Ticket }) {
    const hasBalance = item.balanceDue > 0;
    return (
      <View style={[styles.ticketCard, item.checkedIn && styles.ticketChecked]}>
        <View style={[styles.colorBar, { backgroundColor: item.color || '#2a7a5a' }]} />
        <View style={styles.ticketBody}>
          <View style={styles.ticketTop}>
            <View style={styles.ticketLeft}>
              <Text style={styles.ticketName}>{item.holderName}</Text>
              <Text style={styles.ticketSub}>{item.holderEmail || 'no email'}</Text>
              <Text style={styles.ticketType}>{item.ticketTypeName}</Text>
            </View>
            <TouchableOpacity
              style={[styles.checkInBtn, item.checkedIn && styles.checkInBtnDone]}
              onPress={() => handleCheckIn(item)} disabled={item.checkedIn}>
              <Text style={styles.checkInBtnText}>{item.checkedIn ? '✓ In' : 'Check In'}</Text>
            </TouchableOpacity>
          </View>
          {hasBalance && (
            <View style={styles.balanceRow}>
              <Text style={styles.balanceText}>⚠️  ${(item.balanceDue / 100).toFixed(2)} balance due</Text>
              <TouchableOpacity style={styles.chargeBtn} onPress={() => handlePayment(item)}>
                <Text style={styles.chargeBtnText}>💳 Collect</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Payment modal — active once Tap to Pay entitlement approved */}
      <Modal visible={TAP_TO_PAY_ENABLED && !!paymentMode} animationType="slide" presentationStyle="pageSheet">
        {TAP_TO_PAY_ENABLED && paymentMode && (() => {
          const PaymentScreen = require('./PaymentScreen').default;
          return (
            <PaymentScreen mode={paymentMode}
              onSuccess={() => { setPaymentMode(null); setResults(prev => prev.map(t => (paymentMode.type === 'balance' && t.id === paymentMode.ticketId) ? { ...t, balanceDue: 0 } : t)); }}
              onCancel={() => setPaymentMode(null)} />
          );
        })()}
      </Modal>

      <Text style={styles.title}>Manual Lookup</Text>
      <Text style={styles.subtitle}>{session?.eventName}</Text>
      <View style={styles.searchRow}>
        <TextInput style={styles.input} placeholder="Search by name…" placeholderTextColor="#555"
          value={query} onChangeText={setQuery} onSubmitEditing={handleSearch}
          returnKeyType="search" autoCapitalize="words" />
        <TouchableOpacity style={styles.searchBtn} onPress={handleSearch}>
          <Text style={styles.searchBtnText}>Search</Text>
        </TouchableOpacity>
      </View>
      {loading ? <ActivityIndicator color="#2a7a5a" style={{ marginTop: 40 }} /> : (
        <FlatList data={results} keyExtractor={t => t.id} renderItem={renderTicket}
          contentContainerStyle={styles.list}
          ListEmptyComponent={searched ? <Text style={styles.emptyText}>No tickets found for "{query}"</Text> : null} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', paddingTop: 56 },
  title: { fontSize: 22, fontWeight: '800', color: '#fff', paddingHorizontal: 20, marginBottom: 2 },
  subtitle: { fontSize: 13, color: '#888', paddingHorizontal: 20, marginBottom: 20 },
  searchRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 16 },
  input: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, color: '#fff', fontSize: 16, borderWidth: 1, borderColor: '#2a2a2a' },
  searchBtn: { backgroundColor: '#2a7a5a', borderRadius: 12, paddingHorizontal: 18, justifyContent: 'center' },
  searchBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  ticketCard: { flexDirection: 'row', backgroundColor: '#161616', borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: '#222', overflow: 'hidden' },
  ticketChecked: { opacity: 0.5 },
  colorBar: { width: 5 },
  ticketBody: { flex: 1, padding: 14 },
  ticketTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ticketLeft: { flex: 1 },
  ticketName: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 2 },
  ticketSub: { fontSize: 12, color: '#666', marginBottom: 4 },
  ticketType: { fontSize: 13, color: '#2a7a5a', fontWeight: '500' },
  checkInBtn: { backgroundColor: '#2a7a5a', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  checkInBtnDone: { backgroundColor: '#1a3d2a' },
  checkInBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#2a2a2a' },
  balanceText: { fontSize: 13, color: '#e6a817', fontWeight: '700' },
  chargeBtn: { backgroundColor: '#e6a817', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14 },
  chargeBtnText: { color: '#000', fontWeight: '800', fontSize: 13 },
  emptyText: { color: '#555', textAlign: 'center', marginTop: 40, fontSize: 15 },
});
