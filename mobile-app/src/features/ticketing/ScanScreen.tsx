// ─────────────────────────────────────────────────────────────────────
// Wugi — ScanScreen
// QR code scanner for venue staff / promoters
// Role-gated: venue_owner or promoter only
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, SafeAreaView,
  Alert, ActivityIndicator, Vibration,
} from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import type { Theme } from '../../constants/colors';
import { BackIcon } from '../../components/icons';

type ScannedPass = {
  id: string;
  ticketNumber: string;
  holderName: string;
  ticketTypeName: string;
  eventName: string;
  scanStatus: 'valid' | 'scanned' | 'invalid';
  orderId: string;
};

type ScanResult = 'idle' | 'scanning' | 'valid' | 'already_scanned' | 'invalid' | 'error';

type Props = {
  eventId: string;
  eventName: string;
  venueName: string;
  eventDate: string;
  eventTime: string;
  userId: string;
  theme: Theme;
  onBack: () => void;
};

export function ScanScreen({
  eventId, eventName, venueName, eventDate, eventTime,
  userId, theme, onBack,
}: Props) {
  const [scanResult,    setScanResult]    = useState<ScanResult>('idle');
  const [scannedPass,   setScannedPass]   = useState<ScannedPass | null>(null);
  const [checkedIn,     setCheckedIn]     = useState(0);
  const [totalSold,     setTotalSold]     = useState(0);
  const [processing,    setProcessing]    = useState(false);
  const [cameraReady,   setCameraReady]   = useState(false);

  // ── Load check-in stats ─────────────────────────────────────────────
  useEffect(() => {
    const loadStats = async () => {
      try {
        const { getFirestore, collection, getDocs, query, where } =
          await import('@react-native-firebase/firestore');
        const db = getFirestore();

        const [scannedSnap, totalSnap] = await Promise.all([
          getDocs(query(
            collection(db, 'passes'),
            where('eventId', '==', eventId),
            where('scanStatus', '==', 'scanned'),
          )),
          getDocs(query(
            collection(db, 'passes'),
            where('eventId', '==', eventId),
          )),
        ]);

        setCheckedIn(scannedSnap.size);
        setTotalSold(totalSnap.size);
      } catch (e) {
        console.log('ScanScreen: stats error', e);
      }
    };
    loadStats();
  }, [eventId]);

  // ── Handle QR scan ──────────────────────────────────────────────────
  const handleScan = async (passId: string) => {
    if (processing) return;
    setProcessing(true);
    setScanResult('scanning');

    try {
      const { getFirestore, doc, getDoc, updateDoc, serverTimestamp } =
        await import('@react-native-firebase/firestore');
      const db      = getFirestore();
      const passRef = doc(db, 'passes', passId);
      const passDoc = await getDoc(passRef);

      if (!passDoc.exists()) {
        setScanResult('invalid');
        setScannedPass(null);
        Vibration.vibrate([0, 100, 50, 100]);
        return;
      }

      const pass = { id: passDoc.id, ...passDoc.data() } as ScannedPass;

      // Wrong event
      if ((passDoc.data() as any).eventId !== eventId) {
        setScanResult('invalid');
        setScannedPass(pass);
        Vibration.vibrate([0, 100, 50, 100]);
        return;
      }

      // Already scanned
      if (pass.scanStatus === 'scanned') {
        setScanResult('already_scanned');
        setScannedPass(pass);
        Vibration.vibrate([0, 200]);
        return;
      }

      // Valid — mark as scanned
      setScannedPass(pass);
      setScanResult('valid');

    } catch (e) {
      setScanResult('error');
      Vibration.vibrate([0, 100, 50, 100]);
    } finally {
      setProcessing(false);
    }
  };

  // ── Confirm entry ───────────────────────────────────────────────────
  const confirmEntry = async () => {
    if (!scannedPass) return;
    setProcessing(true);

    try {
      const { getFirestore, doc, updateDoc, serverTimestamp } =
        await import('@react-native-firebase/firestore');
      const db = getFirestore();

      await updateDoc(doc(db, 'passes', scannedPass.id), {
        scanStatus:      'scanned',
        scannedAt:       serverTimestamp(),
        scannedBy:       userId,
        scannedByDevice: 'wugi_app',
        updatedAt:       serverTimestamp(),
      });

      setCheckedIn(c => c + 1);
      Vibration.vibrate(200);

      // Auto-reset after 2 seconds
      setTimeout(() => {
        setScanResult('idle');
        setScannedPass(null);
      }, 2000);

    } catch (e) {
      Alert.alert('Error', 'Failed to confirm entry. Please try again.');
      setScanResult('idle');
    } finally {
      setProcessing(false);
    }
  };

  const resetScan = () => {
    setScanResult('idle');
    setScannedPass(null);
  };

  // ── Simulate scan (dev mode) ─────────────────────────────────────────
  const simulateScan = () => {
    Alert.prompt(
      'Simulate Scan (Dev)',
      'Enter a pass ID to simulate scanning:',
      (passId) => { if (passId) handleScan(passId); },
      'plain-text',
      '',
    );
  };

  const remaining = totalSold - checkedIn;

  const resultColor = {
    idle:            theme.border,
    scanning:        theme.accent,
    valid:           theme.accent,
    already_scanned: '#e67e22',
    invalid:         '#e74c3c',
    error:           '#e74c3c',
  }[scanResult];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header */}
      <SafeAreaView style={{ borderBottomWidth: 1, borderBottomColor: theme.divider, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 }}>
          <TouchableOpacity onPress={onBack} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' }}>
            <BackIcon color={theme.text}/>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>Scan Mode</Text>
              <View style={{ backgroundColor: theme.accent + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ color: theme.accent, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>VENUE ONLY</Text>
              </View>
            </View>
          </View>
        </View>
      </SafeAreaView>

      <View style={{ flex: 1, padding: 16 }}>

        {/* Event info */}
        <View style={{ backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.accent, padding: 12, marginBottom: 16 }}>
          <Text style={{ color: theme.accent, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 }}>SCANNING FOR</Text>
          <Text style={{ color: theme.text, fontSize: 15, fontWeight: '800' }}>{eventName}</Text>
          <Text style={{ color: theme.subtext, fontSize: 12 }}>{venueName} · {eventDate} · {eventTime}</Text>
        </View>

        {/* Stats */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Checked in', value: checkedIn, color: theme.accent },
            { label: 'Remaining',  value: remaining, color: theme.text },
            { label: 'Total sold', value: totalSold, color: theme.subtext },
          ].map((stat, i) => (
            <View key={i} style={{ flex: 1, backgroundColor: theme.card, borderRadius: 10, borderWidth: 1, borderColor: theme.border, padding: 10, alignItems: 'center' }}>
              <Text style={{ color: stat.color, fontSize: 22, fontWeight: '800' }}>{stat.value}</Text>
              <Text style={{ color: theme.subtext, fontSize: 10, marginTop: 2 }}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Camera viewfinder */}
        <View style={{
          flex: 1,
          backgroundColor: theme.card,
          borderRadius: 16,
          borderWidth: 1.5,
          borderColor: resultColor,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
          overflow: 'hidden',
          minHeight: 220,
        }}>
          {/* Corner brackets */}
          {['tl','tr','bl','br'].map(corner => (
            <View key={corner} style={{
              position: 'absolute',
              width: 24, height: 24,
              ...(corner.includes('t') ? { top: 16 } : { bottom: 16 }),
              ...(corner.includes('l') ? { left: 16 } : { right: 16 }),
              borderTopWidth:    corner.includes('t') ? 2 : 0,
              borderBottomWidth: corner.includes('b') ? 2 : 0,
              borderLeftWidth:   corner.includes('l') ? 2 : 0,
              borderRightWidth:  corner.includes('r') ? 2 : 0,
              borderColor: resultColor,
              borderTopLeftRadius:     corner === 'tl' ? 3 : 0,
              borderTopRightRadius:    corner === 'tr' ? 3 : 0,
              borderBottomLeftRadius:  corner === 'bl' ? 3 : 0,
              borderBottomRightRadius: corner === 'br' ? 3 : 0,
            }}/>
          ))}

          {scanResult === 'idle' && (
            <>
              <Text style={{ color: theme.subtext, fontSize: 13, fontWeight: '500' }}>Point camera at QR code</Text>
              <TouchableOpacity
                onPress={simulateScan}
                style={{ marginTop: 16, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.border }}
              >
                <Text style={{ color: theme.subtext, fontSize: 12 }}>Simulate scan (dev)</Text>
              </TouchableOpacity>
            </>
          )}

          {scanResult === 'scanning' && (
            <ActivityIndicator color={theme.accent} size="large"/>
          )}

          {(scanResult === 'valid' || scanResult === 'already_scanned' || scanResult === 'invalid') && scannedPass && (
            <View style={{ padding: 16, width: '100%' }}>
              {/* Result icon */}
              <View style={{ alignItems: 'center', marginBottom: 12 }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: resultColor, alignItems: 'center', justifyContent: 'center' }}>
                  <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
                    {scanResult === 'valid'
                      ? <Path d="M4 11l5 5 9-9" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"/>
                      : scanResult === 'already_scanned'
                      ? <Path d="M11 7v4m0 4h.01" stroke="#fff" strokeWidth={2.2} strokeLinecap="round"/>
                      : <Path d="M6 6l10 10M16 6L6 16" stroke="#fff" strokeWidth={2.2} strokeLinecap="round"/>
                    }
                  </Svg>
                </View>
                <Text style={{ color: resultColor, fontSize: 14, fontWeight: '800', marginTop: 6 }}>
                  {scanResult === 'valid' ? 'Valid ticket' : scanResult === 'already_scanned' ? 'Already scanned' : 'Invalid ticket'}
                </Text>
                <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 2 }}>{scannedPass.ticketNumber}</Text>
              </View>

              {/* Ticket details */}
              <View style={{ backgroundColor: theme.bg, borderRadius: 10, padding: 10 }}>
                {[
                  { l: 'Name',   v: scannedPass.holderName },
                  { l: 'Type',   v: scannedPass.ticketTypeName },
                  { l: 'Status', v: scanResult === 'valid' ? 'Not yet scanned' : scanResult === 'already_scanned' ? 'Already scanned' : 'Invalid', accent: scanResult === 'valid' },
                ].map((row, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: theme.divider }}>
                    <Text style={{ color: theme.subtext, fontSize: 11 }}>{row.l}</Text>
                    <Text style={{ color: row.accent ? theme.accent : theme.text, fontSize: 11, fontWeight: '600' }}>{row.v}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* Action buttons */}
        {scanResult === 'valid' && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              onPress={resetScan}
              style={{ flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5, borderColor: theme.border }}
            >
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={confirmEntry}
              disabled={processing}
              style={{ flex: 2, borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: theme.accent }}
            >
              {processing
                ? <ActivityIndicator color="#fff" size="small"/>
                : <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Confirm Entry</Text>
              }
            </TouchableOpacity>
          </View>
        )}

        {(scanResult === 'already_scanned' || scanResult === 'invalid' || scanResult === 'error') && (
          <TouchableOpacity
            onPress={resetScan}
            style={{ borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: theme.card, borderWidth: 1.5, borderColor: theme.border }}
          >
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>Scan another ticket</Text>
          </TouchableOpacity>
        )}

      </View>
    </View>
  );
}
