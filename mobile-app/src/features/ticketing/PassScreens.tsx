// ─────────────────────────────────────────────────────────────────────
// Wugi — PassScreens (updated)
// - PassViewerScreen: Transfer modal + Apple Wallet button
// - MyPassesScreen: Load from orders collection, show transfer status
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, SafeAreaView, Animated, StyleSheet, Share, Dimensions, ActivityIndicator, TextInput, Alert, Linking, KeyboardAvoidingView, Platform, RefreshControl,  } from 'react-native';
import { Image } from 'expo-image';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../../constants/colors';
import type { PassData } from '../../types';
import { getPassStyle } from '../../utils/safeData';
import { groupPassesByOrder, classifyPassGroup, mapPassDoc, isRenderablePassDoc } from '../../utils/passGrouping';
import { PassGroupCard } from './PassGroupCard';
import { BackIcon } from '../../components/icons';
import { logPassViewed } from '../../analytics/analyticsService';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const TRANSFER_URL    = 'https://us-central1-wugi-prod.cloudfunctions.net/initiateTransfer';
const CANCEL_URL      = 'https://us-central1-wugi-prod.cloudfunctions.net/cancelTransfer';

// ── TransferModal ─────────────────────────────────────────────────────
type TransferModalProps = {
  visible:  boolean;
  pass:     PassData;
  onClose:  () => void;
  onSuccess:(claimUrl: string) => void;
};

function TransferModal({ visible, pass, onClose, onSuccess }: TransferModalProps) {
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleTransfer() {
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(TRANSFER_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderId: pass.orderId, toEmail: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Transfer failed');
      onSuccess(data.claimUrl);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Transfer failed. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: '#111' }}>
          <SafeAreaView style={{ flex: 1 }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}>
              <TouchableOpacity onPress={onClose}>
                <Text style={{ color: '#aaa', fontSize: 16 }}>Cancel</Text>
              </TouchableOpacity>
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>Transfer Ticket</Text>
              <View style={{ width: 60 }}/>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20 }}>
              {/* Pass summary */}
              <View style={{ backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: '#2a2a2a' }}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 4 }}>{pass.eventTitle}</Text>
                <Text style={{ color: '#aaa', fontSize: 13 }}>{pass.venueName} · {pass.date}</Text>
                <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#2a2a2a' }}>
                  <Text style={{ color: '#aaa', fontSize: 12 }}>Ticket type: <Text style={{ color: '#fff', fontWeight: '600' }}>{pass.ticketTypeName || pass.ticketType}</Text></Text>
                </View>
              </View>

              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 6 }}>Who are you sending this to?</Text>
              <Text style={{ color: '#888', fontSize: 14, marginBottom: 20, lineHeight: 20 }}>
                They'll receive a link to claim the ticket. Once claimed, your copy will no longer be valid.
              </Text>

              <Text style={{ color: '#888', fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8 }}>RECIPIENT EMAIL</Text>
              <TextInput
                value={email}
                onChangeText={t => { setEmail(t); setError(''); }}
                placeholder="friend@email.com"
                placeholderTextColor="#555"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={{ backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: error ? '#e74c3c' : '#2a2a2a', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: '#fff', fontSize: 16, marginBottom: 8 }}
              />
              {error ? <Text style={{ color: '#e74c3c', fontSize: 13, marginBottom: 16 }}>{error}</Text> : <View style={{ height: 16 }}/>}

              <View style={{ backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 24, borderWidth: 1, borderColor: '#2a2a2a', flexDirection: 'row', gap: 10 }}>
                <Text style={{ fontSize: 18 }}>⚠️</Text>
                <Text style={{ color: '#888', fontSize: 13, flex: 1, lineHeight: 18 }}>
                  This action is irreversible once claimed. Your ticket will be permanently transferred. No refunds apply.
                </Text>
              </View>

              <TouchableOpacity
                onPress={handleTransfer}
                disabled={loading}
                style={{ backgroundColor: '#2a7a5a', borderRadius: 14, paddingVertical: 16, alignItems: 'center', opacity: loading ? 0.7 : 1 }}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small"/>
                  : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Send Transfer Link</Text>
                }
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── TransferSuccessModal ──────────────────────────────────────────────
function TransferSuccessModal({ visible, claimUrl, onClose }: { visible: boolean; claimUrl: string; onClose: () => void }) {
  async function handleShare() {
    await Share.share({ message: `Here's your ticket claim link: ${claimUrl}`, url: claimUrl });
  }
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <SafeAreaView style={{ alignItems: 'center', width: '100%' }}>
          <Text style={{ fontSize: 56, marginBottom: 16 }}>✅</Text>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 8, textAlign: 'center' }}>Transfer sent!</Text>
          <Text style={{ color: '#888', fontSize: 14, textAlign: 'center', marginBottom: 32, lineHeight: 20 }}>
            Share the claim link with your recipient. Your ticket is now on hold until they accept.
          </Text>
          <TouchableOpacity
            onPress={handleShare}
            style={{ width: '100%', backgroundColor: '#2a7a5a', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12 }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Share Claim Link</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ paddingVertical: 14 }}>
            <Text style={{ color: '#888', fontSize: 15 }}>Done</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// ── PassViewerScreen ──────────────────────────────────────────────────
type PassViewerProps = {
  pass: PassData;
  onBack: () => void;
};

export function PassViewerScreen({ pass, onBack }: PassViewerProps) {
  // ── Live pass doc listener — color updates instantly from dashboard ──
  const [livePass, setLivePass] = useState<PassData>(pass);

  // ── pass_viewed — fires once when this pass is opened from MyPassesScreen ──
  useEffect(() => {
    logPassViewed({ eventId: pass.eventId ?? null, passId: pass.passId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    async function subscribe() {
      const { getFirestore, doc, onSnapshot } = await import('@react-native-firebase/firestore');
      const db = getFirestore();
      unsub = onSnapshot(doc(db, 'passes', pass.passId), snap => {
        if (!snap.exists) return;
        const data = snap.data()!;
        setLivePass(prev => ({
          ...prev,
          passColor:  data.passColor  || prev.passColor,
          colorLabel: data.colorLabel || prev.colorLabel,
          status:     data.scanStatus === 'scanned' ? 'scanned' : 'valid',
          balanceDue: data.balanceDue ?? prev.balanceDue,
          depositPaid: data.depositPaid ?? prev.depositPaid,
          passUrl:    data.appleWalletPassUrl || data.passUrl || prev.passUrl,
        }));
      }, () => {});
    }
    subscribe();
    return () => { unsub?.(); };
  }, [pass.passId]);

  const style     = getPassStyle(livePass.ticketTypeName || livePass.ticketType, livePass.passColor);
  const passColor = style.color;
  const pulseAnim   = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.7)).current;
  const flashAnim   = useRef(new Animated.Value(0)).current;

  const [showTransfer,  setShowTransfer]  = useState(false);
  const [showSuccess,   setShowSuccess]   = useState(false);
  const [showDetails,   setShowDetails]   = useState(false);
  const [claimUrl,      setClaimUrl]      = useState('');
  const [cancelling,    setCancelling]    = useState(false);

  useEffect(() => {
    const runFlash = () => {
      Animated.sequence([
        Animated.timing(flashAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(flashAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]).start(() => setTimeout(runFlash, 2500));
    };
    setTimeout(runFlash, 800);
  }, []);
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.07, duration: 900, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 0.97, duration: 900, useNativeDriver: true }),
    ])).start();
  }, []);
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(glowOpacity, { toValue: 1,    duration: 1500, useNativeDriver: true }),
      Animated.timing(glowOpacity, { toValue: 0.55, duration: 1500, useNativeDriver: true }),
    ])).start();
  }, []);

  function handleTransferSuccess(url: string) {
    setShowTransfer(false); setClaimUrl(url); setShowSuccess(true);
  }

  async function handleCancelTransfer() {
    if (!livePass.transferId || !livePass.orderId) return;
    Alert.alert('Cancel Transfer', 'Are you sure you want to cancel this transfer?', [
      { text: 'No', style: 'cancel' },
      { text: 'Yes, cancel', style: 'destructive', onPress: async () => {
        setCancelling(true);
        try { await fetch(CANCEL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transferId: livePass.transferId, orderId: livePass.orderId }) }); } catch {}
        setCancelling(false); onBack();
      }},
    ]);
  }

  async function handleAddToWallet() {
    if (livePass.passUrl) await Linking.openURL(livePass.passUrl);
    else Alert.alert('Pass Not Ready', 'Your Apple Wallet pass is being generated. Check back in a moment.');
  }

  const canTransfer = livePass.status !== 'scanned' && !livePass.transferred && !livePass.transferPending;
  const isPending   = livePass.transferPending;
  const hasBalance  = (livePass.balanceDue ?? 0) > 0;

  // ── Details bottom sheet content ─────────────────────────────────
  const isTransferReceived = livePass.source === 'transfer' || !!livePass.transferredFromName;
  const purchaseDate = livePass.purchasedAt?.toDate?.()
    ? livePass.purchasedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const transferDate = livePass.transferredAt?.toDate?.()
    ? livePass.transferredAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: passColor }}/>
      <Animated.View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', opacity: flashAnim.interpolate({ inputRange: [0,1], outputRange: [1,0] }) }}/>
      <Animated.View style={{ position: 'absolute', width: SCREEN_WIDTH*1.1, height: SCREEN_WIDTH*1.1, borderRadius: SCREEN_WIDTH*0.55, backgroundColor:'#fff', opacity: glowOpacity.interpolate({inputRange:[0.55,1],outputRange:[0.06,0.18]}), alignSelf:'center', top:SCREEN_HEIGHT*0.22 }}/>

      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:20, paddingTop:8, paddingBottom:16 }}>
          <TouchableOpacity onPress={onBack} style={{ width:40, height:40, borderRadius:20, backgroundColor:'rgba(0,0,0,0.3)', alignItems:'center', justifyContent:'center' }}>
            <BackIcon color="#fff"/>
          </TouchableOpacity>
          <Text style={{ color:'#fff', fontSize:22, fontWeight:'900', letterSpacing:-1 }}>wugi</Text>
          {/* Info icon */}
          <TouchableOpacity onPress={() => setShowDetails(true)} style={{ width:40, height:40, borderRadius:20, backgroundColor:'rgba(0,0,0,0.3)', alignItems:'center', justifyContent:'center' }}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M12 16v-4m0-4h.01M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </TouchableOpacity>
        </View>

        {/* Balance due banner */}
        {hasBalance && (
          <View style={{ marginHorizontal:20, marginBottom:8, backgroundColor:'rgba(230,150,0,0.25)', borderRadius:12, paddingHorizontal:14, paddingVertical:8, borderWidth:1, borderColor:'rgba(230,150,0,0.6)', flexDirection:'row', alignItems:'center', gap:8 }}>
            <Text style={{ fontSize:14 }}>⚠️</Text>
            <Text style={{ color:'#e6961e', fontSize:12, fontWeight:'700' }}>
              ${((livePass.balanceDue ?? 0) / 100).toFixed(2)} balance due at door
              {(livePass.depositPaid ?? 0) > 0 ? ` · $${((livePass.depositPaid ?? 0) / 100).toFixed(2)} paid` : ''}
            </Text>
          </View>
        )}

        {/* Ticket type badge */}
        <View style={{ alignItems:'center', marginBottom:8 }}>
          <View style={{ backgroundColor:'rgba(0,0,0,0.4)', borderRadius:20, paddingHorizontal:20, paddingVertical:8, borderWidth:1.5, borderColor:'rgba(255,255,255,0.5)' }}>
            <Text style={{ color:'#fff', fontSize:13, fontWeight:'900', letterSpacing:4 }}>
              {(livePass.colorLabel || livePass.ticketTypeName || style.abbrev || 'TICKET').toUpperCase()}
            </Text>
          </View>
          {isPending && (
            <View style={{ backgroundColor:'rgba(230,150,0,0.3)', borderRadius:12, paddingHorizontal:14, paddingVertical:4, borderWidth:1, borderColor:'rgba(230,150,0,0.6)', marginTop:8 }}>
              <Text style={{ color:'#e6961e', fontSize:11, fontWeight:'700' }}>⏳ TRANSFER PENDING</Text>
            </View>
          )}
          {livePass.transferred && (
            <View style={{ backgroundColor:'rgba(231,76,60,0.3)', borderRadius:12, paddingHorizontal:14, paddingVertical:4, borderWidth:1, borderColor:'rgba(231,76,60,0.6)', marginTop:8 }}>
              <Text style={{ color:'#e74c3c', fontSize:11, fontWeight:'700' }}>✓ TRANSFERRED</Text>
            </View>
          )}
        </View>

        {/* Event info */}
        <View style={{ alignItems:'center', paddingHorizontal:24, marginBottom:16 }}>
          <Text style={{ color:'#fff', fontSize:24, fontWeight:'900', textAlign:'center', letterSpacing:-0.5, marginBottom:4 }}>{livePass.eventTitle}</Text>
          <Text style={{ color:'rgba(255,255,255,0.8)', fontSize:14 }}>{livePass.venueName}</Text>
          <Text style={{ color:'rgba(255,255,255,0.7)', fontSize:13, marginTop:2 }}>{livePass.date}{livePass.time ? ` · ${livePass.time}` : ''}</Text>
        </View>

        {/* QR */}
        <View style={{ alignItems:'center', flex:1, justifyContent:'center' }}>
          <Animated.View style={{ transform:[{scale: pulseAnim}], shadowColor:'#fff', shadowOpacity:0.5, shadowRadius:30, shadowOffset:{width:0,height:0} }}>
            <View style={{ backgroundColor:'#fff', borderRadius:24, padding:20, shadowColor: passColor, shadowOpacity:0.8, shadowRadius:40, shadowOffset:{width:0,height:0} }}>
              <QRCode
                value={livePass.passId || livePass.orderId || 'wugi-pass'}
                size={200} color="#111111" backgroundColor="#ffffff"
                logo={require('../../assets/wugi-qr-logo.png')}
                logoSize={40} logoBackgroundColor="#ffffff" logoBorderRadius={8}
                logoMargin={4} quietZone={6} enableLinearGradient={false}
              />
            </View>
          </Animated.View>
          <View style={{ flexDirection:'row', alignItems:'center', gap:6, marginTop:16 }}>
            <View style={{ width:6, height:6, borderRadius:3, backgroundColor:'#fff', opacity:0.6 }}/>
            <Text style={{ color:'rgba(255,255,255,0.5)', fontSize:11, letterSpacing:1.5 }}>
              {(livePass.orderId || '').slice(-12).toUpperCase()}
            </Text>
            <View style={{ width:6, height:6, borderRadius:3, backgroundColor:'#fff', opacity:0.6 }}/>
          </View>
        </View>

        {/* Bottom actions */}
        <View style={{ paddingHorizontal:20, paddingBottom:8, gap:10 }}>
          <View style={{ height:1, backgroundColor:'rgba(255,255,255,0.2)', marginBottom:6 }}/>
          <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:12 }}>
            <View>
              <Text style={{ color:'rgba(255,255,255,0.5)', fontSize:10, fontWeight:'700', letterSpacing:1.5 }}>HOLDER</Text>
              <Text style={{ color:'#fff', fontSize:14, fontWeight:'800' }}>{livePass.holderName}</Text>
            </View>
            {livePass.colorLabel && (
              <View style={{ alignItems:'flex-end' }}>
                <Text style={{ color:'rgba(255,255,255,0.5)', fontSize:10, fontWeight:'700', letterSpacing:1.5 }}>ASSIGNMENT</Text>
                <Text style={{ color:'#fff', fontSize:14, fontWeight:'800' }}>{livePass.colorLabel}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity onPress={handleAddToWallet} style={{ backgroundColor:'rgba(0,0,0,0.5)', borderRadius:14, paddingVertical:14, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, borderWidth:1.5, borderColor:'rgba(255,255,255,0.4)' }}>
            <Text style={{ color:'#fff', fontSize:15, fontWeight:'700' }}>Add to Apple Wallet</Text>
          </TouchableOpacity>
          {canTransfer && (
            <TouchableOpacity onPress={() => setShowTransfer(true)} style={{ backgroundColor:'rgba(255,255,255,0.15)', borderRadius:14, paddingVertical:14, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, borderWidth:1.5, borderColor:'rgba(255,255,255,0.4)' }}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Path d="M17 8l4 4m0 0l-4 4m4-4H3M7 16l-4-4m0 0l4-4M3 12h18" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
              </Svg>
              <Text style={{ color:'#fff', fontSize:15, fontWeight:'700' }}>Transfer Ticket</Text>
            </TouchableOpacity>
          )}
          {isPending && (
            <TouchableOpacity onPress={handleCancelTransfer} disabled={cancelling} style={{ paddingVertical:10, alignItems:'center' }}>
              <Text style={{ color:'#e6961e', fontSize:13, fontWeight:'600' }}>{cancelling ? 'Cancelling…' : 'Cancel Pending Transfer'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>

      {/* ── Details bottom sheet ───────────────────────────────────── */}
      <Modal visible={showDetails} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowDetails(false)}>
        <View style={{ flex:1, backgroundColor:'#111' }}>
          <SafeAreaView style={{ flex:1 }}>
            <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:20, paddingTop:16, paddingBottom:20, borderBottomWidth:1, borderBottomColor:'#1e1e1e' }}>
              <Text style={{ color:'#fff', fontSize:17, fontWeight:'700' }}>
                {isTransferReceived ? 'Transfer Details' : 'Purchase Details'}
              </Text>
              <TouchableOpacity onPress={() => setShowDetails(false)}>
                <Text style={{ color:'#aaa', fontSize:16 }}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding:20, gap:2 }}>
              {/* Balance banner */}
              {hasBalance && (
                <View style={{ backgroundColor:'rgba(230,150,0,0.15)', borderRadius:14, padding:16, marginBottom:20, borderWidth:1, borderColor:'rgba(230,150,0,0.4)' }}>
                  <Text style={{ color:'#e6961e', fontSize:13, fontWeight:'800', marginBottom:4 }}>⚠️ Balance Due at Door</Text>
                  <Text style={{ color:'#fff', fontSize:24, fontWeight:'900' }}>${((livePass.balanceDue ?? 0) / 100).toFixed(2)}</Text>
                  {(livePass.depositPaid ?? 0) > 0 && (
                    <Text style={{ color:'#888', fontSize:12, marginTop:4 }}>Deposit paid: ${((livePass.depositPaid ?? 0) / 100).toFixed(2)}</Text>
                  )}
                </View>
              )}

              {/* Event summary */}
              <View style={{ backgroundColor:'#1a1a1a', borderRadius:14, padding:16, marginBottom:16, borderWidth:1, borderColor:'#2a2a2a' }}>
                <View style={{ flexDirection:'row', alignItems:'center', gap:10, marginBottom:4 }}>
                  <View style={{ width:10, height:10, borderRadius:5, backgroundColor: passColor }}/>
                  <Text style={{ color:'#888', fontSize:11, fontWeight:'700', letterSpacing:1 }}>{(livePass.ticketTypeName || 'TICKET').toUpperCase()}</Text>
                </View>
                <Text style={{ color:'#fff', fontSize:18, fontWeight:'800', marginBottom:4 }}>{livePass.eventTitle}</Text>
                <Text style={{ color:'#aaa', fontSize:13 }}>{livePass.venueName}{livePass.date ? ` · ${livePass.date}` : ''}{livePass.time ? ` · ${livePass.time}` : ''}</Text>
              </View>

              {/* Details rows */}
              {[
                { label: 'Pass ID',       value: (livePass.passId || '').slice(-12).toUpperCase() },
                { label: 'Order ID',      value: livePass.orderId ? livePass.orderId.slice(-12).toUpperCase() : null },
                { label: 'Ticket holder', value: livePass.holderName || '—' },
                livePass.colorLabel ? { label: 'Assignment', value: livePass.colorLabel } : null,
                isTransferReceived
                  ? { label: 'Transferred from', value: livePass.transferredFromName || livePass.transferredFromEmail || '—' }
                  : null,
                isTransferReceived && transferDate
                  ? { label: 'Transfer date', value: transferDate }
                  : null,
                !isTransferReceived && purchaseDate
                  ? { label: 'Purchase date', value: purchaseDate }
                  : null,
                !isTransferReceived && (livePass.totalPaid ?? 0) > 0
                  ? { label: 'Amount paid', value: `$${((livePass.totalPaid ?? 0) / 100).toFixed(2)}` }
                  : null,
                !isTransferReceived && livePass.source === 'free'
                  ? { label: 'Amount paid', value: 'Free' }
                  : null,
                !isTransferReceived && livePass.paymentMethodLast4
                  ? { label: 'Payment', value: `Card ending ···· ${livePass.paymentMethodLast4}` }
                  : null,
              ].filter(Boolean).map((row: any, i) => (
                <View key={i} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical:12, borderBottomWidth:1, borderBottomColor:'#1e1e1e' }}>
                  <Text style={{ color:'#666', fontSize:13 }}>{row.label}</Text>
                  <Text style={{ color:'#fff', fontSize:13, fontWeight:'600', maxWidth:'55%', textAlign:'right' }}>{row.value}</Text>
                </View>
              ))}

              <View style={{ marginTop:24, backgroundColor:'#1a1a1a', borderRadius:12, padding:14, borderWidth:1, borderColor:'#2a2a2a' }}>
                <Text style={{ color:'#555', fontSize:11, textAlign:'center', lineHeight:16 }}>
                  All ticket sales are final · No refunds or exchanges{'\n'}
                  Questions? Contact support@wugi.us
                </Text>
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

      <TransferModal visible={showTransfer} pass={livePass} onClose={() => setShowTransfer(false)} onSuccess={handleTransferSuccess}/>
      <TransferSuccessModal visible={showSuccess} claimUrl={claimUrl} onClose={() => { setShowSuccess(false); onBack(); }}/>
    </View>
  );
}

// ── MyPassesScreen ────────────────────────────────────────────────────
type MyPassesProps = {
  onBack: () => void;
  theme:  Theme;
};

export function MyPassesScreen({ onBack, theme }: MyPassesProps) {
  const [selectedPass, setSelectedPass] = useState<PassData | null>(null);
  const [passes,       setPasses]       = useState<PassData[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  // ── Live listener — updates instantly when dashboard changes color ──
  useEffect(() => {
    let unsub: (() => void) | null = null;

    async function subscribe() {
      const { getAuth }      = await import('@react-native-firebase/auth');
      const { getFirestore, collection, query, where, orderBy, onSnapshot } =
        await import('@react-native-firebase/firestore');
      const userId = getAuth().currentUser?.uid;
      if (!userId) { setLoading(false); return; }

      const db = getFirestore();
      unsub = onSnapshot(
        query(
          collection(db, 'passes'),
          where('userId', '==', userId),
          orderBy('createdAt', 'desc')
        ),
        snap => {
          const loaded = snap.docs
            .filter((d: any) => isRenderablePassDoc(d.data()))
            .map(mapPassDoc);
          setPasses(loaded);
          setLoading(false);
          setRefreshing(false);
        },
        err => {
          console.log('MyPassesScreen snapshot error:', err);
          setLoading(false);
          setRefreshing(false);
        }
      );
    }

    subscribe();
    return () => { unsub?.(); };
  }, []);

  // Pull-to-refresh just shows the spinner briefly — snapshot keeps data fresh
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Snapshot is already live; refreshing state clears on next snapshot fire
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  if (selectedPass) {
    return (
      <PassViewerScreen
        pass={selectedPass}
        onBack={() => setSelectedPass(null)}
      />
    );
  }

  if (loading) {
    return (
      <View style={{ flex:1, backgroundColor:theme.bg, alignItems:'center', justifyContent:'center' }}>
        <ActivityIndicator color={theme.accent} size="large"/>
        <Text style={{ color:theme.subtext, fontSize:13, marginTop:12 }}>Loading passes...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex:1, backgroundColor:theme.bg }}>
      <SafeAreaView style={{ borderBottomWidth:1, borderBottomColor:theme.divider, paddingHorizontal:16, paddingBottom:12 }}>
        <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
          <TouchableOpacity onPress={onBack} style={{ width:36, height:36, alignItems:'center', justifyContent:'center' }}>
            <BackIcon color={theme.text}/>
          </TouchableOpacity>
          <Text style={{ color:theme.text, fontSize:18, fontWeight:'800' }}>My Passes</Text>
          <View style={{ width:36 }}/>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding:16, gap:12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]}/>}
      >
        {passes.length === 0 ? (
          <View style={{ alignItems:'center', paddingTop:60 }}>
            <Text style={{ fontSize:48, marginBottom:16 }}>🎟️</Text>
            <Text style={{ color:theme.text, fontSize:17, fontWeight:'700', marginBottom:8 }}>No tickets yet</Text>
            <Text style={{ color:theme.subtext, fontSize:14, textAlign:'center' }}>Tickets you purchase will appear here</Text>
          </View>
        ) : (
          <>
            {/* Group passes by orderId, then split into active vs archived.
                Active groups stay on top, unchanged. Archived groups (event
                date passed OR redeemed/scanned by Door) drop below a divider,
                rendered muted with an EXPIRED / REDEEMED badge. */}
            {(() => {
              const groups   = groupPassesByOrder(passes);
              const active:   PassData[][] = [];
              const archived: { group: PassData[]; badge: 'EXPIRED' | 'REDEEMED' }[] = [];
              groups.forEach(g => {
                const c = classifyPassGroup(g);
                if (c.archived) archived.push({ group: g, badge: c.badge! });
                else active.push(g);
              });

              const renderGroup = (group: PassData[], opts?: { archived: boolean; badge: 'EXPIRED' | 'REDEEMED' }) => {
                const first         = group[0];
                const orderId       = first.orderId || first.passId;
                const isTransferred = first.transferred;
                const isMulti       = group.length > 1;
                const isExpanded    = expandedOrder === orderId;
                return (
                  <PassGroupCard
                    key={orderId}
                    group={group}
                    expanded={isExpanded}
                    showExpansion
                    archived={opts?.archived}
                    archivedBadge={opts?.badge ?? null}
                    onPressCard={() => {
                      if (isTransferred) return;
                      if (isMulti) setExpandedOrder(isExpanded ? null : orderId);
                      else setSelectedPass(first);
                    }}
                    onSelectPass={setSelectedPass}
                  />
                );
              };

              return (
                <>
                  {active.map(g => renderGroup(g))}
                  {archived.length > 0 && (
                    <>
                      <View style={{ marginTop: 12, marginBottom: 2, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 }}>ARCHIVED</Text>
                        <View style={{ flex: 1, height: 1, backgroundColor: theme.divider }}/>
                      </View>
                      {archived.map(a => renderGroup(a.group, { archived: true, badge: a.badge }))}
                    </>
                  )}
                </>
              );
            })()}
          </>
        )}
      </ScrollView>
    </View>
  );
}
