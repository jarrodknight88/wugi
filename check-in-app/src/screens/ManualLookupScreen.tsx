// ─────────────────────────────────────────────────────────────────────
// ManualLookupScreen — search tickets, multi-select, color change, add guest
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, Modal, SectionList, ScrollView,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { useSession } from '../context/SessionContext';

const TAP_TO_PAY_ENABLED = false;
type PaymentMode = any;

const COLORS = [
  '#ef4444','#f97316','#f59e0b','#eab308',
  '#84cc16','#22c55e','#10b981','#14b8a6',
  '#06b6d4','#0ea5e9','#3b82f6','#6366f1',
  '#8b5cf6','#a855f7','#d946ef','#ec4899',
  '#f43f5e','#64748b','#6b7280','#374151',
  '#1f2937','#ffffff','#2a7a5a','#e6a817',
];

interface Ticket {
  id: string; holderName: string; holderEmail: string;
  ticketTypeName: string; ticketTypeId: string; color: string;
  quantity: number; checkedIn: boolean; balanceDue: number; tableAssignment?: string;
}

interface TicketType {
  id: string; name: string; price: number; color: string;
  remaining: number; walkUp: boolean; active: boolean;
}

// ── Color Picker Sheet ────────────────────────────────────────────────
function ColorPickerModal({ visible, onSelect, onClose, selectedColor }:
  { visible: boolean; onSelect: (c: string) => void; onClose: () => void; selectedColor?: string }) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.sheetHandle} />
        <Text style={s.sheetTitle}>Change Ticket Color</Text>
        <Text style={s.sheetSub}>Updates Apple Wallet pass immediately</Text>
        <View style={s.palette}>
          {COLORS.map(c => (
            <TouchableOpacity key={c} onPress={() => onSelect(c)}
              style={[s.swatch, { backgroundColor: c }, selectedColor === c && s.swatchSelected]} />
          ))}
        </View>
        <TouchableOpacity style={s.cancelSheetBtn} onPress={onClose}>
          <Text style={s.cancelSheetText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ── Add Guest Modal ───────────────────────────────────────────────────
function AddGuestModal({ visible, onClose, onCharge, ticketTypes, eventName }:
  { visible: boolean; onClose: () => void; onCharge: (mode: PaymentMode) => void; ticketTypes: TicketType[]; eventName: string }) {
  const [name,   setName]   = useState('');
  const [email,  setEmail]  = useState('');
  const [table,  setTable]  = useState('');
  const [picked, setPicked] = useState<TicketType | null>(null);
  const [custom, setCustom] = useState('');
  const [useCustom, setUseCustom] = useState(false);

  function reset() { setName(''); setEmail(''); setTable(''); setPicked(null); setCustom(''); setUseCustom(false); }

  function handleClose() { reset(); onClose(); }

  function handleCharge() {
    if (!name.trim()) { Alert.alert('Name required', 'Please enter guest name.'); return; }
    if (!picked) { Alert.alert('Ticket required', 'Please select a ticket type.'); return; }
    const amountCents = useCustom && custom
      ? Math.round(parseFloat(custom) * 100)
      : picked.price;
    if (amountCents < 50) { Alert.alert('Invalid amount', 'Amount must be at least $0.50'); return; }
    onCharge({
      type:          'walkin',
      ticketTypeName: picked.name,
      ticketTypeId:   picked.id,
      price:          amountCents,
      color:          picked.color,
      holderName:     name.trim(),
      holderEmail:    email.trim(),
      tableAssignment: table.trim(),
    });
    reset();
  }

  // Walk-up types first, then regular active types
  const allTypes = [
    ...ticketTypes.filter(t => t.walkUp),
    ...ticketTypes.filter(t => !t.walkUp && t.active),
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={s.guestModal}>
        <View style={s.guestHeader}>
          <Text style={s.guestTitle}>Add Guest</Text>
          <TouchableOpacity onPress={handleClose}><Text style={s.guestClose}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={s.guestBody} keyboardShouldPersistTaps="handled">
          <Text style={s.guestEvent}>{eventName}</Text>

          {/* Guest info */}
          <Text style={s.guestLabel}>Guest Name *</Text>
          <TextInput style={s.guestInput} value={name} onChangeText={setName}
            placeholder="Full name" placeholderTextColor="#555" autoCapitalize="words" />

          <Text style={s.guestLabel}>Email (optional)</Text>
          <TextInput style={s.guestInput} value={email} onChangeText={setEmail}
            placeholder="guest@email.com" placeholderTextColor="#555"
            keyboardType="email-address" autoCapitalize="none" />

          <Text style={s.guestLabel}>Table Assignment (optional)</Text>
          <TextInput style={s.guestInput} value={table} onChangeText={setTable}
            placeholder="e.g. Table 5" placeholderTextColor="#555" />

          {/* Ticket type selection */}
          <Text style={s.guestLabel}>Ticket Type *</Text>
          {allTypes.length === 0 ? (
            <Text style={{ color: '#555', fontSize: 13, marginBottom: 16 }}>No ticket types available</Text>
          ) : (
            <View style={s.typeList}>
              {allTypes.map(tt => (
                <TouchableOpacity key={tt.id} onPress={() => { setPicked(tt); setUseCustom(false); }}
                  style={[s.typeCard, picked?.id === tt.id && s.typeCardSelected, { borderLeftColor: tt.color, borderLeftWidth: 4 }]}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={s.typeName}>{tt.name}</Text>
                      {tt.walkUp && <View style={s.walkUpBadge}><Text style={s.walkUpText}>DOOR</Text></View>}
                    </View>
                    <Text style={s.typePrice}>${(tt.price / 100).toFixed(2)}</Text>
                  </View>
                  {picked?.id === tt.id && <Text style={{ color: '#2a7a5a', fontSize: 18 }}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Custom amount */}
          {picked && (
            <View style={s.customRow}>
              <TouchableOpacity onPress={() => setUseCustom(v => !v)} style={s.customToggle}>
                <View style={[s.customCheck, useCustom && s.customCheckOn]}>
                  {useCustom && <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text>}
                </View>
                <Text style={s.customLabel}>Use custom amount instead</Text>
              </TouchableOpacity>
              {useCustom && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }}>$</Text>
                  <TextInput style={[s.guestInput, { flex: 1, marginBottom: 0 }]}
                    value={custom} onChangeText={setCustom}
                    placeholder={`${(picked.price / 100).toFixed(2)}`}
                    placeholderTextColor="#555" keyboardType="decimal-pad" />
                </View>
              )}
            </View>
          )}

          {/* Charge button */}
          <TouchableOpacity style={[s.chargeGuestBtn, (!picked || !name.trim()) && s.chargeGuestBtnDisabled]}
            onPress={handleCharge} disabled={!picked || !name.trim()}>
            <Text style={s.chargeGuestText}>
              {picked
                ? `Charge $${((useCustom && custom ? parseFloat(custom) * 100 : picked.price) / 100).toFixed(2)}`
                : 'Select a ticket type'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
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
  const [addGuest, setAddGuest]       = useState(false);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null);

  // Load ticket types for Add Guest modal
  useEffect(() => {
    if (!session?.eventId || session.isSuperAdmin) return;
    firestore().collection('events').doc(session.eventId)
      .collection('ticketTypes').get()
      .then(snap => {
        setTicketTypes(snap.docs.map(d => ({
          id: d.id,
          name: d.data().name || '',
          price: d.data().price || 0,
          color: d.data().color || '#2a7a5a',
          remaining: d.data().remaining ?? d.data().capacity ?? 0,
          walkUp: d.data().walkUp || false,
          active: d.data().active !== false,
        })));
      }).catch(() => {});
  }, [session?.eventId]);

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
      const snap = await ref.orderBy('holderName')
        .startAt(query.trim()).endAt(query.trim() + '\uf8ff').get();
      setResults(snap.docs.map(d => ({
        id: d.id, holderName: d.data().holderName || '',
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

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAllInTable(tickets: Ticket[]) {
    setSelected(prev => {
      const n = new Set(prev);
      const all = tickets.every(t => prev.has(t.id));
      tickets.forEach(t => all ? n.delete(t.id) : n.add(t.id));
      return n;
    });
  }
  function enterMultiSelect(id: string) { setMultiSelect(true); setSelected(new Set([id])); }
  function cancelMultiSelect() { setMultiSelect(false); setSelected(new Set()); }

  async function applyColor(color: string) {
    if (selected.size === 0 || !session) return;
    setColorPicker(false); setSaving(true);
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
      setResults(prev => prev.map(t => selected.has(t.id) ? { ...t, color } : t));
      cancelMultiSelect();
      Alert.alert('✓ Updated', `Color changed for ${selected.size} ticket${selected.size !== 1 ? 's' : ''}. Apple Wallet will update shortly.`);
    } catch { Alert.alert('Error', 'Color update failed. Try again.'); }
    finally { setSaving(false); }
  }

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

  function renderTicket({ item }: { item: Ticket }) {
    const isSelected = selected.has(item.id);
    const hasBalance = item.balanceDue > 0;
    return (
      <TouchableOpacity activeOpacity={0.7}
        onPress={() => multiSelect ? toggleSelect(item.id) : undefined}
        onLongPress={() => !multiSelect && enterMultiSelect(item.id)}
        style={[s.card, item.checkedIn && s.cardChecked, isSelected && s.cardSelected]}>
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
              <TouchableOpacity style={[s.checkInBtn, item.checkedIn && s.checkInDone]}
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
      <ColorPickerModal visible={colorPicker} onSelect={applyColor} onClose={() => setColorPicker(false)}
        selectedColor={selected.size === 1 ? results.find(t => selected.has(t.id))?.color : undefined} />

      {/* Add Guest modal */}
      <AddGuestModal visible={addGuest} onClose={() => setAddGuest(false)}
        ticketTypes={ticketTypes} eventName={session?.eventName || ''}
        onCharge={(mode) => { setAddGuest(false); setPaymentMode(mode); }} />

      {/* Header with + button */}
      <View style={s.headerRow}>
        <View>
          <Text style={s.title}>Manual Lookup</Text>
          <Text style={s.subtitle}>{session?.eventName}{multiSelect ? ` · ${selected.size} selected` : ''}</Text>
        </View>
        {!multiSelect && !session?.isSuperAdmin && (
          <TouchableOpacity style={s.addBtn} onPress={() => setAddGuest(true)}>
            <Text style={s.addBtnText}>+ Add Guest</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <TextInput style={s.input} placeholder="Search by name…" placeholderTextColor="#555"
          value={query} onChangeText={setQuery} onSubmitEditing={handleSearch}
          returnKeyType="search" autoCapitalize="words" />
        <TouchableOpacity style={s.searchBtn} onPress={handleSearch}>
          <Text style={s.searchBtnText}>Search</Text>
        </TouchableOpacity>
      </View>

      {!multiSelect && results.length > 0 && (
        <Text style={s.hint}>Long press a ticket to select multiple</Text>
      )}

      {loading ? <ActivityIndicator color="#2a7a5a" style={{ marginTop: 40 }} /> : (
        <SectionList sections={sections} keyExtractor={t => t.id}
          renderItem={renderTicket} renderSectionHeader={renderSectionHeader}
          contentContainerStyle={s.list} stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={searched ? <Text style={s.empty}>No tickets found for "{query}"</Text> : null} />
      )}

      {multiSelect && (
        <View style={s.actionBar}>
          <TouchableOpacity style={s.cancelSelectBtn} onPress={cancelMultiSelect}>
            <Text style={s.cancelSelectText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.colorBtn, (selected.size === 0 || saving) && s.colorBtnDisabled]}
            onPress={() => setColorPicker(true)} disabled={selected.size === 0 || saving}>
            {saving ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.colorBtnText}>🎨  Change Color ({selected.size})</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0a0a0a', paddingTop: 56 },
  headerRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 20, marginBottom: 16 },
  title:            { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 2 },
  subtitle:         { fontSize: 13, color: '#888' },
  addBtn:           { backgroundColor: '#2a7a5a', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText:       { color: '#fff', fontWeight: '700', fontSize: 14 },
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
  // Multi-select action bar
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
  // Add Guest modal
  guestModal:       { flex: 1, backgroundColor: '#0a0a0a' },
  guestHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  guestTitle:       { fontSize: 22, fontWeight: '800', color: '#fff' },
  guestClose:       { fontSize: 20, color: '#555', padding: 4 },
  guestBody:        { padding: 20, paddingBottom: 60 },
  guestEvent:       { fontSize: 13, color: '#2a7a5a', fontWeight: '600', marginBottom: 20 },
  guestLabel:       { fontSize: 13, fontWeight: '600', color: '#aaa', marginBottom: 6, marginTop: 14 },
  guestInput:       { backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, color: '#fff', fontSize: 16, borderWidth: 1, borderColor: '#2a2a2a', marginBottom: 4 },
  typeList:         { gap: 8, marginBottom: 4 },
  typeCard:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161616', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#222' },
  typeCardSelected: { borderColor: '#2a7a5a', backgroundColor: '#0d1f16' },
  typeName:         { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 2 },
  typePrice:        { fontSize: 13, color: '#888' },
  walkUpBadge:      { backgroundColor: '#2a1a00', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#e6a817' },
  walkUpText:       { fontSize: 9, fontWeight: '800', color: '#e6a817', letterSpacing: 0.5 },
  customRow:        { backgroundColor: '#111', borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 1, borderColor: '#222' },
  customToggle:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  customCheck:      { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#333', alignItems: 'center', justifyContent: 'center' },
  customCheckOn:    { backgroundColor: '#2a7a5a', borderColor: '#2a7a5a' },
  customLabel:      { fontSize: 14, color: '#aaa', fontWeight: '500' },
  chargeGuestBtn:   { backgroundColor: '#2a7a5a', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  chargeGuestBtnDisabled: { opacity: 0.4 },
  chargeGuestText:  { color: '#fff', fontSize: 18, fontWeight: '800' },
});
