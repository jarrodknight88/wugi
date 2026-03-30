// ─────────────────────────────────────────────────────────────────────
// Wugi — PassViewerScreen
// Color-coded full-screen pass viewer with pulse/flash animation
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, Image, TouchableOpacity, ScrollView,
  SafeAreaView, Animated, StyleSheet, Share, Dimensions, ActivityIndicator,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../../constants/colors';
import type { PassData } from '../../types';
import { TICKET_TYPES } from '../../constants/ticketTypes';
import { MOCK_PASSES } from '../../constants/mockData';
import { BackIcon } from '../../components/icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── PassViewerScreen ──────────────────────────────────────────────────
type PassViewerProps = {
  pass: PassData;
  onBack: () => void;
  onTransfer?: (passId: string) => void;
};

export function PassViewerScreen({ pass, onBack, onTransfer }: PassViewerProps) {
  const ticketType  = TICKET_TYPES[pass.ticketType];
  const pulseAnim   = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.7)).current;
  const flashAnim   = useRef(new Animated.Value(0)).current;
  const qrRotateAnim = useRef(new Animated.Value(0)).current;
  const [shared, setShared] = useState(false);

  // Full screen flash every 2.5 seconds
  useEffect(() => {
    const runFlash = () => {
      Animated.sequence([
        Animated.timing(flashAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(flashAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]).start(() => setTimeout(runFlash, 2500));
    };
    setTimeout(runFlash, 800);
  }, []);

  // QR card pulse
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.07, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.97, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // Background glow breathe
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowOpacity, { toValue: 1,    duration: 1500, useNativeDriver: true }),
        Animated.timing(glowOpacity, { toValue: 0.55, duration: 1500, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // Silent QR rotation every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(qrRotateAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.timing(qrRotateAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const spin = qrRotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '15deg'] });

  const handleShare = async () => {
    try {
      const transferLink = `https://wugi.app/pass/${pass.passId}`;
      const result = await Share.share({
        message: `I'm sending you a pass to ${pass.eventTitle} at ${pass.venueName} on ${pass.date}. Tap to claim: ${transferLink}`,
        url: transferLink,
      });
      if (result.action !== 'dismissedAction') setShared(true);
    } catch (e) {
      console.log('Share error:', e);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Base ticket color */}
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: ticketType.color }}/>

      {/* Flash overlay */}
      <Animated.View style={{
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
        opacity: flashAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      }}/>

      {/* Outer glow ring */}
      <Animated.View style={{
        position: 'absolute',
        width: SCREEN_WIDTH * 1.1, height: SCREEN_WIDTH * 1.1,
        borderRadius: SCREEN_WIDTH * 0.55,
        backgroundColor: '#fff',
        opacity: glowOpacity.interpolate({ inputRange: [0.55, 1], outputRange: [0.06, 0.18] }),
        alignSelf: 'center', top: SCREEN_HEIGHT * 0.22,
      }}/>

      {/* Inner glow ring */}
      <Animated.View style={{
        position: 'absolute',
        width: SCREEN_WIDTH * 0.7, height: SCREEN_WIDTH * 0.7,
        borderRadius: SCREEN_WIDTH * 0.35,
        backgroundColor: ticketType.color,
        opacity: glowOpacity.interpolate({ inputRange: [0.55, 1], outputRange: [0.2, 0.5] }),
        alignSelf: 'center', top: SCREEN_HEIGHT * 0.31,
        shadowColor: '#fff', shadowOpacity: 0.6, shadowRadius: 40, shadowOffset: { width: 0, height: 0 },
      }}/>

      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}>
          <TouchableOpacity onPress={onBack} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' }}>
            <BackIcon color="#fff"/>
          </TouchableOpacity>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: -1 }}>wugi</Text>
          <View style={{ width: 40 }}/>
        </View>

        {/* Ticket type badge */}
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)' }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 4 }}>
              {ticketType.label.toUpperCase()}
            </Text>
          </View>
          {pass.totalPasses && pass.totalPasses > 1 && (
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 6, fontWeight: '600' }}>
              Pass {pass.passNumber} of {pass.totalPasses}
            </Text>
          )}
        </View>

        {/* Event info */}
        <View style={{ alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 }}>
          <Text style={{ color: '#fff', fontSize: 26, fontWeight: '900', textAlign: 'center', letterSpacing: -0.5, marginBottom: 4 }}>
            {pass.eventTitle}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, marginBottom: 2 }}>{pass.venueName}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>{pass.date} · {pass.time}</Text>
        </View>

        {/* QR Code */}
        <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }], shadowColor: '#fff', shadowOpacity: 0.5, shadowRadius: 30, shadowOffset: { width: 0, height: 0 } }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 22, shadowColor: ticketType.color, shadowOpacity: 1, shadowRadius: 40, shadowOffset: { width: 0, height: 0 } }}>
              <Animated.View style={{ transform: [{ rotate: spin }] }}>
                <View style={{ width: 190, height: 190, position: 'relative' }}>
                  {([[0,0],[0,140],[140,0]] as [number,number][]).map(([top,left],i) => (
                    <View key={i} style={{ position: 'absolute', top, left, width: 50, height: 50, borderWidth: 7, borderColor: '#000', borderRadius: 8 }}>
                      <View style={{ position: 'absolute', top: 9, left: 9, right: 9, bottom: 9, backgroundColor: '#000', borderRadius: 3 }}/>
                    </View>
                  ))}
                  <View style={{ position: 'absolute', top: 65, left: 65, width: 60, height: 60, backgroundColor: '#000', borderRadius: 6, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 32, height: 32, backgroundColor: '#fff', borderRadius: 4, alignItems: 'center', justifyContent: 'center' }}>
                      <View style={{ width: 16, height: 16, backgroundColor: '#000', borderRadius: 2 }}/>
                    </View>
                  </View>
                  {[
                    [0,1,1,0,1,0],[1,0,1,1,0,1],[0,1,0,1,1,0],
                    [1,1,0,0,1,1],[0,0,1,1,0,1],[1,0,1,0,1,0],
                  ].map((row, ri) => row.map((cell, ci) => cell ? (
                    <View key={`${ri}-${ci}`} style={{ position: 'absolute', top: 58 + ri * 14, left: 63 + ci * 14, width: 8, height: 8, backgroundColor: '#000', borderRadius: 1.5 }}/>
                  ) : null))}
                </View>
              </Animated.View>
              <View style={{ height: 8, backgroundColor: ticketType.color, borderRadius: 4, marginTop: 14 }}/>
            </View>
          </Animated.View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 }}>
            <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#fff', opacity: 0.7 }}/>
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, letterSpacing: 1 }}>SECURE PASS</Text>
            <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#fff', opacity: 0.7 }}/>
          </View>
        </View>

        {/* Bottom info + actions */}
        <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
          <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 16 }}/>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 }}>TICKET HOLDER</Text>
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 }}>ORDER ID</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{pass.holderName}</Text>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{pass.orderId}</Text>
          </View>

          <View style={{ gap: 10 }}>
            <TouchableOpacity style={{ backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 14, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)' }}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
              </Svg>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Add to Apple Wallet</Text>
            </TouchableOpacity>

            {pass.transferable && pass.status === 'pending' && (
              <TouchableOpacity onPress={handleShare} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 14, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)' }}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
                </Svg>
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{shared ? 'Link Sent ✓' : 'Share Pass'}</Text>
              </TouchableOpacity>
            )}

            {pass.status === 'scanned' && (
              <View style={{ backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 14, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M20 6L9 17l-5-5" stroke="#00C853" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
                </Svg>
                <Text style={{ color: '#00C853', fontSize: 15, fontWeight: '700' }}>Pass Scanned ✓</Text>
              </View>
            )}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

// ── MyPassesScreen ────────────────────────────────────────────────────
type MyPassesProps = {
  onBack: () => void;
  theme: Theme;
};

export function MyPassesScreen({ onBack, theme }: MyPassesProps) {
  const [selectedPass, setSelectedPass] = useState<PassData | null>(null);
  const [passes,       setPasses]       = useState<PassData[]>([]);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const { getAuth }                                    = await import('@react-native-firebase/auth');
        const { getFirestore, collection, getDocs, query, where, orderBy } = await import('@react-native-firebase/firestore');
        const userId = getAuth().currentUser?.uid;
        if (!userId) { setLoading(false); return; }

        const db   = getFirestore();
        const snap = await getDocs(
          query(collection(db, 'passes'), where('userId', '==', userId))
        );

        const loaded: PassData[] = snap.docs.map(d => {
          const data = d.data();
          return {
            passId:       d.id,
            passNumber:   1,
            totalPasses:  1,
            ticketType:   data.ticketTypeName?.toLowerCase().includes('vip') ? 'vip' : 'general',
            eventTitle:   data.eventName   ?? 'Event',
            venueName:    data.venueName   ?? '',
            date:         data.eventDate   ?? '',
            time:         data.eventTime   ?? '',
            holderName:   data.holderName  ?? '',
            ticketNumber: data.ticketNumber ?? d.id.slice(-8).toUpperCase(),
            status:       data.scanStatus === 'scanned' ? 'scanned' : 'valid',
            qrValue:      d.id,
          } as PassData;
        });

        setPasses(loaded);
      } catch (e) {
        console.log('MyPassesScreen load error:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (selectedPass) {
    return (
      <PassViewerScreen
        pass={selectedPass}
        onBack={() => setSelectedPass(null)}
        onTransfer={passId => console.log('Transfer pass:', passId)}
      />
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} size="large"/>
        <Text style={{ color: theme.subtext, fontSize: 13, marginTop: 12 }}>Loading passes...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ borderBottomWidth: 1, borderBottomColor: theme.divider, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity onPress={onBack} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <BackIcon color={theme.text}/>
          </TouchableOpacity>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>My Passes</Text>
          <View style={{ width: 36 }}/>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 12 }}>
        {passes.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>🎟️</Text>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 8 }}>No tickets yet</Text>
            <Text style={{ color: theme.subtext, fontSize: 14, textAlign: 'center' }}>
              Tickets you purchase will appear here
            </Text>
          </View>
        ) : (
          <>
            <Text style={{ color: theme.subtext, fontSize: 13, marginBottom: 4 }}>{passes.length} pass{passes.length !== 1 ? 'es' : ''}</Text>
        {passes.map(pass => {
          const ticketType = TICKET_TYPES[pass.ticketType];
          return (
            <TouchableOpacity
              key={pass.passId}
              onPress={() => setSelectedPass(pass)}
              activeOpacity={0.88}
              style={{ borderRadius: 16, overflow: 'hidden', backgroundColor: ticketType.color, shadowColor: ticketType.color, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}
            >
              <View style={{ padding: 16, paddingBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10, fontWeight: '800', letterSpacing: 2 }}>{ticketType.label.toUpperCase()}</Text>
                  <View style={{ backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                      {pass.status === 'scanned' ? 'USED' : pass.status === 'pending' ? 'PENDING' : 'VALID'}
                    </Text>
                  </View>
                </View>
                <Text style={{ color: '#fff', fontSize: 20, fontWeight: '900', marginBottom: 4 }}>{pass.eventTitle}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>{pass.venueName} · {pass.date}</Text>
              </View>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.12)', height: 1 }}/>
              <View style={{ backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 32, height: 32, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 6, alignItems: 'center', justifyContent: 'center' }}>
                    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                      <Path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h-3zM18 15h3v3h-3zM15 18h3v3h-3zM18 18h3v3h-3z" stroke="#fff" strokeWidth={1.5}/>
                    </Svg>
                  </View>
                  <View>
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>HOLDER</Text>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{pass.holderName}</Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>
                    {pass.totalPasses && pass.totalPasses > 1 ? `Pass ${pass.passNumber} of ${pass.totalPasses}` : 'Single Pass'}
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600' }}>Tap to view →</Text>
                </View>
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
