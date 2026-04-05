// ─────────────────────────────────────────────────────────────────────
// Wugi — PassScreens (updated)
// - PassViewerScreen: Transfer modal + Apple Wallet button
// - MyPassesScreen: Load from orders collection, show transfer status
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, Image, TouchableOpacity, ScrollView, Modal,
  SafeAreaView, Animated, StyleSheet, Share, Dimensions,
  ActivityIndicator, TextInput, Alert, Linking, KeyboardAvoidingView, Platform,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../../constants/colors';
import type { PassData } from '../../types';
import { TICKET_TYPES } from '../../constants/ticketTypes';
import { BackIcon } from '../../components/icons';

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
  const ticketType       = TICKET_TYPES[pass.ticketType] || TICKET_TYPES['general_admission'];
  const passColor        = pass.passColor || ticketType.color;
  const pulseAnim        = useRef(new Animated.Value(1)).current;
  const glowOpacity      = useRef(new Animated.Value(0.7)).current;
  const flashAnim        = useRef(new Animated.Value(0)).current;
  const [showTransfer,   setShowTransfer]   = useState(false);
  const [showSuccess,    setShowSuccess]    = useState(false);
  const [claimUrl,       setClaimUrl]       = useState('');
  const [cancelling,     setCancelling]     = useState(false);

  // Full screen flash
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
    setShowTransfer(false);
    setClaimUrl(url);
    setShowSuccess(true);
  }

  async function handleCancelTransfer() {
    if (!pass.transferId || !pass.orderId) return;
    Alert.alert('Cancel Transfer', 'Are you sure you want to cancel this transfer?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, cancel', style: 'destructive', onPress: async () => {
          setCancelling(true);
          try {
            await fetch(CANCEL_URL, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ transferId: pass.transferId, orderId: pass.orderId }),
            });
          } catch (e) {}
          setCancelling(false);
          onBack(); // refresh list
        }
      }
    ]);
  }

  async function handleAddToWallet() {
    if (pass.passUrl) {
      await Linking.openURL(pass.passUrl);
    } else {
      Alert.alert('Pass Not Ready', 'Your Apple Wallet pass is being generated. Check back in a moment.');
    }
  }

  const canTransfer = pass.status !== 'scanned' && !pass.transferred && !pass.transferPending;
  const isPending   = pass.transferPending;

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
          <View style={{ width:40 }}/>
        </View>

        {/* Ticket type */}
        <View style={{ alignItems:'center', marginBottom:8 }}>
          <View style={{ backgroundColor:'rgba(0,0,0,0.4)', borderRadius:20, paddingHorizontal:20, paddingVertical:8, borderWidth:1.5, borderColor:'rgba(255,255,255,0.5)' }}>
            <Text style={{ color:'#fff', fontSize:13, fontWeight:'900', letterSpacing:4 }}>
              {(pass.colorLabel || pass.ticketTypeName || ticketType.label || 'TICKET').toUpperCase()}
            </Text>
          </View>
          {isPending && (
            <View style={{ backgroundColor:'rgba(230,150,0,0.3)', borderRadius:12, paddingHorizontal:14, paddingVertical:4, borderWidth:1, borderColor:'rgba(230,150,0,0.6)', marginTop:8 }}>
              <Text style={{ color:'#e6961e', fontSize:11, fontWeight:'700' }}>⏳ TRANSFER PENDING</Text>
            </View>
          )}
          {pass.transferred && (
            <View style={{ backgroundColor:'rgba(231,76,60,0.3)', borderRadius:12, paddingHorizontal:14, paddingVertical:4, borderWidth:1, borderColor:'rgba(231,76,60,0.6)', marginTop:8 }}>
              <Text style={{ color:'#e74c3c', fontSize:11, fontWeight:'700' }}>✓ TRANSFERRED</Text>
            </View>
          )}
        </View>

        {/* Event info */}
        <View style={{ alignItems:'center', paddingHorizontal:24, marginBottom:16 }}>
          <Text style={{ color:'#fff', fontSize:24, fontWeight:'900', textAlign:'center', letterSpacing:-0.5, marginBottom:4 }}>{pass.eventTitle}</Text>
          <Text style={{ color:'rgba(255,255,255,0.8)', fontSize:14 }}>{pass.venueName}</Text>
          <Text style={{ color:'rgba(255,255,255,0.7)', fontSize:13, marginTop:2 }}>{pass.date}{pass.time ? ` · ${pass.time}` : ''}</Text>
        </View>

        {/* QR */}
        <View style={{ alignItems:'center', flex:1, justifyContent:'center' }}>
          <Animated.View style={{ transform:[{scale: pulseAnim}], shadowColor:'#fff', shadowOpacity:0.5, shadowRadius:30, shadowOffset:{width:0,height:0} }}>
            <View style={{ backgroundColor:'#fff', borderRadius:24, padding:20, shadowColor: passColor, shadowOpacity:0.8, shadowRadius:40, shadowOffset:{width:0,height:0} }}>
              <QRCode
                value={pass.orderId || 'wugi-pass'}
                size={200}
                color="#111111"
                backgroundColor="#ffffff"
                logo={require('../../assets/wugi-qr-logo.png')}
                logoSize={40}
                logoBackgroundColor="#ffffff"
                logoBorderRadius={8}
                logoMargin={4}
                quietZone={6}
                enableLinearGradient={false}
              />
            </View>
          </Animated.View>
          <View style={{ flexDirection:'row', alignItems:'center', gap:6, marginTop:16 }}>
            <View style={{ width:6, height:6, borderRadius:3, backgroundColor:'#fff', opacity:0.6 }}/>
            <Text style={{ color:'rgba(255,255,255,0.5)', fontSize:11, letterSpacing:1.5 }}>
              {(pass.orderId || '').slice(-12).toUpperCase()}
            </Text>
            <View style={{ width:6, height:6, borderRadius:3, backgroundColor:'#fff', opacity:0.6 }}/>
          </View>
        </View>

        {/* Bottom actions */}
        <View style={{ paddingHorizontal:20, paddingBottom:8, gap:10 }}>
          <View style={{ height:1, backgroundColor:'rgba(255,255,255,0.2)', marginBottom:6 }}/>

          {/* Holder + table info */}
          <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:12 }}>
            <View>
              <Text style={{ color:'rgba(255,255,255,0.5)', fontSize:10, fontWeight:'700', letterSpacing:1.5 }}>HOLDER</Text>
              <Text style={{ color:'#fff', fontSize:14, fontWeight:'800' }}>{pass.holderName}</Text>
            </View>
            {pass.colorLabel && (
              <View style={{ alignItems:'flex-end' }}>
                <Text style={{ color:'rgba(255,255,255,0.5)', fontSize:10, fontWeight:'700', letterSpacing:1.5 }}>ASSIGNMENT</Text>
                <Text style={{ color:'#fff', fontSize:14, fontWeight:'800' }}>{pass.colorLabel}</Text>
              </View>
            )}
          </View>

          {/* Apple Wallet */}
          <TouchableOpacity onPress={handleAddToWallet} style={{ backgroundColor:'rgba(0,0,0,0.5)', borderRadius:14, paddingVertical:14, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, borderWidth:1.5, borderColor:'rgba(255,255,255,0.4)' }}>
            <Text style={{ color:'#fff', fontSize:15, fontWeight:'700' }}>Add to Apple Wallet</Text>
          </TouchableOpacity>

          {/* Transfer */}
          {canTransfer && (
            <TouchableOpacity onPress={() => setShowTransfer(true)} style={{ backgroundColor:'rgba(255,255,255,0.15)', borderRadius:14, paddingVertical:14, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, borderWidth:1.5, borderColor:'rgba(255,255,255,0.4)' }}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Path d="M17 8l4 4m0 0l-4 4m4-4H3M7 16l-4-4m0 0l4-4M3 12h18" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
              </Svg>
              <Text style={{ color:'#fff', fontSize:15, fontWeight:'700' }}>Transfer Ticket</Text>
            </TouchableOpacity>
          )}

          {/* Cancel pending transfer */}
          {isPending && (
            <TouchableOpacity onPress={handleCancelTransfer} disabled={cancelling} style={{ paddingVertical:10, alignItems:'center' }}>
              <Text style={{ color:'#e6961e', fontSize:13, fontWeight:'600' }}>{cancelling ? 'Cancelling…' : 'Cancel Pending Transfer'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>

      <TransferModal visible={showTransfer} pass={pass} onClose={() => setShowTransfer(false)} onSuccess={handleTransferSuccess}/>
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

  const loadPasses = useCallback(async () => {
    try {
      const { getAuth }      = await import('@react-native-firebase/auth');
      const { getFirestore, collection, getDocs, query, where, orderBy } =
        await import('@react-native-firebase/firestore');
      const userId = getAuth().currentUser?.uid;
      if (!userId) { setLoading(false); return; }

      const db   = getFirestore();
      const snap = await getDocs(
        query(
          collection(db, 'orders'),
          where('userId', '==', userId),
          orderBy('createdAt', 'desc')
        )
      );

      const loaded: PassData[] = snap.docs
        .filter(d => !d.data().transferred) // hide tickets already transferred away
        .map(d => {
          const data = d.data();
          const ticketTypeLower = (data.ticketType || '').toLowerCase();
          const typeKey = ticketTypeLower.includes('vip') ? 'vip' : 'general';
          return {
            orderId:         d.id,
            passId:          d.id,
            passNumber:      1,
            totalPasses:     data.quantity || 1,
            ticketType:      typeKey,
            ticketTypeName:  data.ticketType || 'General Admission',
            eventTitle:      data.eventTitle || 'Event',
            venueName:       data.venueName  || '',
            date:            data.eventDate  || '',
            time:            data.eventTime  || '',
            holderName:      data.buyerName  || '',
            status:          data.checkedIn ? 'scanned' : 'valid',
            qrValue:         d.id,
            passUrl:         data.passUrl    || null,
            passColor:       data.passColor  || null,
            colorLabel:      data.colorLabel || null,
            tableNumber:     data.tableNumber || null,
            transferPending: data.transferPending || false,
            transferred:     data.transferred || false,
            transferId:      data.transferId || null,
          } as PassData;
        });

      setPasses(loaded);
    } catch (e) {
      console.log('MyPassesScreen load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPasses(); }, [loadPasses]);

  if (selectedPass) {
    return (
      <PassViewerScreen
        pass={selectedPass}
        onBack={() => { setSelectedPass(null); loadPasses(); }}
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

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding:16, gap:12 }}>
        {passes.length === 0 ? (
          <View style={{ alignItems:'center', paddingTop:60 }}>
            <Text style={{ fontSize:48, marginBottom:16 }}>🎟️</Text>
            <Text style={{ color:theme.text, fontSize:17, fontWeight:'700', marginBottom:8 }}>No tickets yet</Text>
            <Text style={{ color:theme.subtext, fontSize:14, textAlign:'center' }}>Tickets you purchase will appear here</Text>
          </View>
        ) : (
          <>
            <Text style={{ color:theme.subtext, fontSize:13, marginBottom:4 }}>{passes.length} ticket{passes.length !== 1 ? 's' : ''}</Text>
            {passes.map(pass => {
              const typeData = TICKET_TYPES[pass.ticketType] || TICKET_TYPES['general'];
              const cardColor = pass.passColor || typeData.color;
              const isPending = pass.transferPending;

              return (
                <TouchableOpacity
                  key={pass.passId}
                  onPress={() => setSelectedPass(pass)}
                  activeOpacity={0.88}
                  style={{ borderRadius:16, overflow:'hidden', backgroundColor:cardColor, shadowColor:cardColor, shadowOpacity:0.4, shadowRadius:12, shadowOffset:{width:0,height:4} }}
                >
                  <View style={{ padding:16, paddingBottom:12 }}>
                    <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                      <View style={{ flexDirection:'row', gap:6, alignItems:'center' }}>
                        <Text style={{ color:'rgba(255,255,255,0.8)', fontSize:10, fontWeight:'800', letterSpacing:2 }}>
                          {(pass.colorLabel || pass.ticketTypeName || typeData.label).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ backgroundColor: isPending ? 'rgba(230,150,0,0.3)' : pass.status === 'scanned' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.25)', borderRadius:8, paddingHorizontal:8, paddingVertical:3 }}>
                        <Text style={{ color: isPending ? '#e6961e' : '#fff', fontSize:10, fontWeight:'700' }}>
                          {isPending ? 'PENDING' : pass.status === 'scanned' ? 'USED' : 'VALID'}
                        </Text>
                      </View>
                    </View>
                    <Text style={{ color:'#fff', fontSize:20, fontWeight:'900', marginBottom:4 }}>{pass.eventTitle}</Text>
                    <Text style={{ color:'rgba(255,255,255,0.75)', fontSize:13 }}>{pass.venueName}{pass.date ? ` · ${pass.date}` : ''}</Text>
                  </View>
                  <View style={{ backgroundColor:'rgba(255,255,255,0.12)', height:1 }}/>
                  <View style={{ backgroundColor:'rgba(0,0,0,0.2)', paddingHorizontal:16, paddingVertical:12, flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
                    <Text style={{ color:'rgba(255,255,255,0.7)', fontSize:12, fontWeight:'600' }}>{pass.holderName}</Text>
                    <Text style={{ color:'rgba(255,255,255,0.8)', fontSize:12, fontWeight:'600' }}>Tap to view →</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}
