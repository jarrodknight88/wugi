import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, FlatList, ActivityIndicator, Alert,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { useSession } from '../context/SessionContext';

interface Ticket {
  id: string;
  holderName: string;
  holderEmail: string;
  ticketType: string;
  quantity: number;
  checkedIn: boolean;
  checkedInAt?: any;
}

export default function ManualLookupScreen() {
  const { session } = useSession();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch() {
    if (!query.trim() || !session) return;
    setLoading(true);
    setSearched(true);
    try {
      const snap = await firestore()
        .collection('tickets')
        .where('eventId', '==', session.eventId)
        .orderBy('holderName')
        .startAt(query.trim())
        .endAt(query.trim() + '\uf8ff')
        .get();

      setResults(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ticket)));
    } catch (e) {
      Alert.alert('Error', 'Search failed. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckIn(ticket: Ticket) {
    if (ticket.checkedIn) {
      Alert.alert('Already checked in', `${ticket.holderName} was already checked in.`);
      return;
    }
    Alert.alert(
      'Check In',
      `Check in ${ticket.holderName}?\n${ticket.ticketType} · ${ticket.quantity > 1 ? `×${ticket.quantity}` : '1 ticket'}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            await firestore().collection('tickets').doc(ticket.id).update({
              checkedIn: true,
              checkedInAt: firestore.FieldValue.serverTimestamp(),
              checkedInBy: session?.pin,
            });
            setResults(prev =>
              prev.map(t => t.id === ticket.id ? { ...t, checkedIn: true } : t)
            );
          },
        },
      ]
    );
  }

  function renderTicket({ item }: { item: Ticket }) {
    return (
      <View style={[styles.ticketCard, item.checkedIn && styles.ticketChecked]}>
        <View style={styles.ticketLeft}>
          <Text style={styles.ticketName}>{item.holderName}</Text>
          <Text style={styles.ticketSub}>{item.holderEmail}</Text>
          <Text style={styles.ticketType}>
            {item.ticketType} {item.quantity > 1 ? `· ×${item.quantity}` : ''}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.checkInBtn, item.checkedIn && styles.checkInBtnDone]}
          onPress={() => handleCheckIn(item)}
          disabled={item.checkedIn}
        >
          <Text style={styles.checkInBtnText}>
            {item.checkedIn ? '✓ In' : 'Check In'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Manual Lookup</Text>
      <Text style={styles.subtitle}>{session?.eventName}</Text>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="Search by name…"
          placeholderTextColor="#555"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          autoCapitalize="words"
        />
        <TouchableOpacity style={styles.searchBtn} onPress={handleSearch}>
          <Text style={styles.searchBtnText}>Search</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#2a7a5a" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={t => t.id}
          renderItem={renderTicket}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            searched ? (
              <Text style={styles.emptyText}>No tickets found for "{query}"</Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', paddingTop: 56 },
  title: { fontSize: 22, fontWeight: '800', color: '#fff', paddingHorizontal: 20, marginBottom: 2 },
  subtitle: { fontSize: 13, color: '#888', paddingHorizontal: 20, marginBottom: 20 },
  searchRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 16 },
  input: {
    flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    color: '#fff', fontSize: 16, borderWidth: 1, borderColor: '#2a2a2a',
  },
  searchBtn: {
    backgroundColor: '#2a7a5a', borderRadius: 12,
    paddingHorizontal: 18, justifyContent: 'center',
  },
  searchBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  ticketCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#161616', borderRadius: 14, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: '#222',
  },
  ticketChecked: { opacity: 0.5 },
  ticketLeft: { flex: 1 },
  ticketName: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 2 },
  ticketSub: { fontSize: 12, color: '#666', marginBottom: 4 },
  ticketType: { fontSize: 13, color: '#2a7a5a', fontWeight: '500' },
  checkInBtn: {
    backgroundColor: '#2a7a5a', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 16,
  },
  checkInBtnDone: { backgroundColor: '#1a3d2a' },
  checkInBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  emptyText: { color: '#555', textAlign: 'center', marginTop: 40, fontSize: 15 },
});
