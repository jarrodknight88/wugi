// ─────────────────────────────────────────────────────────────────────
// IDScanScreen — scans back of driver's license (PDF417 barcode)
// Parses AAMVA data, matches name to ticket holder, stores verification
// Supports bypass with chargeback responsibility acknowledgment
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Vibration, Animated, ScrollView, Modal,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import firestore from '@react-native-firebase/firestore';
import { useSession } from '../context/SessionContext';
import { parseAAMVA, nameMatchScore, ParsedID } from '../utils/aamvaParser';

export interface IDScanProps {
  ticketId: string;
  holderName: string;
  cardLast4?: string;
  cardholderName?: string;
  minAge?: number;
  amountCents?: number;   // used in bypass warning
  onVerified: (result: VerificationResult) => void;
  onSkip: () => void;
}

export interface VerificationResult {
  verified: boolean;
  idName: string; idDob: string; idState: string; idNumberLast4: string;
  age: number; ageVerified: boolean; nameMatchScore: number;
  cardNameMatch: boolean | null; cardLast4?: string; scannedAt: Date;
}

type ScanState = 'scanning' | 'result' | 'saving' | 'done' | 'error';

// ── Bypass Confirmation Modal ─────────────────────────────────────────
function BypassModal({
  amountCents,
  onAccept,
  onCancel,
}: {
  amountCents: number;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const amountDisplay = `$${(amountCents / 100).toFixed(2)}`;
  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <Text style={styles.modalTitle}>⚠️ Bypass ID Verification</Text>
          <Text style={styles.modalAmount}>Transaction: {amountDisplay}</Text>
          <Text style={styles.modalBody}>
            This transaction meets or exceeds the ID verification threshold set for this event.
          </Text>
          <View style={styles.modalWarningBox}>
            <Text style={styles.modalWarningText}>
              By proceeding without scanning this guest's ID, you accept sole responsibility for this transaction. Wugi will not cover any chargebacks, disputes, or fraudulent activity resulting from an unverified guest. This bypass will be recorded on the transaction record.
            </Text>
          </View>
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancelBtn} onPress={onCancel}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalAcceptBtn} onPress={onAccept}>
              <Text style={styles.modalAcceptText}>I Accept Responsibility</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function IDScanScreen({
  ticketId, holderName, cardLast4, cardholderName, minAge = 21,
  amountCents = 0, onVerified, onSkip,
}: IDScanProps) {
  const { session } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanState, setScanState]     = useState<ScanState>('scanning');
  const [parsedID, setParsedID]       = useState<ParsedID | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [saving, setSaving]           = useState(false);
  const [showBypassModal, setShowBypassModal] = useState(false);
  const scanned = useRef(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  function showResult() {
    Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }

  // Staff taps "Skip" — show bypass warning before allowing
  function handleSkipRequest() {
    setShowBypassModal(true);
  }

  // Staff accepted responsibility — write bypass record then proceed
  async function handleBypassAccepted() {
    setShowBypassModal(false);
    // Record the bypass on the ticket doc if we have a ticketId
    if (ticketId && session) {
      try {
        await firestore()
          .collection('events').doc(session.eventId)
          .collection('tickets').doc(ticketId)
          .update({
            idVerificationBypassed: {
              bypassedAt: firestore.FieldValue.serverTimestamp(),
              bypassedBy: session.pin,
              amountCents,
              responsibilityAccepted: true,
            },
            updatedAt: firestore.FieldValue.serverTimestamp(),
          });
      } catch (e) {
        // Non-blocking — proceed regardless
      }
    }
    onSkip();
  }

  async function handleBarCodeScanned({ data }: { data: string }) {
    if (scanned.current) return;
    scanned.current = true;
    const id = parseAAMVA(data);
    if (!id) { scanned.current = false; return; }
    Vibration.vibrate(100);
    const score = nameMatchScore(id.fullName, holderName);
    const ageVerified = id.age >= minAge;
    let cardNameMatch: boolean | null = null;
    if (cardholderName?.trim()) {
      cardNameMatch = nameMatchScore(id.fullName, cardholderName) >= 0.7;
    }
    const result: VerificationResult = {
      verified: score >= 0.7 && ageVerified && !id.isExpired,
      idName: id.fullName, idDob: id.dob, idState: id.state,
      idNumberLast4: id.idNumberLast4, age: id.age, ageVerified,
      nameMatchScore: score, cardNameMatch, cardLast4, scannedAt: new Date(),
    };
    setParsedID(id); setVerification(result);
    setScanState('result'); showResult();
  }

  async function saveAndContinue() {
    if (!verification || !session) return;
    setSaving(true);
    try {
      await firestore()
        .collection('events').doc(session.eventId)
        .collection('tickets').doc(ticketId)
        .update({
          idVerification: {
            verified: verification.verified,
            idName: verification.idName, idDob: verification.idDob,
            idState: verification.idState, idNumberLast4: verification.idNumberLast4,
            age: verification.age, ageVerified: verification.ageVerified,
            nameMatchScore: Math.round(verification.nameMatchScore * 100),
            cardNameMatch: verification.cardNameMatch,
            cardLast4: verification.cardLast4 || null,
            scannedAt: firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: firestore.FieldValue.serverTimestamp(),
        });
      setScanState('done');
      setTimeout(() => onVerified(verification), 800);
    } catch (e) { setScanState('error'); }
    finally { setSaving(false); }
  }

  if (!permission) return <View style={styles.container} />;
  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.permText}>Camera access required to scan ID.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Access</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (scanState === 'done') {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.doneIcon}>✓</Text>
        <Text style={styles.doneText}>ID Verified</Text>
      </View>
    );
  }

  const nameScore = verification?.nameMatchScore ?? 0;
  const nameMatch = nameScore >= 0.7;
  const ageOk     = verification?.ageVerified ?? false;
  const expired   = parsedID?.isExpired ?? false;
  const overallOk = verification?.verified ?? false;

  return (
    <View style={styles.container}>
      {/* Bypass confirmation modal */}
      {showBypassModal && (
        <BypassModal
          amountCents={amountCents}
          onAccept={handleBypassAccepted}
          onCancel={() => setShowBypassModal(false)}
        />
      )}

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Scan Back of ID</Text>
        <TouchableOpacity onPress={handleSkipRequest}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      {scanState === 'scanning' && (
        <View style={styles.instructionRow}>
          <Text style={styles.instructionText}>
            Point camera at the PDF417 barcode on the back of the guest's ID
          </Text>
        </View>
      )}

      <View style={{ flex: 1, display: scanState === 'scanning' ? 'flex' : 'none' }}>
        <CameraView style={styles.camera} facing="back"
          onBarcodeScanned={scanState === 'scanning' ? handleBarCodeScanned : undefined}
          barcodeScannerSettings={{ barcodeTypes: ['pdf417'] }}>
          <View style={styles.viewfinder}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
            <Text style={styles.hint}>Align barcode within frame</Text>
          </View>
        </CameraView>
      </View>

      {(scanState === 'result' || scanState === 'saving' || scanState === 'error') && verification && parsedID && (
        <Animated.ScrollView style={[styles.resultPanel, { opacity: fadeAnim }]}
          contentContainerStyle={styles.resultContent}>
          <View style={[styles.statusBadge, { backgroundColor: overallOk ? '#0d3d2a' : '#3d0d0d', borderColor: overallOk ? '#2a7a5a' : '#cc3333' }]}>
            <Text style={[styles.statusIcon, { color: overallOk ? '#2a7a5a' : '#cc3333' }]}>{overallOk ? '✓' : '!'}</Text>
            <Text style={[styles.statusLabel, { color: overallOk ? '#2a7a5a' : '#cc3333' }]}>{overallOk ? 'ID Verified' : 'Verification Issue'}</Text>
          </View>
          <View style={styles.idCard}>
            <Row label="Name on ID" value={parsedID.fullName} />
            <Row label="Ticket Holder" value={holderName} />
            <Row label="Date of Birth" value={parsedID.dobDisplay} />
            <Row label="Age" value={`${parsedID.age}`} highlight={!ageOk ? 'warn' : 'ok'} />
            <Row label="State" value={parsedID.state} />
            <Row label="ID #" value={`••••${parsedID.idNumberLast4}`} />
            <Row label="Expires" value={parsedID.expiryDate} highlight={expired ? 'warn' : 'ok'} />
          </View>
          <View style={styles.matchRow}>
            <MatchBadge label="Name Match" ok={nameMatch} detail={`${Math.round(nameScore * 100)}%`} />
            <MatchBadge label={`Age ${minAge}+`} ok={ageOk} detail={ageOk ? '✓' : '✗'} />
            <MatchBadge label="Not Expired" ok={!expired} detail={expired ? 'EXPIRED' : '✓'} />
            {verification.cardNameMatch !== null && (
              <MatchBadge label="Card Match" ok={!!verification.cardNameMatch} detail={verification.cardNameMatch ? '✓' : '!'} />
            )}
          </View>
          {!nameMatch && <Warn text={`Name mismatch — ID: "${parsedID.fullName}" vs Ticket: "${holderName}"`} />}
          {!ageOk && <Warn text={`Guest is ${parsedID.age} — below minimum age of ${minAge}`} />}
          {expired && <Warn text="This ID is expired — do not accept" />}
          {verification.cardNameMatch === false && <Warn text="Card name doesn't match ID — verify with guest" />}
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.skipBtn} onPress={handleSkipRequest}>
              <Text style={styles.skipBtnText}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rescanBtn} onPress={() => { scanned.current = false; setScanState('scanning'); }}>
              <Text style={styles.rescanBtnText}>Rescan</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: overallOk ? '#2a7a5a' : '#b45309' }]}
              onPress={saveAndContinue} disabled={saving}>
              <Text style={styles.confirmBtnText}>{saving ? 'Saving…' : overallOk ? 'Confirm' : 'Override & Save'}</Text>
            </TouchableOpacity>
          </View>
        </Animated.ScrollView>
      )}
    </View>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: 'ok' | 'warn' }) {
  const color = highlight === 'warn' ? '#e6a817' : highlight === 'ok' ? '#2a7a5a' : '#aaa';
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, highlight ? { color } : {}]}>{value}</Text>
    </View>
  );
}
function MatchBadge({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <View style={[styles.badge, { borderColor: ok ? '#2a7a5a' : '#cc3333', backgroundColor: ok ? '#0d1f16' : '#1f0d0d' }]}>
      <Text style={[styles.badgeDetail, { color: ok ? '#2a7a5a' : '#cc3333' }]}>{detail}</Text>
      <Text style={styles.badgeLabel}>{label}</Text>
    </View>
  );
}
function Warn({ text }: { text: string }) {
  return <View style={styles.warnBox}><Text style={styles.warnText}>⚠️  {text}</Text></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12, backgroundColor: '#111' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  skipText: { fontSize: 14, color: '#555', fontWeight: '600' },
  instructionRow: { backgroundColor: '#161616', padding: 14, borderBottomWidth: 1, borderBottomColor: '#222' },
  instructionText: { fontSize: 13, color: '#888', textAlign: 'center' },
  camera: { flex: 1 },
  viewfinder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 36, height: 22, borderColor: '#2a7a5a', borderWidth: 3 },
  tl: { top: '35%', left: '10%', borderRightWidth: 0, borderBottomWidth: 0 },
  tr: { top: '35%', right: '10%', borderLeftWidth: 0, borderBottomWidth: 0 },
  bl: { bottom: '35%', left: '10%', borderRightWidth: 0, borderTopWidth: 0 },
  br: { bottom: '35%', right: '10%', borderLeftWidth: 0, borderTopWidth: 0 },
  hint: { color: '#2a7a5a', fontSize: 13, fontWeight: '500', marginTop: 60 },
  resultPanel: { flex: 1 },
  resultContent: { padding: 20, paddingBottom: 40 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1.5, marginBottom: 16 },
  statusIcon: { fontSize: 28, fontWeight: '800' },
  statusLabel: { fontSize: 18, fontWeight: '700' },
  idCard: { backgroundColor: '#161616', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#222' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  rowLabel: { fontSize: 13, color: '#555' },
  rowValue: { fontSize: 13, color: '#aaa', fontWeight: '600' },
  matchRow: { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  badge: { flex: 1, minWidth: 70, alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1 },
  badgeDetail: { fontSize: 16, fontWeight: '800', marginBottom: 3 },
  badgeLabel: { fontSize: 10, color: '#555', textAlign: 'center' },
  warnBox: { backgroundColor: '#2a1a00', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e6a817' },
  warnText: { color: '#e6a817', fontSize: 13, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  skipBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  skipBtnText: { color: '#555', fontWeight: '600', fontSize: 14 },
  rescanBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#1a1a2a', borderWidth: 1, borderColor: '#2a2a4a' },
  rescanBtnText: { color: '#7c8aed', fontWeight: '600', fontSize: 14 },
  confirmBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 12 },
  confirmBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  permText: { color: '#aaa', textAlign: 'center', marginBottom: 20, fontSize: 15, paddingHorizontal: 32 },
  permBtn: { backgroundColor: '#2a7a5a', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  permBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  doneIcon: { fontSize: 64, color: '#2a7a5a', marginBottom: 16 },
  doneText: { fontSize: 22, fontWeight: '800', color: '#fff' },
  // Bypass modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalBox: { backgroundColor: '#111', borderRadius: 18, padding: 24, width: '100%', borderWidth: 1, borderColor: '#e6a817' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#e6a817', marginBottom: 4, textAlign: 'center' },
  modalAmount: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 16 },
  modalBody: { fontSize: 14, color: '#aaa', lineHeight: 20, marginBottom: 14, textAlign: 'center' },
  modalWarningBox: { backgroundColor: '#2a1a00', borderRadius: 10, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: '#b45309' },
  modalWarningText: { fontSize: 13, color: '#fbbf24', lineHeight: 19 },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#1a1a1a', alignItems: 'center', borderWidth: 1, borderColor: '#2a2a2a' },
  modalCancelText: { color: '#888', fontWeight: '700', fontSize: 14 },
  modalAcceptBtn: { flex: 2, paddingVertical: 13, borderRadius: 12, backgroundColor: '#b45309', alignItems: 'center' },
  modalAcceptText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
