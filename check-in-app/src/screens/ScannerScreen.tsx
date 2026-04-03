import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Vibration, Animated,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import firestore from '@react-native-firebase/firestore';
import { useSession } from '../context/SessionContext';

type ScanResult = 'valid' | 'already_scanned' | 'invalid' | 'wrong_event' | null;

interface TicketInfo {
  holderName: string;
  ticketType: string;
  quantity: number;
  ticketId: string;
}

export default function ScannerScreen() {
  const { session } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [result, setResult] = useState<ScanResult>(null);
  const [ticketInfo, setTicketInfo] = useState<TicketInfo | null>(null);
  const [checkedIn, setCheckedIn] = useState(0);
  const [total, setTotal] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Live check-in count listener
  useEffect(() => {
    if (!session) return;
    const unsub = firestore()
      .collection('tickets')
      .where('eventId', '==', session.eventId)
      .onSnapshot(snap => {
        setTotal(snap.size);
        setCheckedIn(snap.docs.filter(d => d.data().checkedIn).length);
      });
    return unsub;
  }, [session]);

  function showResult(r: ScanResult, info: TicketInfo | null = null) {
    setResult(r);
    setTicketInfo(info);
    setScanning(false);
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2800),
      Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => {
      setResult(null);
      setTicketInfo(null);
      setScanning(true);
    });
  }

  async function handleBarCodeScanned({ data }: { data: string }) {
    if (!scanning || !session) return;
    setScanning(false);

    try {
      // QR data format: "WUGI:{ticketId}"
      if (!data.startsWith('WUGI:')) {
        Vibration.vibrate([0, 100, 100, 100]);
        showResult('invalid');
        return;
      }

      const ticketId = data.replace('WUGI:', '');
      const ticketRef = firestore().collection('tickets').doc(ticketId);
      const ticketSnap = await ticketRef.get();

      if (!ticketSnap.exists) {
        Vibration.vibrate([0, 100, 100, 100]);
        showResult('invalid');
        return;
      }

      const ticket = ticketSnap.data()!;

      // Wrong event
      if (ticket.eventId !== session.eventId) {
        Vibration.vibrate([0, 100, 100, 100]);
        showResult('wrong_event', {
          holderName: ticket.holderName,
          ticketType: ticket.ticketType,
          quantity: ticket.quantity ?? 1,
          ticketId,
        });
        return;
      }

      // Already checked in
      if (ticket.checkedIn) {
        Vibration.vibrate([0, 200, 100, 200]);
        showResult('already_scanned', {
          holderName: ticket.holderName,
          ticketType: ticket.ticketType,
          quantity: ticket.quantity ?? 1,
          ticketId,
        });
        return;
      }

      // Valid — mark checked in
      await ticketRef.update({
        checkedIn: true,
        checkedInAt: firestore.FieldValue.serverTimestamp(),
        checkedInBy: session.pin,
      });

      Vibration.vibrate(150);
      showResult('valid', {
        holderName: ticket.holderName,
        ticketType: ticket.ticketType,
        quantity: ticket.quantity ?? 1,
        ticketId,
      });

    } catch (e) {
      showResult('invalid');
    }
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
    valid: { bg: '#0d3d2a', border: '#2a7a5a', icon: '✓', label: 'Valid Ticket', color: '#2a7a5a' },
    already_scanned: { bg: '#3d2a00', border: '#e6a817', icon: '!', label: 'Already Scanned', color: '#e6a817' },
    invalid: { bg: '#3d0d0d', border: '#cc3333', icon: '✕', label: 'Invalid Ticket', color: '#cc3333' },
    wrong_event: { bg: '#3d0d0d', border: '#cc3333', icon: '✕', label: 'Wrong Event', color: '#cc3333' },
  };

  const cfg = result ? resultConfig[result] : null;

  return (
    <View style={styles.container}>
      {/* Header bar */}
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
        style={styles.camera}
        facing="back"
        onBarcodeScanned={scanning ? handleBarCodeScanned : undefined}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      >
        {/* Viewfinder corners */}
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
            </>
          )}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12,
    backgroundColor: '#111',
  },
  eventName: { fontSize: 16, fontWeight: '700', color: '#fff' },
  venueName: { fontSize: 12, color: '#888', marginTop: 2 },
  countBadge: { alignItems: 'center' },
  countNum: { fontSize: 24, fontWeight: '800', color: '#2a7a5a' },
  countLabel: { fontSize: 11, color: '#888' },
  camera: { flex: 1 },
  viewfinder: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
  },
  corner: {
    position: 'absolute', width: 28, height: 28,
    borderColor: '#2a7a5a', borderWidth: 3,
  },
  tl: { top: '30%', left: '20%', borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  tr: { top: '30%', right: '20%', borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  bl: { bottom: '30%', left: '20%', borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  br: { bottom: '30%', right: '20%', borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  hint: { color: '#2a7a5a', fontSize: 13, fontWeight: '500', marginTop: 80 },
  resultOverlay: {
    position: 'absolute', bottom: 40, left: 20, right: 20,
    borderRadius: 20, borderWidth: 1.5,
    padding: 24, alignItems: 'center',
  },
  resultIcon: { fontSize: 40, fontWeight: '800', marginBottom: 6 },
  resultLabel: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  resultName: { fontSize: 18, color: '#fff', fontWeight: '600', marginBottom: 2 },
  resultDetail: { fontSize: 14, color: '#aaa', marginBottom: 4 },
  resultId: { fontSize: 11, color: '#555' },
  permText: { color: '#aaa', textAlign: 'center', marginBottom: 20, fontSize: 15, paddingHorizontal: 32 },
  permBtn: { backgroundColor: '#2a7a5a', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  permBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
