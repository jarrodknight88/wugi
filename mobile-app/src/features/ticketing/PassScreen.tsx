// ─────────────────────────────────────────────────────────────────────
// Wugi — PassScreen
// Digital QR code pass shown after successful payment
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  SafeAreaView, ActivityIndicator, Share, Alert,
} from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import type { Theme } from '../../constants/colors';
import { BackIcon } from '../../components/icons';

type Pass = {
  id: string;
  ticketNumber: string;
  eventName: string;
  venueName: string;
  eventDate: string;
  eventTime: string;
  ticketTypeName: string;
  holderName: string;
  scanStatus: 'valid' | 'scanned' | 'invalid';
};

type Props = {
  orderId: string;
  theme: Theme;
  onClose: () => void;
  onAddToWallet?: () => void;
};

// ── Simple QR-like pattern (placeholder until PassKit is integrated) ──
function QRPlaceholder({ value, size = 160, accent }: { value: string; size?: number; accent: string }) {
  const cells = 8;
  const cellSize = size / cells;

  // Generate deterministic pattern from value string
  const pattern = Array.from({ length: cells * cells }, (_, i) => {
    const char = value.charCodeAt(i % value.length);
    return (char + i * 7) % 3 !== 0;
  });

  // Always set corners
  const cornerCells = new Set([0, 1, 2, cells, cells*2, cells*3-1, cells*3-2, cells*3-3, cells*4-1, cells*4-2, cells*4-3]);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {pattern.map((filled, i) => {
        const row = Math.floor(i / cells);
        const col = i % cells;
        const isCorner = cornerCells.has(i);
        return (filled || isCorner) ? (
          <Rect
            key={i}
            x={col * cellSize + 1}
            y={row * cellSize + 1}
            width={cellSize - 2}
            height={cellSize - 2}
            fill={accent}
            rx={1}
          />
        ) : null;
      })}
    </Svg>
  );
}

export function PassScreen({ orderId, theme, onClose, onAddToWallet }: Props) {
  const [passes,  setPasses]  = useState<Pass[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePass, setActivePass] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const { getFirestore, collection, getDocs, query, where } =
          await import('@react-native-firebase/firestore');
        const db   = getFirestore();
        const snap = await getDocs(
          query(collection(db, 'passes'), where('orderId', '==', orderId))
        );
        const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() } as Pass));
        setPasses(loaded);
      } catch (e) {
        console.log('PassScreen: load error', e);
        // Show dev placeholder if load fails
        setPasses([{
          id: orderId,
          ticketNumber: 'WG-' + orderId.slice(-8).toUpperCase(),
          eventName: 'Event',
          venueName: 'Venue',
          eventDate: 'TBD',
          eventTime: 'TBD',
          ticketTypeName: 'General Admission',
          holderName: 'Guest',
          scanStatus: 'valid',
        }]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [orderId]);

  const handleShare = async () => {
    const pass = passes[activePass];
    if (!pass) return;
    try {
      await Share.share({
        message: `My ticket to ${pass.eventName} at ${pass.venueName}\n${pass.eventDate} · ${pass.eventTime}\nTicket: ${pass.ticketNumber}`,
      });
    } catch (e) {}
  };

  const handleAddToWallet = () => {
    Alert.alert(
      'Apple Wallet',
      'Apple Wallet integration via PassKit will be available before launch.',
      [{ text: 'OK' }]
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} size="large"/>
        <Text style={{ color: theme.subtext, fontSize: 13, marginTop: 12 }}>Loading your pass...</Text>
      </View>
    );
  }

  const pass = passes[activePass];
  if (!pass) return null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header */}
      <SafeAreaView style={{ borderBottomWidth: 1, borderBottomColor: theme.divider, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8 }}>
          <View style={{ flex: 1 }}/>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>Your Pass</Text>
          <TouchableOpacity onPress={onClose} style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '600' }}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>

        {/* Success indicator */}
        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
              <Path d="M5 12l5 5L20 7" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </View>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>Payment confirmed!</Text>
          <Text style={{ color: theme.subtext, fontSize: 13, marginTop: 4 }}>
            {passes.length > 1 ? `${passes.length} passes ready` : 'Your pass is ready'}
          </Text>
        </View>

        {/* Pass card */}
        <View style={{ borderRadius: 20, overflow: 'hidden', borderWidth: 1.5, borderColor: theme.accent, marginBottom: 16 }}>
          {/* Pass header */}
          <View style={{ backgroundColor: theme.accent, padding: 16, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: -1 }}>wugi</Text>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 4 }}>{pass.eventName}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 }}>{pass.venueName} · {pass.eventDate} · {pass.eventTime}</Text>
          </View>

          {/* QR code */}
          <View style={{ backgroundColor: theme.card, alignItems: 'center', paddingVertical: 20 }}>
            <View style={{ backgroundColor: theme.bg === '#0a0a0a' ? '#fff' : theme.bg, padding: 12, borderRadius: 12 }}>
              <QRPlaceholder value={pass.id} size={160} accent={theme.accent}/>
            </View>
            <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 10 }}>Show at door · {pass.ticketNumber}</Text>
          </View>

          {/* Pass details */}
          <View style={{ backgroundColor: theme.card, borderTopWidth: 1, borderTopColor: theme.divider }}>
            {[
              { label: 'Name',        value: pass.holderName },
              { label: 'Ticket type', value: pass.ticketTypeName },
              { label: 'Status',      value: pass.scanStatus === 'valid' ? '✓ Valid' : pass.scanStatus === 'scanned' ? 'Scanned' : 'Invalid', accent: pass.scanStatus === 'valid' },
            ].map((row, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: theme.divider }}>
                <Text style={{ color: theme.subtext, fontSize: 13 }}>{row.label}</Text>
                <Text style={{ color: row.accent ? theme.accent : theme.text, fontSize: 13, fontWeight: '600' }}>{row.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Multiple passes pagination */}
        {passes.length > 1 && (
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
            {passes.map((_, i) => (
              <TouchableOpacity key={i} onPress={() => setActivePass(i)}>
                <View style={{ width: i === activePass ? 20 : 8, height: 8, borderRadius: 4, backgroundColor: i === activePass ? theme.accent : theme.border }}/>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {passes.length > 1 && (
          <Text style={{ color: theme.subtext, fontSize: 12, textAlign: 'center', marginBottom: 16 }}>
            Pass {activePass + 1} of {passes.length} · Tap dots to switch
          </Text>
        )}

        {/* Actions */}
        <TouchableOpacity
          onPress={handleAddToWallet}
          style={{ backgroundColor: '#000', borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 10 }}
        >
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Rect x="2" y="5" width="20" height="14" rx="2" stroke="white" strokeWidth={1.8}/>
            <Path d="M2 10h20" stroke="white" strokeWidth={1.8}/>
          </Svg>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Add to Apple Wallet</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleShare}
          style={{ borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1.5, borderColor: theme.border, flexDirection: 'row', justifyContent: 'center', gap: 8 }}
        >
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" stroke={theme.text} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
          </Svg>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>Share pass</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}
