// ─────────────────────────────────────────────────────────────────────
// SellSheet — ticket-type picker behind the Dashboard's "Sell / Tap to
// Pay" secondary tile. Presentational only; DashboardScreen owns the
// resulting paymentMode / PaymentScreen modal, same as the existing
// per-type door-sale flow it replaces.
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { COLORS } from '../constants/colors';

export interface SellableType {
  id: string;
  name: string;
  color: string;
  price: number;
  remaining: number;
}

interface Props {
  visible: boolean;
  types: SellableType[];
  onSelect: (type: SellableType) => void;
  onClose: () => void;
}

export default function SellSheet({ visible, types, onSelect, onClose }: Props) {
  const sellable = types.filter(t => t.remaining > 0);

  return (
    <Modal visible={visible} transparent animationType="slide">
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Sell / Tap to Pay</Text>
        <Text style={styles.sub}>Choose a ticket type to charge</Text>

        {sellable.length === 0 ? (
          <Text style={styles.empty}>No ticket types available for door sale</Text>
        ) : (
          sellable.map(t => (
            <TouchableOpacity
              key={t.id}
              style={[styles.row, { borderLeftColor: t.color }]}
              onPress={() => onSelect(t)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{t.name}</Text>
                <Text style={styles.rowSub}>{t.remaining} left · ${(t.price / 100).toFixed(2)}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          ))
        )}

        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 48 },
  handle: { width: 40, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.text, marginBottom: 4, textAlign: 'center' },
  sub: { fontSize: 13, color: COLORS.subtext, textAlign: 'center', marginBottom: 20 },
  empty: { fontSize: 13, color: COLORS.subtext, textAlign: 'center', marginBottom: 20 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card,
    borderRadius: 12, borderLeftWidth: 4, padding: 14, marginBottom: 10,
  },
  rowName: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  rowSub: { fontSize: 12, color: COLORS.subtext },
  chevron: { fontSize: 22, color: COLORS.subtext, marginLeft: 8 },
  cancelBtn: { alignItems: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, marginTop: 4 },
  cancelText: { color: COLORS.subtext, fontWeight: '600', fontSize: 15 },
});
