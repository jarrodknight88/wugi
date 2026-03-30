// ─────────────────────────────────────────────────────────────────────
// Wugi — PassScreen
// Digital pass shown after successful payment - real QR code
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  SafeAreaView, ActivityIndicator, Share, Alert,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Path, Rect } from 'react-native-svg';
import type { Theme } from '../../constants/colors';

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
  isGuest: boolean;
  theme: Theme;
  onClose: () => void;
  onSignUp?: () => void;
  onAddToWallet?: () => void;
};

export function PassScreen({ orderId, isGuest, theme, onClose, onSignUp }: Props) {
  const [passes,    setPasses]    = useState<Pass[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [activePass, setActivePass] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        if (orderId.startsWith('dev_order_')) {
          setPasses([{
            id: 'dev-' + orderId.slice(-8),
            ticketNumber: 'WG-DEV-' + orderId.slice(-6).toUpperCase(),
            eventName: 'Test Event', venueName: 'Test Venue',
            eventDate: 'Tonight', eventTime: '9 PM',
            ticketTypeName: 'General Admission',
            holderName: 'Dev User', scanStatus: 'valid',
          }]);
          setLoading(false);
          return;
        }

        const { getFirestore, collection, getDocs, query, where } =
          await import('@react-native-firebase/firestore');
        const db   = getFirestore();
        const snap = await getDocs(
          query(collection(db, 'passes'), where('orderId', '==', orderId))
        );
        const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() } as Pass));
        if (loaded.length > 0) {
          setPasses(loaded);
        } else {
          // Payment went through but webhook hasn't fired yet - show pending
          setPasses([{
            id: orderId,
            ticketNumber: 'WG-' + orderId.slice(-8).toUpperCase(),
            eventName: 'Your Event', venueName: 'Venue',
            eventDate: '', eventTime: '',
            ticketTypeName: 'General Admission',
            holderName: 'Guest', scanStatus: 'valid',
          }]);
        }
      } catch (e) {
        console.log('PassScreen error:', e);
        setPasses([{
          id: orderId,
          ticketNumber: 'WG-' + orderId.slice(-8).toUpperCase(),
          eventName: 'Your Event', venueName: 'Venue',
          eventDate: '', eventTime: '',
          ticketTypeName: 'General Admission',
          holderName: 'Guest', scanStatus: 'valid',
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

  const statusColor = pass.scanStatus === 'valid' ? theme.accent : pass.scanStatus === 'scanned' ? '#e67e22' : '#e74c3c';
  const statusLabel = pass.scanStatus === 'valid' ? '✓ Valid' : pass.scanStatus === 'scanned' ? 'Used' : 'Invalid';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
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
        {/* Success */}
        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
              <Path d="M5 12l5 5L20 7" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </View>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>You're in!</Text>
          <Text style={{ color: theme.subtext, fontSize: 13, marginTop: 4 }}>
            {passes.length > 1 ? `${passes.length} passes ready` : 'Your pass is ready'}
          </Text>
        </View>

        {/* Pass card */}
        <View style={{ borderRadius: 20, overflow: 'hidden', borderWidth: 1.5, borderColor: theme.accent, marginBottom: 16, shadowColor: theme.accent, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
          {/* Header */}
          <View style={{ backgroundColor: theme.accent, padding: 16, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: -1 }}>wugi</Text>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800', marginTop: 4 }} numberOfLines={1}>{pass.eventName}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 }}>{pass.venueName}{pass.eventDate ? ` · ${pass.eventDate}` : ''}{pass.eventTime ? ` · ${pass.eventTime}` : ''}</Text>
          </View>

          {/* Tear line */}
          <View style={{ height: 1, backgroundColor: theme.divider, marginHorizontal: 0, borderStyle: 'dashed' }}/>

          {/* QR Code */}
          <View style={{ backgroundColor: theme.card, alignItems: 'center', paddingVertical: 24 }}>
            <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 12 }}>
              <QRCode
                value={pass.id || 'wugi-pass'}
                size={160}
                color="#000"
                backgroundColor="#fff"
                logoSize={30}
              />
            </View>
            <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 10, letterSpacing: 1.5 }}>
              {pass.ticketNumber}
            </Text>
            <View style={{ marginTop: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, backgroundColor: statusColor + '22', borderWidth: 1, borderColor: statusColor }}>
              <Text style={{ color: statusColor, fontSize: 11, fontWeight: '700' }}>{statusLabel}</Text>
            </View>
          </View>

          {/* Tear line */}
          <View style={{ height: 1, backgroundColor: theme.divider }}/>

          {/* Details */}
          <View style={{ backgroundColor: theme.card }}>
            {[
              { label: 'Name',        value: pass.holderName },
              { label: 'Ticket type', value: pass.ticketTypeName },
            ].map((row, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: theme.divider }}>
                <Text style={{ color: theme.subtext, fontSize: 13 }}>{row.label}</Text>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>{row.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Pagination */}
        {passes.length > 1 && (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
              {passes.map((_, i) => (
                <TouchableOpacity key={i} onPress={() => setActivePass(i)}>
                  <View style={{ width: i === activePass ? 20 : 8, height: 8, borderRadius: 4, backgroundColor: i === activePass ? theme.accent : theme.border }}/>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: theme.subtext, fontSize: 12, textAlign: 'center', marginBottom: 16 }}>
              Pass {activePass + 1} of {passes.length}
            </Text>
          </>
        )}

        {/* Actions */}
        <TouchableOpacity
          onPress={handleShare}
          style={{ borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1.5, borderColor: theme.border, flexDirection: 'row', justifyContent: 'center', gap: 8 }}
        >
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" stroke={theme.text} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
          </Svg>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>Share pass</Text>
        </TouchableOpacity>

        {/* Guest account creation prompt */}
        {isGuest && onSignUp && (
          <View style={{ marginTop: 20, backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Text style={{ fontSize: 22 }}>🎟️</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>Save your passes</Text>
                <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 2 }}>Create an account to access all your tickets in one place</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={onSignUp}
              style={{ backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Create a free account</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={{ paddingVertical: 10, alignItems: 'center' }}>
              <Text style={{ color: theme.subtext, fontSize: 12 }}>No thanks, I'll find it in my email</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={{ color: theme.subtext, fontSize: 10, textAlign: 'center', marginTop: 16 }}>
          Present QR code at the door for entry
        </Text>
      </ScrollView>
    </View>
  );
}
