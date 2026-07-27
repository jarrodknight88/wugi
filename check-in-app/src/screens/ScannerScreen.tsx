import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Vibration, Animated, Modal,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import firestore from '@react-native-firebase/firestore';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import { useSession } from '../context/SessionContext';
import { useLocationCheck } from '../hooks/useLocationCheck';
import { generateIdempotencyKey } from '../utils/idempotencyKey';
import { COLORS, PASS_FALLBACK } from '../constants/colors';

// Tap to Pay is pending Apple entitlement approval — disabled until approved
const TAP_TO_PAY_ENABLED = true;
type PaymentMode = any;

type ScanResult =
  | 'valid' | 'already_scanned' | 'invalid' | 'wrong_event' | 'balance_blocked'
  | 'sync_failed' | 'permission_denied' | null;

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
  scannedAtLabel?: string;
}

export default function ScannerScreen() {
  const { session, clearSession, setSession } = useSession();
  const { getCurrentCoords } = useLocationCheck();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning]       = useState(true);
  const [result, setResult]           = useState<ScanResult>(null);
  const [ticketInfo, setTicketInfo]   = useState<TicketInfo | null>(null);
  const [checkedIn, setCheckedIn]     = useState(0);
  const [total, setTotal]             = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  // Bumped on every showResult() call; a stale animation-complete callback
  // checks this before clearing state so a late auto-dismiss from a
  // superseded result (e.g. optimistic 'valid' → reconciled 'sync_failed')
  // can't clobber the newer one.
  const resultGenRef = useRef(0);
  const pendingRetryRef = useRef<{ passId: string; info: TicketInfo; idempotencyKey: string } | null>(null);

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

  // `sticky` results (sync failure, permission denied) stay on screen until
  // the staff member dismisses or retries — auto-dismissing an unresolved
  // check-in would hide the exact case that needs their attention.
  function showResult(r: ScanResult, info: TicketInfo | null = null, opts?: { sticky?: boolean }) {
    const gen = ++resultGenRef.current;
    fadeAnim.stopAnimation();
    fadeAnim.setValue(0);
    setResult(r); setTicketInfo(info); setScanning(false);
    const sticky = opts?.sticky ?? false;
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ...(sticky ? [] : [
        Animated.delay(r === 'valid' && (info?.balanceDue ?? 0) > 0 ? 8000 : 2800),
        Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]),
    ]).start(() => {
      if (resultGenRef.current !== gen || sticky) return;
      setResult(null); setTicketInfo(null); setScanning(true);
    });
  }

  function dismissResult() {
    resultGenRef.current++;
    pendingRetryRef.current = null;
    fadeAnim.stopAnimation();
    fadeAnim.setValue(0);
    setResult(null); setTicketInfo(null); setScanning(true);
  }

  // Fire-and-forget: the optimistic 'valid' flash is already on screen by the
  // time this runs. Reconciles the UI only if the server disagrees.
  async function submitCheckIn(passId: string, info: TicketInfo, idempotencyKey: string) {
    if (!session) return;
    let scanLat: number | null = null;
    let scanLng: number | null = null;
    try {
      const coords = await getCurrentCoords();
      if (coords.status === 'ok') { scanLat = coords.lat; scanLng = coords.lng; }
    } catch { /* soft geofence — missing coords just means geofenceOk:false server-side */ }

    try {
      const checkInPass = httpsCallable(getFunctions(), 'checkInPass');
      const res = await checkInPass({
        passId,
        venueId: session.venueId,
        eventId: session.eventId,
        scanLat, scanLng,
        clientScannedAt: new Date().toISOString(),
        idempotencyKey,
      });
      const data = res.data as { alreadyCheckedIn: boolean; scannedBy?: string | null };
      if (data.alreadyCheckedIn) {
        // Someone else redeemed this pass between our local read and the
        // server call — re-read for the real scan time to show staff.
        let scannedAtLabel: string | undefined;
        try {
          const fresh = await firestore().collection('passes').doc(passId).get();
          const ts: any = fresh.data()?.scannedAt;
          if (ts?.toDate) scannedAtLabel = ts.toDate().toLocaleTimeString();
        } catch { /* show without a time rather than block on this */ }
        Vibration.vibrate([0, 200, 100, 200]);
        showResult('already_scanned', { ...info, scannedAtLabel });
      }
    } catch (e: any) {
      if (e?.code === 'functions/permission-denied') {
        Vibration.vibrate([0, 100, 100, 100]);
        showResult('permission_denied', info, { sticky: true });
        return;
      }
      pendingRetryRef.current = { passId, info, idempotencyKey };
      Vibration.vibrate([0, 100, 100, 100]);
      showResult('sync_failed', info, { sticky: true });
    }
  }

  function retryPendingCheckIn() {
    const pending = pendingRetryRef.current;
    if (!pending) return;
    Vibration.vibrate(150);
    showResult('valid', pending.info);
    submitCheckIn(pending.passId, pending.info, pending.idempotencyKey);
  }

  async function handleBarCodeScanned({ data }: { data: string }) {
    if (!scanning || !session) return;
    setScanning(false);
    try {
      // QR encodes plain passId (no prefix) — look up in passes collection
      const scannedValue = data.replace('WUGI:', '').trim();

      // Look up pass by doc ID (the normal case — QR encodes its own passId)
      let passSnap = await firestore().collection('passes').doc(scannedValue).get();

      // Fallback: some wallet passes encode the order ID rather than a
      // specific passId (one .pkpass is issued per order). Resolve to the
      // purchaser's pass on that order so those QR codes still scan.
      if (!passSnap.exists) {
        const byOrder = await firestore().collection('passes')
          .where('orderId', '==', scannedValue)
          .limit(5)
          .get();
        if (!byOrder.empty) {
          passSnap = byOrder.docs.find(d => d.data().role === 'purchaser') || byOrder.docs[0];
        }
      }

      if (!passSnap.exists) {
        Vibration.vibrate([0, 100, 100, 100]); showResult('invalid'); return;
      }

      const pass   = passSnap.data()!;
      const passId = passSnap.id;

      // Enforce event match for non-super-admin
      if (!session.isSuperAdmin && pass.eventId && pass.eventId !== session.eventId) {
        Vibration.vibrate([0, 100, 100, 100]);
        showResult('wrong_event', {
          holderName: pass.holderName, ticketType: pass.ticketTypeName || '',
          ticketTypeName: pass.ticketTypeName || '', ticketTypeId: pass.ticketTypeId || '',
          ticketColor: pass.passColor || PASS_FALLBACK, quantity: 1,
          ticketId: passId, balanceDue: pass.balanceDue ?? 0, holderEmail: pass.holderEmail || '',
        });
        return;
      }

      if (pass.scanStatus === 'scanned') {
        Vibration.vibrate([0, 200, 100, 200]);
        const scannedAt: any = pass.scannedAt;
        showResult('already_scanned', {
          holderName: pass.holderName, ticketType: pass.ticketTypeName || '',
          ticketTypeName: pass.ticketTypeName || '', ticketTypeId: pass.ticketTypeId || '',
          ticketColor: pass.passColor || PASS_FALLBACK, quantity: 1,
          ticketId: passId, balanceDue: pass.balanceDue ?? 0, holderEmail: pass.holderEmail || '',
          scannedAtLabel: scannedAt?.toDate ? scannedAt.toDate().toLocaleTimeString() : undefined,
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
            // Pass/ticket colour field (not chrome) — intentionally left as a
            // literal per the balance-blocked pass display; do not tokenize.
            ticketColor: '#e6a817',
            quantity: 1,
            ticketId: passId,
            balanceDue: orderBalanceDue,
            holderEmail: pass.holderEmail || '',
          });
          return;
        }
      }

      // Valid — flash success immediately (door velocity matters more than
      // round-trip confirmation) and let checkInPass do the actual write.
      const info: TicketInfo = {
        holderName: pass.holderName, ticketType: pass.ticketTypeName || '',
        ticketTypeName: pass.ticketTypeName || '', ticketTypeId: pass.ticketTypeId || '',
        ticketColor: pass.passColor || PASS_FALLBACK, quantity: 1,
        ticketId: passId, balanceDue: pass.balanceDue ?? 0, holderEmail: pass.holderEmail || '',
      };
      Vibration.vibrate(150);
      showResult('valid', info);
      submitCheckIn(passId, info, generateIdempotencyKey());
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

  // NOTE: the four `bg` washes below (0d3d2a/3d2a00/3d0d0d/3d1a00) are unique
  // one-off shades that don't exactly match goDeep/warnDeep/stopDeep — left
  // as literals rather than guess a consolidation that would shift pixels.
  // See PR description.
  const resultConfig = {
    valid:            { bg: '#0d3d2a', border: COLORS.go,   icon: '✓', label: 'Valid Ticket',       color: COLORS.go },
    already_scanned:  { bg: '#3d2a00', border: COLORS.warn, icon: '!', label: 'Already Scanned',    color: COLORS.warn },
    invalid:          { bg: '#3d0d0d', border: COLORS.stop, icon: '✕', label: 'Invalid Ticket',     color: COLORS.stop },
    wrong_event:      { bg: '#3d0d0d', border: COLORS.stop, icon: '✕', label: 'Wrong Event',        color: COLORS.stop },
    balance_blocked:  { bg: '#3d1a00', border: COLORS.warn, icon: '⚠', label: 'Balance Outstanding', color: COLORS.warn },
    sync_failed:      { bg: '#3d1a00', border: COLORS.warn, icon: '⟳', label: 'Not Confirmed',      color: COLORS.warn },
    permission_denied:{ bg: '#3d0d0d', border: COLORS.stop, icon: '✕', label: 'Not Authorized',     color: COLORS.stop },
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

              {result === 'already_scanned' && ticketInfo.scannedAtLabel && (
                <Text style={styles.resultDetail}>Scanned at {ticketInfo.scannedAtLabel}</Text>
              )}

              {result === 'permission_denied' && (
                <View style={styles.balanceWarning}>
                  <Text style={styles.balanceWarningText}>Your account isn't authorized for this venue — check-in was NOT recorded.</Text>
                  <TouchableOpacity style={styles.collectBtn} onPress={dismissResult}>
                    <Text style={styles.collectBtnText}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
              )}

              {result === 'sync_failed' && (
                <View style={styles.balanceWarning}>
                  <Text style={styles.balanceWarningText}>Couldn't confirm with the server — check-in may not have been recorded.</Text>
                  <TouchableOpacity style={styles.collectBtn} onPress={retryPendingCheckIn}>
                    <Text style={styles.collectBtnText}>Retry</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dismissInline} onPress={dismissResult}>
                    <Text style={styles.balanceHint}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* ⚠️ Balance due — guest pass blocked or collect at door */}
              {hasBalance && result !== 'sync_failed' && result !== 'permission_denied' && (
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
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 56, paddingBottom: 12, backgroundColor: '#111' },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  backBtnText: { color: COLORS.text, fontSize: 20, lineHeight: 22 },
  headerCenter: { flex: 1 },
  eventName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  venueName: { fontSize: 12, color: '#888', marginTop: 2 },
  countBadge: { alignItems: 'center', marginLeft: 8 },
  countNum: { fontSize: 24, fontWeight: '800', color: COLORS.brand },
  countLabel: { fontSize: 11, color: '#888' },
  camera: { flex: 1 },
  viewfinder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: COLORS.brand, borderWidth: 3 },
  tl: { top: '30%', left: '20%', borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  tr: { top: '30%', right: '20%', borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  bl: { bottom: '30%', left: '20%', borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  br: { bottom: '30%', right: '20%', borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  hint: { color: COLORS.brand, fontSize: 13, fontWeight: '500', marginTop: 80 },
  resultOverlay: { position: 'absolute', bottom: 32, left: 16, right: 16, borderRadius: 20, borderWidth: 1.5, padding: 22, alignItems: 'center' },
  resultIcon: { fontSize: 40, fontWeight: '800', marginBottom: 6 },
  resultLabel: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  resultName: { fontSize: 18, color: COLORS.text, fontWeight: '600', marginBottom: 2 },
  resultDetail: { fontSize: 14, color: '#aaa', marginBottom: 4 },
  resultId: { fontSize: 11, color: COLORS.subtext, marginBottom: 8 },
  balanceWarning: { width: '100%', backgroundColor: COLORS.warnDeep, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: COLORS.warn, marginTop: 8 },
  balanceWarningText: { fontSize: 16, fontWeight: '800', color: COLORS.warn, marginBottom: 12 },
  collectBtn: { backgroundColor: COLORS.warn, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28, width: '100%', alignItems: 'center' },
  collectBtnText: { fontSize: 16, fontWeight: '800', color: '#000' },
  balanceHint: { fontSize: 12, color: '#a16207', textAlign: 'center', marginTop: 2 },
  dismissInline: { marginTop: 10, alignItems: 'center' },
  permText: { color: '#aaa', textAlign: 'center', marginBottom: 20, fontSize: 15, paddingHorizontal: 32 },
  permBtn: { backgroundColor: COLORS.brand, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  permBtnText: { color: COLORS.text, fontWeight: '700', fontSize: 16 },
});
