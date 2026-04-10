// ─────────────────────────────────────────────────────────────────────
// SuperAdminEventSelector — shown after super admin PIN auth
// Lists all events with ticketing, searchable by event or venue name
// Upcoming/active by default, "Show All" toggle for historical
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, ActivityIndicator, SafeAreaView,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { useSession, EventSession } from '../context/SessionContext';

interface EventOption {
  id: string;
  title: string;
  venueName: string;
  venueId: string;
  venueLatitude: number;
  venueLongitude: number;
  date: string;
  time: string;
  status: string;
  ticketCount: number;
  soldCount: number;
}

// Helper — is this event upcoming or active (today or future)?
function isUpcoming(dateStr: string): boolean {
  if (!dateStr) return true; // no date = show by default
  try {
    // Handle formats like "Apr 6, 2026" or "2026-04-06"
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d >= today;
  } catch { return true; }
}

export default function SuperAdminEventSelector() {
  const { session, setSession, clearSession } = useSession();
  const [events, setEvents]       = useState<EventOption[]>([]);
  const [loading, setLoading]     = useState(true);
  const [query, setQuery]         = useState('');
  const [showAll, setShowAll]     = useState(false);

  useEffect(() => {
    firestore()
      .collection('events')
      .where('hasTickets', '==', true)
      .get()
      .then(async snap => {
        const loaded: EventOption[] = [];
        for (const d of snap.docs) {
          const data = d.data();
          // Get sold count from ticketTypes subcollection
          let soldCount = 0;
          try {
            const ttSnap = await firestore()
              .collection('events').doc(d.id)
              .collection('ticketTypes').get();
            soldCount = ttSnap.docs.reduce((s, t) => s + (t.data().sold || 0), 0);
          } catch {}
          loaded.push({
            id: d.id,
            title: data.title || 'Untitled Event',
            venueName: data.venue || data.venueName || '',
            venueId: data.venueId || '',
            venueLatitude: data.venueLatitude || 0,
            venueLongitude: data.venueLongitude || 0,
            date: data.date || '',
            time: data.time || '',
            status: data.status || 'approved',
            ticketCount: 0,
            soldCount,
          });
        }
        // Sort: upcoming first, then by date desc
        loaded.sort((a, b) => {
          const da = new Date(a.date).getTime() || 0;
          const db = new Date(b.date).getTime() || 0;
          return db - da;
        });
        setEvents(loaded);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Filter by upcoming/all + search query
  const filtered = useMemo(() => {
    let list = showAll ? events : events.filter(e => isUpcoming(e.date));
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(e =>
        e.title.toLowerCase().includes(q) ||
        e.venueName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [events, query, showAll]);

  function selectEvent(event: EventOption) {
    if (!session) return;
    // Update session with real event data — keeps isSuperAdmin true
    const updated: EventSession = {
      ...session,
      eventId:        event.id,
      eventName:      event.title,
      venueName:      event.venueName,
      venueId:        event.venueId,
      venueLatitude:  event.venueLatitude,
      venueLongitude: event.venueLongitude,
      date:           event.date,
    };
    setSession(updated);
  }

  function renderEvent({ item }: { item: EventOption }) {
    const upcoming = isUpcoming(item.date);
    return (
      <TouchableOpacity style={styles.card} onPress={() => selectEvent(item)} activeOpacity={0.7}>
        <View style={styles.cardLeft}>
          <View style={[styles.statusDot, { backgroundColor: upcoming ? '#2a7a5a' : '#444' }]} />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.cardVenue} numberOfLines={1}>{item.venueName}</Text>
          <Text style={styles.cardDate}>{item.date}{item.time ? ` · ${item.time}` : ''}</Text>
        </View>
        <View style={styles.cardRight}>
          {item.soldCount > 0 && (
            <Text style={styles.soldBadge}>{item.soldCount} sold</Text>
          )}
          <Text style={styles.arrow}>›</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Select Event</Text>
            <View style={styles.superAdminBadge}>
              <Text style={styles.superAdminText}>⚡ SUPER ADMIN</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={clearSession}
            style={styles.logOutBtn}>
            <Text style={styles.logOutBtnText}>Log Out</Text>
          </TouchableOpacity>
        </View>

        {/* Search bar */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search event or venue…"
            placeholderTextColor="#555"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Show All toggle */}
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>
            {showAll ? 'Showing all events' : 'Showing upcoming only'}
          </Text>
          <TouchableOpacity
            style={[styles.toggleBtn, showAll && styles.toggleBtnActive]}
            onPress={() => setShowAll(v => !v)}>
            <Text style={[styles.toggleBtnText, showAll && styles.toggleBtnTextActive]}>
              {showAll ? 'Upcoming Only' : 'Show All'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Event list */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#2a7a5a" size="large" />
          <Text style={styles.loadingText}>Loading events…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={e => e.id}
          renderItem={renderEvent}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyIcon}>🎟</Text>
              <Text style={styles.emptyText}>
                {query ? `No events matching "${query}"` : 'No upcoming events with ticketing'}
              </Text>
              {!showAll && !query && (
                <TouchableOpacity onPress={() => setShowAll(true)} style={styles.showAllLink}>
                  <Text style={styles.showAllLinkText}>Show all events</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0a0a0a' },
  centered:         { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  header:           { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  headerTitle:      { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 6 },
  superAdminBadge:  { backgroundColor: '#7c3aed', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  superAdminText:   { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  searchRow:        { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10 },
  searchInput:      { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, color: '#fff', fontSize: 16, borderWidth: 1, borderColor: '#2a2a2a' },
  clearBtn:         { position: 'absolute', right: 12, padding: 4 },
  clearBtnText:     { color: '#555', fontSize: 16 },
  toggleRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 },
  toggleLabel:      { fontSize: 12, color: '#555' },
  toggleBtn:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a' },
  toggleBtnActive:  { borderColor: '#7c3aed', backgroundColor: '#2d1f4d' },
  toggleBtnText:    { fontSize: 12, fontWeight: '600', color: '#555' },
  toggleBtnTextActive: { color: '#a78bfa' },
  list:             { paddingHorizontal: 16, paddingBottom: 40 },
  card:             { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161616', borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: '#222', padding: 16 },
  cardLeft:         { marginRight: 12 },
  statusDot:        { width: 10, height: 10, borderRadius: 5 },
  cardBody:         { flex: 1 },
  cardTitle:        { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 2 },
  cardVenue:        { fontSize: 13, color: '#888', marginBottom: 2 },
  cardDate:         { fontSize: 12, color: '#555' },
  cardRight:        { alignItems: 'flex-end', gap: 6 },
  soldBadge:        { fontSize: 11, fontWeight: '700', color: '#2a7a5a', backgroundColor: '#0d1f16', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  arrow:            { fontSize: 22, color: '#333' },
  loadingText:      { color: '#555', fontSize: 14, marginTop: 12 },
  emptyIcon:        { fontSize: 48, marginBottom: 12 },
  emptyText:        { color: '#555', fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
  showAllLink:      { marginTop: 16, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, borderColor: '#7c3aed' },
  showAllLinkText:  { color: '#a78bfa', fontWeight: '600', fontSize: 14 },
  logOutBtn:        { backgroundColor: '#2a1a1a', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: '#cc3333', alignSelf: 'flex-start' },
  logOutBtnText:    { color: '#cc3333', fontWeight: '700', fontSize: 14 },
});
