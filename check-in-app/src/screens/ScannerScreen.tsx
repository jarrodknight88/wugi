import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Vibration, Animated, Modal,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import firestore from '@react-native-firebase/firestore';
import { useSession } from '../context/SessionContext';

// Tap to Pay is pending Apple entitlement approval — disabled until approved
const TAP_TO_PAY_ENABLED = false;
type PaymentMode = any;

type ScanResult = 'valid' | 'already_scanned' | 'invalid' | 'wrong_event' | null;

interface TicketInfo {
  holderName: string;
  ticketType: string;
  ticketTypeName: string;
  ticketTypeId: string;
  ticketColor: string;
  quantity: number;
  ticketId: string;
  balanceDue: number;
  holderEmail: string;
}

export default function ScannerScreen() {
  const { session } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning]       = useState(true);
  const [result, setResult]           = useState<ScanResult>(null);
  const [ticketInfo, setTicketInfo]   = useState<TicketInfo | null>(null);
  const [checkedIn, setCheckedIn]     = useState(0);
  const [total, setTotal]             = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!session) return;
    const unsub = firestore()
      .collection('events').doc(session.eventId)
      .collection('tickets')
      .onSnapshot(snap => {
        setTotal(snap.size);
        setCheckedIn(snap.docs.filter(d => d.data().checkedIn).length);
      });
    return unsub;
  }, [session]);

  function showResult(r: ScanResult, info: TicketInfo | null = null) {
    setResult(r); setTicketInfo(info); setScanning(false);
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(r === 'valid' && (info?.balanceDue ?? 0) > 0 ? 8000 : 2800),
      Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => { setResult(null); setTicketInfo(null); setScanning(true); });
  }

  function dismissResult() {
    fadeAnim.stopAnimation();
    fadeAnim.setValue(0);
    setResult(null); setTicketInfo(null); setScanning(true);
  }

  async function handleBarCodeScanned({ data }: { data: string }) {
    if (!scanning || !session) return;
    setScanning(false);
    try {
      if (!data.startsWith('WUGI:')) {
        Vibration.vibrate([0, 100, 100, 100]); showResult('invalid'); return;
      }
      const ticketId = data.replace('WUGI:', '');
      // Try per-event subcollection first, fall back to root
      let ticketSnap = await firestore()
        .collection('events').doc(session.eventId)
        .collection('tickets').doc(ticketId).get();
      if (!ticketSnap.exists) {
        ticketSnap = await firestore().collection('tickets').doc(ticketId).get();
      }
      if (!ticketSnap.exists) {
        Vibration.vibrate([0, 100, 100, 100]); showResult('invalid'); return;
      }
      const ticket = ticketSnap.data()!;
      if (ticket.eventId && ticket.eventId !== session.eventId) {
        Vibration.vibrate([0, 100, 100, 100]);
        showResult('wrong_event', { holderName: ticket.holderName, ticketType: ticket.ticketTypeName || ticket.ticketType || '', ticketTypeName: ticket.ticketTypeName || '', ticketTypeId: ticket.ticketTypeId || '', ticketColor: ticket.color || '#2a7a5a', quantity: ticket.quantity ?? 1, ticketId, balanceDue: ticket.balanceDue ?? 0, holderEmail: ticket.holderEmail || '' });
        return;
      }
      if (ticket.checkedIn) {
        Vibration.vibrate([0, 200, 100, 200]);
        showResult('already_scanned', { holderName: ticket.holderName, ticketType: ticket.ticketTypeName || ticket.ticketType || '', ticketTypeName: ticket.ticketTypeName || '', ticketTypeId: ticket.ticketTypeId || '', ticketColor: ticket.color || '#2a7a5a', quantity: ticket.quantity ?? 1, ticketId, balanceDue: ticket.balanceDue ?? 0, holderEmail: ticket.holderEmail || '' });
        return;
      }
      // Valid — check in
      await ticketSnap.ref.update({ checkedIn: true, checkedInAt: firestore.FieldValue.serverTimestamp(), checkedInBy: session.pin });
      Vibration.vibrate(150);
      showResult('valid', { holderName: ticket.holderName, ticketType: ticket.ticketTypeName || ticket.ticketType || '', ticketTypeName: ticket.ticketTypeName || '', ticketTypeId: ticket.ticketTypeId || '', ticketColor: ticket.color || '#2a7a5a', quantity: ticket.quantity ?? 1, ticketId, balanceDue: ticket.balanceDue ?? 0, holderEmail: ticket.holderEmail || '' });
    } catch (e) { showResult('invalid'); }
  }

  if (!permission) return <View style={styles.container} />;
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.permText}>Camera access is required to scan tickets.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const resultConfig = {
    valid:           { bg: '#0d3d2a', border: '#2a7a5a', icon: '✓', label: 'Valid Ticket',    color: '#2a7a5a' },
    already_scanned: { bg: '#3d2a00', border: '#e6a817', icon: '!', label: 'Already Scanned', color: '#e6a817' },
    invalid:         { bg: '#3d0d0d', border: '#cc3333', icon: '✕', label: 'Invalid Ticket',  color: '#cc3333' },
    wrong_event:     { bg: '#3d0d0d', border: '#cc3333', icon: '✕', label: 'Wrong Event',     color: '#cc3333' },
  };
  const cfg = result ? resultConfig[result] : null;
  const hasBalance = (ticketInfo?.balanceDue ?? 0) > 0;

  return (
    <View style={styles.container}>
      {/* Payment modal — active once Tap to Pay entitlement approved */}
      <Modal visible={TAP_TO_PAY_ENABLED && !!paymentMode} animationType="slide" presentationStyle="pageSheet">
        {TAP_TO_PAY_ENABLED && paymentMode && (() => {
          const PaymentScreen = require('./PaymentScreen').default;
          return (
            <PaymentScreen
              mode={paymentMode}
              onSuccess={() => { setPaymentMode(null); dismissResult(); }}
              onCancel={() => setPaymentMode(null)}
            />
          );
        })()}
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.eventName}>{session?.eventName}</Text>
          <Text style={styles.venueName}>{session?.venueName} · {session?.date}</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countNum}>{checkedIn}</Text>
          <Text style={styles.countLabel}>/ {total} in</Text>
        </View>
      </View>

      {/* Camera */}
      <CameraView
        style={styles.camera} facing="back"
        onBarcodeScanned={scanning ? handleBarCodeScanned : undefined}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      >
        <View style={styles.viewfinder}>
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
          <Text style={styles.hint}>Point at QR code</Text>
        </View>
      </CameraView>

      {/* Result overlay */}
      {result && cfg && (
        <Animated.View style={[styles.resultOverlay, { opacity: fadeAnim, backgroundColor: cfg.bg, borderColor: cfg.border }]}>
          <Text style={[styles.resultIcon, { color: cfg.color }]}>{cfg.icon}</Text>
          <Text style={[styles.resultLabel, { color: cfg.color }]}>{cfg.label}</Text>
          {ticketInfo && (
            <>
              <Text style={styles.resultName}>{ticketInfo.holderName}</Text>
              <Text style={styles.resultDetail}>
                {ticketInfo.ticketType} · {ticketInfo.quantity > 1 ? `×${ticketInfo.quantity}` : '1 ticket'}
              </Text>
              <Text style={styles.resultId}>#{ticketInfo.ticketId.slice(-8).toUpperCase()}</Text>

              {/* ⚠️ Balance due — seamless auto-payment prompt */}
              {hasBalance && (
                <View style={styles.balanceWarning}>
                  <Text style={styles.balanceWarningText}>
                    ⚠️  ${(ticketInfo.balanceDue / 100).toFixed(2)} due at door
                  </Text>
                  {TAP_TO_PAY_ENABLED ? (
                    <TouchableOpacity
                      style={styles.collectBtn}
                      onPress={() => {
                        // Dismiss scan overlay immediately, launch payment
                        dismissResult();
                        setPaymentMode({
                          type: 'balance',
                          ticketId: ticketInfo.ticketId,
                          holderName: ticketInfo.holderName,
                          holderEmail: ticketInfo.holderEmail,
                          balanceDue: ticketInfo.balanceDue,
                        });
                      }}>
                      <Text style={styles.collectBtnText}>💳  Collect ${(ticketInfo.balanceDue / 100).toFixed(2)}</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.balanceHint}>Collect payment at the door before entry</Text>
                  )}
                </View>
              )}
            </>
          )}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12, backgroundColor: '#111' },
  eventName: { fontSize: 16, fontWeight: '700', color: '#fff' },
  venueName: { fontSize: 12, color: '#888', marginTop: 2 },
  countBadge: { alignItems: 'center' },
  countNum: { fontSize: 24, fontWeight: '800', color: '#2a7a5a' },
  countLabel: { fontSize: 11, color: '#888' },
  camera: { flex: 1 },
  viewfinder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: '#2a7a5a', borderWidth: 3 },
  tl: { top: '30%', left: '20%', borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  tr: { top: '30%', right: '20%', borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  bl: { bottom: '30%', left: '20%', borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  br: { bottom: '30%', right: '20%', borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  hint: { color: '#2a7a5a', fontSize: 13, fontWeight: '500', marginTop: 80 },
  resultOverlay: { position: 'absolute', bottom: 32, left: 16, right: 16, borderRadius: 20, borderWidth: 1.5, padding: 22, alignItems: 'center' },
  resultIcon: { fontSize: 40, fontWeight: '800', marginBottom: 6 },
  resultLabel: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  resultName: { fontSize: 18, color: '#fff', fontWeight: '600', marginBottom: 2 },
  resultDetail: { fontSize: 14, color: '#aaa', marginBottom: 4 },
  resultId: { fontSize: 11, color: '#555', marginBottom: 8 },
  balanceWarning: { width: '100%', backgroundColor: '#2a1a00', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e6a817', marginTop: 8 },
  balanceWarningText: { fontSize: 16, fontWeight: '800', color: '#e6a817', marginBottom: 12 },
  collectBtn: { backgroundColor: '#e6a817', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28, width: '100%', alignItems: 'center' },
  collectBtnText: { fontSize: 16, fontWeight: '800', color: '#000' },
  balanceHint: { fontSize: 12, color: '#a16207', textAlign: 'center', marginTop: 2 },
  permText: { color: '#aaa', textAlign: 'center', marginBottom: 20, fontSize: 15, paddingHorizontal: 32 },
  permBtn: { backgroundColor: '#2a7a5a', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  permBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
