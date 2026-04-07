// ─────────────────────────────────────────────────────────────────────
// PaymentScreen — Tap to Pay via Stripe Terminal
// Flow: Enter details → Scan ID → Charge → Success
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, TextInput, ScrollView, Vibration,
} from 'react-native';
// Stripe Terminal disabled pending Apple entitlement approval.
// When TAP_TO_PAY_ENABLED = true, replace stub with:
//   import { useStripeTerminal } from '@stripe/stripe-terminal-react-native';
const TAP_TO_PAY_ENABLED = false;
function useStripeTerminal() {
  return {
    collectPaymentMethod: async (_: any) => ({ paymentIntent: null, error: { message: 'Tap to Pay not enabled' } }),
    confirmPaymentIntent: async (_: any) => ({ error: { message: 'Tap to Pay not enabled' } }),
    cancelCollectPaymentMethod: async () => {},
  };
}
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import firestore from '@react-native-firebase/firestore';
import { useSession } from '../context/SessionContext';
import { useTerminal } from '../context/TerminalContext';
import IDScanScreen from './IDScanScreen';
import type { VerificationResult } from './IDScanScreen';

export type PaymentMode =
  | { type: 'balance'; ticketId: string; holderName: string; balanceDue: number; holderEmail?: string }
  | { type: 'walkin';  ticketTypeName: string; ticketTypeId: string; price: number; color: string };

interface Props {
  mode: PaymentMode;
  onSuccess: () => void;
  onCancel: () => void;
}

// Steps: details form → id_scan → collecting payment → processing → success/error
type PaymentStep = 'details' | 'id_scan' | 'connecting' | 'collecting' | 'processing' | 'success' | 'error';

export default function PaymentScreen({ mode, onSuccess, onCancel }: Props) {
  const { session } = useSession();
  const { isReady, isConnecting, connectReader } = useTerminal();
  const { collectPaymentMethod, confirmPaymentIntent, cancelCollectPaymentMethod } = useStripeTerminal();

  const defaultAmount = mode.type === 'balance' ? mode.balanceDue : mode.price;
  const [amountCents, setAmountCents] = useState(defaultAmount);
  const [amountInput, setAmountInput] = useState((defaultAmount / 100).toFixed(2));
  const [holderName, setHolderName]   = useState(mode.type === 'balance' ? mode.holderName : '');
  const [holderEmail, setHolderEmail] = useState(mode.type === 'balance' ? (mode.holderEmail || '') : '');
  const [tableAssign, setTableAssign] = useState('');
  const [step, setStep]               = useState<PaymentStep>('details');
  const [errorMsg, setErrorMsg]       = useState('');
  const [idVerification, setIdVerification] = useState<VerificationResult | null>(null);
  const [completedTicketId, setCompletedTicketId] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [idThreshold, setIdThreshold] = useState(30000); // default $300

  // Load ID verification threshold from event doc
  useEffect(() => {
    if (!session?.eventId) return;
    firestore().collection('events').doc(session.eventId).get().then(snap => {
      if (snap.exists) {
        const threshold = snap.data()?.idVerificationThreshold;
        if (typeof threshold === 'number') setIdThreshold(threshold);
      }
    }).catch(() => {});
  }, [session?.eventId]);

  useEffect(() => {
    if (!isReady && !isConnecting && session?.venueId) {
      connectReader(session.venueId);
    }
  }, []);

  // ── Step 1: Validate form — decide whether ID scan is needed ─────
  function proceedToIDScan() {
    if (amountCents < 50) { Alert.alert('Minimum charge is $0.50'); return; }
    if (mode.type === 'walkin' && !holderName.trim()) {
      Alert.alert('Name required', 'Please enter the guest name.'); return;
    }
    // Check threshold: -1=never, 0=always, >0=require if amount >= threshold
    const needsID = idThreshold === 0 || (idThreshold > 0 && amountCents >= idThreshold);
    if (needsID) {
      setStep('id_scan');
    } else {
      startPayment(null); // skip ID scan entirely
    }
  }

  // ── Step 2: ID scan complete → proceed to payment ────────────────
  function onIDVerified(result: VerificationResult) {
    setIdVerification(result);
    startPayment(result);
  }
  function onIDSkipped() {
    startPayment(null);
  }

  // ── Step 3: Collect payment ───────────────────────────────────────
  async function startPayment(verification: VerificationResult | null) {
    if (!session) return;
    setStep('connecting');
    try {
      if (!isReady) await connectReader(session.venueId);

      const createPI = httpsCallable(getFunctions(), 'createTerminalPaymentIntent');
      const result = await createPI({
        amountCents,
        venueId: session.venueId,
        eventId: session.eventId,
        ticketId: mode.type === 'balance' ? mode.ticketId : undefined,
        description: mode.type === 'balance'
          ? `Balance due — ${mode.holderName}`
          : `Door sale — ${mode.ticketTypeName}`,
        customerName: holderName || undefined,
        customerEmail: holderEmail || undefined,
      });

      const { paymentIntentId: piId } = result.data as any;
      setStep('collecting');

      const { paymentIntent, error: collectErr } = await collectPaymentMethod({ paymentIntentId: piId });
      if (collectErr) throw new Error(collectErr.message);

      setStep('processing');

      const { error: confirmErr } = await confirmPaymentIntent({ paymentIntent: paymentIntent! });
      if (confirmErr) throw new Error(confirmErr.message);

      const piCardName = (paymentIntent as any)?.paymentMethod?.card?.cardholderName || '';
      setCardholderName(piCardName);

      const capture = httpsCallable(getFunctions(), 'captureTerminalPayment');
      await capture({
        paymentIntentId: piId,
        ticketId: mode.type === 'balance' ? mode.ticketId : undefined,
        eventId: session.eventId,
        amountCents,
        newTicketData: mode.type === 'walkin' ? {
          holderName: holderName.trim(),
          holderEmail: holderEmail.trim(),
          ticketTypeId: mode.ticketTypeId,
          ticketTypeName: mode.ticketTypeName,
          color: mode.color,
          tableAssignment: tableAssign.trim(),
        } : undefined,
      });

      Vibration.vibrate(200);
      setStep('success');
      setTimeout(onSuccess, 1800);
    } catch (e: any) {
      setErrorMsg(e.message || 'Payment failed');
      setStep('error');
    }
  }

  async function handleCancel() {
    if (step === 'collecting') await cancelCollectPaymentMethod();
    onCancel();
  }

  // ── Render ────────────────────────────────────────────────────────
  const isWalkin = mode.type === 'walkin';
  const guestName = holderName || (mode.type === 'balance' ? mode.holderName : '');

  // ID Scan — step between form and payment
  if (step === 'id_scan') {
    return (
      <IDScanScreen
        ticketId={mode.type === 'balance' ? mode.ticketId : ''}
        holderName={guestName}
        cardholderName={cardholderName || undefined}
        amountCents={amountCents}
        minAge={21}
        onVerified={onIDVerified}
        onSkip={onIDSkipped}
      />
    );
  }

  // Success
  if (step === 'success') {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.successIcon}>✓</Text>
        <Text style={styles.successText}>Payment Accepted</Text>
        <Text style={styles.successAmount}>${(amountCents / 100).toFixed(2)}</Text>
        {guestName ? <Text style={styles.successSub}>{guestName}</Text> : null}
        {idVerification && (
          <Text style={{ color: idVerification.verified ? '#2a7a5a' : '#e6a817', fontSize: 13, marginTop: 8 }}>
            {idVerification.verified ? '✓ ID Verified' : '⚠️ ID issue flagged'}
          </Text>
        )}
      </View>
    );
  }

  // Tap prompt
  if (step === 'collecting') {
    return (
      <View style={[styles.container, styles.centered]}>
        <View style={styles.tapRing}><Text style={styles.tapIcon}>📱</Text></View>
        <Text style={styles.tapLabel}>Present Card or Device</Text>
        <Text style={styles.tapAmount}>${(amountCents / 100).toFixed(2)}</Text>
        <Text style={styles.tapHint}>Tap, insert, or swipe</Text>
        <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Connecting / Processing
  if (step === 'processing' || step === 'connecting') {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#2a7a5a" />
        <Text style={styles.processingText}>
          {step === 'connecting' ? 'Connecting reader…' : 'Processing…'}
        </Text>
      </View>
    );
  }

  // Error
  if (step === 'error') {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorIcon}>✕</Text>
        <Text style={styles.errorTitle}>Payment Failed</Text>
        <Text style={styles.errorMsg}>{errorMsg}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => setStep('details')}>
          <Text style={styles.retryBtnText}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Details form (initial step)
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.form}>
      <Text style={styles.title}>{isWalkin ? '💳 Door Sale' : '💳 Collect Balance'}</Text>
      {!isWalkin && <Text style={styles.subtitle}>{mode.holderName}</Text>}

      <View style={styles.amountRow}>
        <Text style={styles.dollarSign}>$</Text>
        <TextInput style={styles.amountInput} value={amountInput} keyboardType="decimal-pad" selectTextOnFocus
          onChangeText={v => { setAmountInput(v); setAmountCents(Math.round(parseFloat(v || '0') * 100)); }} />
      </View>

      {isWalkin && (
        <>
          <TextInput style={styles.field} placeholder="Guest name *" placeholderTextColor="#555"
            value={holderName} onChangeText={setHolderName} autoCapitalize="words" />
          <TextInput style={styles.field} placeholder="Email (optional)" placeholderTextColor="#555"
            value={holderEmail} onChangeText={setHolderEmail} keyboardType="email-address" autoCapitalize="none" />
          <TextInput style={styles.field} placeholder="Table assignment (optional)" placeholderTextColor="#555"
            value={tableAssign} onChangeText={setTableAssign} />
        </>
      )}

      <View style={styles.disclosureBox}>
        <Text style={styles.disclosureText}>⚠️ All sales are final. No refunds.</Text>
      </View>

      {/* ID scan notice — only shown when ID will be required */}
      {(() => {
        const needsID = idThreshold === 0 || (idThreshold > 0 && amountCents >= idThreshold);
        if (!needsID) return null;
        return (
          <View style={styles.idNotice}>
            <Text style={styles.idNoticeText}>🪪  Guest ID scan required before charging</Text>
          </View>
        );
      })()}

      <Text style={styles.readerStatus}>
        {isReady ? '🟢 Reader ready' : isConnecting ? '⏳ Connecting reader…' : '🔴 Reader not connected'}
      </Text>

      <TouchableOpacity
        style={[styles.chargeBtn, amountCents < 50 && styles.chargeBtnDisabled]}
        onPress={proceedToIDScan}
        disabled={amountCents < 50}
      >
        <Text style={styles.chargeBtnText}>
          {(idThreshold === 0 || (idThreshold > 0 && amountCents >= idThreshold))
            ? `Scan ID & Charge $${(amountCents / 100).toFixed(2)}`
            : `Charge $${(amountCents / 100).toFixed(2)}`}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
        <Text style={styles.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  centered: { alignItems: 'center', justifyContent: 'center' },
  form: { padding: 24, paddingTop: 60 },
  title: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 15, color: '#888', marginBottom: 24 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  dollarSign: { fontSize: 36, color: '#2a7a5a', fontWeight: '700', marginRight: 4 },
  amountInput: { fontSize: 52, fontWeight: '800', color: '#fff', minWidth: 120, textAlign: 'center' },
  field: { backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 1, borderColor: '#2a2a2a', color: '#fff', fontSize: 16, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 12 },
  disclosureBox: { backgroundColor: '#1a1200', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#3d2a00' },
  disclosureText: { color: '#e6a817', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  idNotice: { backgroundColor: '#0d1f16', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#2a7a5a' },
  idNoticeText: { color: '#4ade80', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  readerStatus: { fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 20 },
  chargeBtn: { backgroundColor: '#2a7a5a', borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginBottom: 12 },
  chargeBtnDisabled: { opacity: 0.4 },
  chargeBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  cancelBtn: { alignItems: 'center', paddingVertical: 14 },
  cancelBtnText: { color: '#555', fontSize: 16, fontWeight: '600' },
  tapRing: { width: 140, height: 140, borderRadius: 70, borderWidth: 3, borderColor: '#2a7a5a', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  tapIcon: { fontSize: 60 },
  tapLabel: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 8 },
  tapAmount: { fontSize: 40, fontWeight: '800', color: '#2a7a5a', marginBottom: 8 },
  tapHint: { fontSize: 14, color: '#888', marginBottom: 40 },
  successIcon: { fontSize: 72, color: '#2a7a5a', marginBottom: 16 },
  successText: { fontSize: 26, fontWeight: '800', color: '#fff', marginBottom: 8 },
  successAmount: { fontSize: 42, fontWeight: '800', color: '#2a7a5a', marginBottom: 6 },
  successSub: { fontSize: 16, color: '#888' },
  processingText: { color: '#888', fontSize: 16, marginTop: 20 },
  errorIcon: { fontSize: 60, color: '#cc3333', marginBottom: 16 },
  errorTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 8 },
  errorMsg: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 32, paddingHorizontal: 32 },
  retryBtn: { backgroundColor: '#2a7a5a', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40, marginBottom: 12 },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
