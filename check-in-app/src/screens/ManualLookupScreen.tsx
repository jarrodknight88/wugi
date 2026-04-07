// ─────────────────────────────────────────────────────────────────────
// ManualLookupScreen — search tickets, multi-select, color change
// Long press → multi-select mode → batch color update → wallet push
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, Modal, SectionList,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { useSession } from '../context/SessionContext';

const TAP_TO_PAY_ENABLED = false;
type PaymentMode = any;

// 24-color palette matching dashboard
const COLORS = [
  '#ef4444','#f97316','#f59e0b','#eab308',
  '#84cc16','#22c55e','#10b981','#14b8a6',
  '#06b6d4','#0ea5e9','#3b82f6','#6366f1',
  '#8b5cf6','#a855f7','#d946ef','#ec4899',
  '#f43f5e','#64748b','#6b7280','#374151',
  '#1f2937','#ffffff','#2a7a5a','#e6a817',
];

interface Ticket {
  id: string;
  holderName: string;
  holderEmail: string;
  ticketTypeName: string;
  ticketTypeId: string;
  color: string;
  quantity: number;
  checkedIn: boolean;
  balanceDue: number;
  tableAssignment?: string;
}

// ── Color Picker Sheet ────────────────────────────────────────────────
function ColorPickerModal({
  visible, onSelect, onClose, selectedColor,
}: { visible: boolean; onSelect: (c: string) => void; onClose: () => void; selectedColor?: string }) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.sheetHandle} />
        <Text style={s.sheetTitle}>Change Ticket Color</Text>
        <Text style={s.sheetSub}>Updates Apple Wallet pass immediately</Text>
        <View style={s.palette}>
          {COLORS.map(c => (
            <TouchableOpacity key={c} onPress={() => onSelect(c)} style={[
              s.swatch, { backgroundColor: c },
              selectedColor === c && s.swatchSelected,
            ]} />
          ))}
        </View>
        <TouchableOpacity style={s.cancelSheetBtn} onPress={onClose}>
          <Text style={s.cancelSheetText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

export default function ManualLookupScreen() {
  const { session } = useSession();
  const [query, setQuery]             = useState('');
  const [results, setResults]         = useState<Ticket[]>([]);
  const [loading, setLoading]         = useState(false);
  const [searched, setSearched]       = useState(false);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [multiSelect, setMultiSelect] = useState(false);
  const [colorPicker, setColorPicker] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null);

  // Group tickets by table assignment
  const sections = useMemo(() => {
    const tables: Record<string, Ticket[]> = {};
    results.forEach(t => {
      const key = t.tableAssignment?.trim() || 'No Table';
      if (!tables[key]) tables[key] = [];
      tables[key].push(t);
    });
    return Object.entries(tables)
      .sort(([a], [b]) => a === 'No Table' ? 1 : b === 'No Table' ? -1 : a.localeCompare(b))
      .map(([title, data]) => ({ title, data }));
  }, [results]);

  async function handleSearch() {
    if (!query.trim() || !session) return;
    setLoading(true); setSearched(true);
    setSelected(new Set()); setMultiSelect(false);
    try {
      const ref = session.isSuperAdmin
        ? firestore().collection('tickets')
        : firestore().collection('events').doc(session.eventId).collection('tickets');
      const snap = await ref
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
        balanceDue: d.data().balanceDue ?? 0,
        tableAssignment: d.data().tableAssignment || '',
      })));
    } catch { Alert.alert('Error', 'Search failed. Try again.'); }
    finally { setLoading(false); }
  }

  // ── Multi-select helpers ──────────────────────────────────────────
  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAllInTable(tickets: Ticket[]) {
    setSelected(prev => {
      const next = new Set(prev);
      const allSelected = tickets.every(t => prev.has(t.id));
      tickets.forEach(t => allSelected ? next.delete(t.id) : next.add(t.id));
      return next;
    });
  }

  function enterMultiSelect(id: string) {
    setMultiSelect(true);
    setSelected(new Set([id]));
  }

  function cancelMultiSelect() {
    setMultiSelect(false);
    setSelected(new Set());
  }

  // ── Batch color change ────────────────────────────────────────────
  async function applyColor(color: string) {
    if (selected.size === 0 || !session) return;
    setColorPicker(false);
    setSaving(true);
    try {
      const batch = firestore().batch();
      const now = firestore.FieldValue.serverTimestamp();
      const eventId = session.isSuperAdmin ? null : session.eventId;

      selected.forEach(id => {
        const ref = eventId
          ? firestore().collection('events').doc(eventId).collection('tickets').doc(id)
          : firestore().collection('tickets').doc(id);
        batch.update(ref, { color, passUpdatedAt: now, updatedAt: now });
      });
      await batch.commit();

      // Update local state immediately
      setResults(prev => prev.map(t =>
        selected.has(t.id) ? { ...t, color } : t
      ));
      cancelMultiSelect();
      Alert.alert('✓ Updated', `Color changed for ${selected.size} ticket${selected.size !== 1 ? 's' : ''}. Apple Wallet will update shortly.`);
    } catch {
      Alert.alert('Error', 'Color update failed. Try again.');
    } finally { setSaving(false); }
  }

  // ── Check in ─────────────────────────────────────────────────────
  async function handleCheckIn(ticket: Ticket) {
    if (ticket.checkedIn) { Alert.alert('Already checked in', `${ticket.holderName} is already in.`); return; }
    Alert.alert('Check In', `Check in ${ticket.holderName}?\n${ticket.ticketTypeName}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: async () => {
        const eventId = session?.isSuperAdmin ? (ticket as any).eventId : session?.eventId;
        if (!eventId) return;
        await firestore().collection('events').doc(eventId).collection('tickets').doc(ticket.id)
          .update({ checkedIn: true, checkedInAt: firestore.FieldValue.serverTimestamp(), checkedInBy: session?.pin });
        setResults(prev => prev.map(t => t.id === ticket.id ? { ...t, checkedIn: true } : t));
      }},
    ]);
  }

  // ── Ticket card ───────────────────────────────────────────────────
  function renderTicket({ item }: { item: Ticket }) {
    const isSelected = selected.has(item.id);
    const hasBalance = item.balanceDue > 0;
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => multiSelect ? toggleSelect(item.id) : undefined}
        onLongPress={() => !multiSelect && enterMultiSelect(item.id)}
        style={[s.card, item.checkedIn && s.cardChecked, isSelected && s.cardSelected]}>
        {/* Left: color bar or checkbox */}
        {multiSelect ? (
          <View style={[s.checkbox, isSelected && s.checkboxSelected]}>
            {isSelected && <Text style={s.checkmark}>✓</Text>}
          </View>
        ) : (
          <View style={[s.colorBar, { backgroundColor: item.color || '#2a7a5a' }]} />
        )}
        <View style={s.cardBody}>
          <View style={s.cardTop}>
            <View style={s.cardLeft}>
              <Text style={s.name}>{item.holderName}</Text>
              <Text style={s.sub}>{item.holderEmail || 'no email'}</Text>
              <Text style={s.type}>{item.ticketTypeName}</Text>
            </View>
            {!multiSelect && (
              <TouchableOpacity
                style={[s.checkInBtn, item.checkedIn && s.checkInDone]}
                onPress={() => handleCheckIn(item)} disabled={item.checkedIn}>
                <Text style={s.checkInText}>{item.checkedIn ? '✓ In' : 'Check In'}</Text>
              </TouchableOpacity>
            )}
          </View>
          {hasBalance && !multiSelect && (
            <View style={s.balanceRow}>
              <Text style={s.balanceText}>⚠️  ${(item.balanceDue / 100).toFixed(2)} due</Text>
              <TouchableOpacity style={s.chargeBtn} onPress={() => setPaymentMode({ type: 'balance', ticketId: item.id, holderName: item.holderName, holderEmail: item.holderEmail, balanceDue: item.balanceDue })}>
                <Text style={s.chargeText}>💳 Collect</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  // ── Section header (table group) ──────────────────────────────────
  function renderSectionHeader({ section }: { section: { title: string; data: Ticket[] } }) {
    const allSelected = section.data.every(t => selected.has(t.id));
    return (
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>{section.title.toUpperCase()}</Text>
        {multiSelect && (
          <TouchableOpacity onPress={() => selectAllInTable(section.data)} style={s.selectAllBtn}>
            <Text style={s.selectAllText}>{allSelected ? 'Deselect all' : 'Select all'}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={s.container}>
      {/* Payment modal */}
      <Modal visible={TAP_TO_PAY_ENABLED && !!paymentMode} animationType="slide" presentationStyle="pageSheet">
        {TAP_TO_PAY_ENABLED && paymentMode && (() => {
          const PaymentScreen = require('./PaymentScreen').default;
          return <PaymentScreen mode={paymentMode}
            onSuccess={() => { setPaymentMode(null); setResults(prev => prev.map(t => paymentMode.ticketId === t.id ? { ...t, balanceDue: 0 } : t)); }}
            onCancel={() => setPaymentMode(null)} />;
        })()}
      </Modal>

      {/* Color picker */}
      <ColorPickerModal
        visible={colorPicker}
        onSelect={applyColor}
        onClose={() => setColorPicker(false)}
        selectedColor={selected.size === 1 ? results.find(t => selected.has(t.id))?.color : undefined}
      />

      {/* Header */}
      <Text style={s.title}>Manual Lookup</Text>
      <Text style={s.subtitle}>{session?.eventName}{multiSelect ? ` · ${selected.size} selected` : ''}</Text>

      {/* Search */}
      <View style={s.searchRow}>
        <TextInput style={s.input} placeholder="Search by name…" placeholderTextColor="#555"
          value={query} onChangeText={setQuery} onSubmitEditing={handleSearch}
          returnKeyType="search" autoCapitalize="words" />
        <TouchableOpacity style={s.searchBtn} onPress={handleSearch}>
          <Text style={s.searchBtnText}>Search</Text>
        </TouchableOpacity>
      </View>

      {/* Multi-select hint */}
      {!multiSelect && results.length > 0 && (
        <Text style={s.hint}>Long press a ticket to select multiple</Text>
      )}

      {loading ? <ActivityIndicator color="#2a7a5a" style={{ marginTop: 40 }} /> : (
        <SectionList
          sections={sections}
          keyExtractor={t => t.id}
          renderItem={renderTicket}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={s.list}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={searched ? <Text style={s.empty}>No tickets found for "{query}"</Text> : null}
        />
      )}

      {/* Multi-select action bar */}
      {multiSelect && (
        <View style={s.actionBar}>
          <TouchableOpacity style={s.cancelSelectBtn} onPress={cancelMultiSelect}>
            <Text style={s.cancelSelectText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.colorBtn, (selected.size === 0 || saving) && s.colorBtnDisabled]}
            onPress={() => setColorPicker(true)}
            disabled={selected.size === 0 || saving}>
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.colorBtnText}>🎨  Change Color ({selected.size})</Text>
            }
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0a0a0a', paddingTop: 56 },
  title:            { fontSize: 22, fontWeight: '800', color: '#fff', paddingHorizontal: 20, marginBottom: 2 },
  subtitle:         { fontSize: 13, color: '#888', paddingHorizontal: 20, marginBottom: 16 },
  hint:             { fontSize: 11, color: '#444', paddingHorizontal: 20, marginBottom: 8, fontStyle: 'italic' },
  searchRow:        { flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 12 },
  input:            { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, color: '#fff', fontSize: 16, borderWidth: 1, borderColor: '#2a2a2a' },
  searchBtn:        { backgroundColor: '#2a7a5a', borderRadius: 12, paddingHorizontal: 18, justifyContent: 'center' },
  searchBtnText:    { color: '#fff', fontWeight: '700', fontSize: 15 },
  list:             { paddingHorizontal: 16, paddingBottom: 100 },
  sectionHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 8, marginTop: 8 },
  sectionTitle:     { fontSize: 11, fontWeight: '700', color: '#555', letterSpacing: 1 },
  selectAllBtn:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#2a7a5a' },
  selectAllText:    { fontSize: 12, color: '#2a7a5a', fontWeight: '600' },
  card:             { flexDirection: 'row', backgroundColor: '#161616', borderRadius: 14, marginBottom: 8, borderWidth: 1, borderColor: '#222', overflow: 'hidden' },
  cardChecked:      { opacity: 0.5 },
  cardSelected:     { borderColor: '#2a7a5a', backgroundColor: '#0d1f16' },
  colorBar:         { width: 5 },
  checkbox:         { width: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  checkboxSelected: { backgroundColor: '#2a7a5a' },
  checkmark:        { color: '#fff', fontSize: 16, fontWeight: '800' },
  cardBody:         { flex: 1, padding: 14 },
  cardTop:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLeft:         { flex: 1 },
  name:             { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 2 },
  sub:              { fontSize: 12, color: '#666', marginBottom: 4 },
  type:             { fontSize: 13, color: '#2a7a5a', fontWeight: '500' },
  checkInBtn:       { backgroundColor: '#2a7a5a', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  checkInDone:      { backgroundColor: '#1a3d2a' },
  checkInText:      { color: '#fff', fontWeight: '700', fontSize: 14 },
  balanceRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#2a2a2a' },
  balanceText:      { fontSize: 13, color: '#e6a817', fontWeight: '700' },
  chargeBtn:        { backgroundColor: '#e6a817', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14 },
  chargeText:       { color: '#000', fontWeight: '800', fontSize: 13 },
  empty:            { color: '#555', textAlign: 'center', marginTop: 40, fontSize: 15 },
  // Action bar
  actionBar:        { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 32, backgroundColor: '#111', borderTopWidth: 1, borderTopColor: '#222' },
  cancelSelectBtn:  { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  cancelSelectText: { color: '#888', fontWeight: '600', fontSize: 14 },
  colorBtn:         { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#2a7a5a', alignItems: 'center' },
  colorBtnDisabled: { opacity: 0.4 },
  colorBtnText:     { color: '#fff', fontWeight: '800', fontSize: 15 },
  // Color picker sheet
  overlay:          { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet:            { backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 48 },
  sheetHandle:      { width: 40, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetTitle:       { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 4, textAlign: 'center' },
  sheetSub:         { fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 20 },
  palette:          { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 20 },
  swatch:           { width: 44, height: 44, borderRadius: 22 },
  swatchSelected:   { transform: [{ scale: 1.25 }], borderWidth: 3, borderColor: '#fff' },
  cancelSheetBtn:   { alignItems: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  cancelSheetText:  { color: '#888', fontWeight: '600', fontSize: 15 },
});
