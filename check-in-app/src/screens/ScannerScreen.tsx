import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Vibration, Animated, Modal,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import firestore from '@react-native-firebase/firestore';
import { useSession } from '../context/SessionContext';

// Tap to Pay is pending Apple entitlement approval — disabled until approved
const TAP_TO_PAY_ENABLED = true;
type PaymentMode = any;

type ScanResult = 'valid' | 'already_scanned' | 'invalid' | 'wrong_event' | 'balance_blocked' | null;

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
  const { session, clearSession, setSession } = useSession();
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
    if (session.isSuperAdmin) return;
    // Count passes for this event (new data model)
    const unsub = firestore()
      .collection('passes')
      .where('eventId', '==', session.eventId)
      .where('source', '!=', 'door')
      .onSnapshot(snap => {
        setTotal(snap.size);
        setCheckedIn(snap.docs.filter(d => d.data().scanStatus === 'scanned').length);
      }, () => {});
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
      // QR encodes plain passId (no prefix) — look up in passes collection
      const passId = data.replace('WUGI:', '').trim();

      // Look up pass by doc ID
      let passSnap = await firestore().collection('passes').doc(passId).get();

      if (!passSnap.exists) {
        Vibration.vibrate([0, 100, 100, 100]); showResult('invalid'); return;
      }

      const pass = passSnap.data()!;

      // Enforce event match for non-super-admin
      if (!session.isSuperAdmin && pass.eventId && pass.eventId !== session.eventId) {
        Vibration.vibrate([0, 100, 100, 100]);
        showResult('wrong_event', {
          holderName: pass.holderName, ticketType: pass.ticketTypeName || '',
          ticketTypeName: pass.ticketTypeName || '', ticketTypeId: pass.ticketTypeId || '',
          ticketColor: pass.passColor || '#2a7a5a', quantity: 1,
          ticketId: passId, balanceDue: pass.balanceDue ?? 0, holderEmail: pass.holderEmail || '',
        });
        return;
      }

      if (pass.scanStatus === 'scanned') {
        Vibration.vibrate([0, 200, 100, 200]);
        showResult('already_scanned', {
          holderName: pass.holderName, ticketType: pass.ticketTypeName || '',
          ticketTypeName: pass.ticketTypeName || '', ticketTypeId: pass.ticketTypeId || '',
          ticketColor: pass.passColor || '#2a7a5a', quantity: 1,
          ticketId: passId, balanceDue: pass.balanceDue ?? 0, holderEmail: pass.holderEmail || '',
        });
        return;
      }

      // Valid — check if this is a guest pass with an outstanding order balance
      const isGuestPass = pass.role === 'guest';
      if (isGuestPass) {
        // Look up the order to check balanceDue at the order level
        let orderBalanceDue = 0;
        if (pass.orderId) {
          try {
            const orderSnap = await firestore().collection('orders').doc(pass.orderId).get();
            if (orderSnap.exists) orderBalanceDue = orderSnap.data()?.balanceDue ?? 0;
          } catch { /* non-blocking */ }
        }
        if (orderBalanceDue > 0) {
          // Block scan — host hasn't paid balance yet
          Vibration.vibrate([0, 100, 100, 100]);
          showResult('balance_blocked', {
            holderName: pass.holderName || 'Guest',
            ticketType: pass.ticketTypeName || '',
            ticketTypeName: pass.ticketTypeName || '',
            ticketTypeId: pass.ticketTypeId || '',
            ticketColor: '#e6a817',
            quantity: 1,
            ticketId: passId,
            balanceDue: orderBalanceDue,
            holderEmail: pass.holderEmail || '',
          });
          return;
        }
      }

      // Valid — mark scanned
      await passSnap.ref.update({
        scanStatus:  'scanned',
        scannedAt:   firestore.FieldValue.serverTimestamp(),
        scannedBy:   session.pin,
      });
      Vibration.vibrate(150);
      showResult('valid', {
        holderName: pass.holderName, ticketType: pass.ticketTypeName || '',
        ticketTypeName: pass.ticketTypeName || '', ticketTypeId: pass.ticketTypeId || '',
        ticketColor: pass.passColor || '#2a7a5a', quantity: 1,
        ticketId: passId, balanceDue: pass.balanceDue ?? 0, holderEmail: pass.holderEmail || '',
      });
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
    valid:            { bg: '#0d3d2a', border: '#2a7a5a', icon: '✓', label: 'Valid Ticket',       color: '#2a7a5a' },
    already_scanned:  { bg: '#3d2a00', border: '#e6a817', icon: '!', label: 'Already Scanned',    color: '#e6a817' },
    invalid:          { bg: '#3d0d0d', border: '#cc3333', icon: '✕', label: 'Invalid Ticket',     color: '#cc3333' },
    wrong_event:      { bg: '#3d0d0d', border: '#cc3333', icon: '✕', label: 'Wrong Event',        color: '#cc3333' },
    balance_blocked:  { bg: '#3d1a00', border: '#e6a817', icon: '⚠', label: 'Balance Outstanding', color: '#e6a817' },
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
        <TouchableOpacity onPress={() => {
          // Super admin → back to event selector; regular staff → end session
          if (session?.isSuperAdmin) {
            setSession({ ...session, eventId: '__super_admin__', eventName: 'All Events', venueName: 'Super Admin', venueId: '__super_admin__' });
          } else {
            clearSession();
          }
        }} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
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

              {/* ⚠️ Balance due — guest pass blocked or collect at door */}
              {hasBalance && (
                <View style={styles.balanceWarning}>
                  <Text style={styles.balanceWarningText}>
                    {result === 'balance_blocked'
                      ? `⛔  Host balance $${(ticketInfo.balanceDue / 100).toFixed(2)} outstanding — do not admit`
                      : `⚠️  $${(ticketInfo.balanceDue / 100).toFixed(2)} due at door`
                    }
                  </Text>
                  {result === 'balance_blocked' ? (
                    <Text style={styles.balanceHint}>Guest cannot enter until host pays the balance. Direct host to wugi.us/pay/{ticketInfo.ticketId}</Text>
                  ) : TAP_TO_PAY_ENABLED ? (
                    <TouchableOpacity
                      style={styles.collectBtn}
                      onPress={() => {
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
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 56, paddingBottom: 12, backgroundColor: '#111' },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  backBtnText: { color: '#fff', fontSize: 20, lineHeight: 22 },
  headerCenter: { flex: 1 },
  eventName: { fontSize: 15, fontWeight: '700', color: '#fff' },
  venueName: { fontSize: 12, color: '#888', marginTop: 2 },
  countBadge: { alignItems: 'center', marginLeft: 8 },
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
