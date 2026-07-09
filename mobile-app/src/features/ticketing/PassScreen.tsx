// ─────────────────────────────────────────────────────────────────────
// Wugi — PassScreen
// Digital pass shown after successful payment - real QR code
// Pixel-matched to Claude Design handoff (consumer-app/PassScreen.jsx)
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  SafeAreaView, ActivityIndicator, Share,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { Theme } from '../../constants/colors';
import { FONTS, MONO } from '../../constants/fonts';
import { ShareIcon } from '../../components/icons';
import Svg, { Path } from 'react-native-svg';

type Pass = {
  id: string;
  ticketNumber: string;
  eventName: string;
  venueName: string;
  eventDate: string;
  eventTime: string;
  ticketTypeName: string;
  holderName: string;
  scanStatus: 'valid' | 'scanned' | 'invalid';
  color?: string;
  balanceDue?: number;
  tableAssignment?: string;
  idVerification?: { verified: boolean; idName?: string };
};

type Props = {
  orderId: string;
  isGuest: boolean;
  guestEmail?: string;
  theme: Theme;
  onClose: () => void;
  onSignUp?: () => void;
  onAddToWallet?: () => void;
};

const RESOLVE_ATTEMPTS = 6;
const RESOLVE_DELAY_MS = 2500;

export function PassScreen({ orderId, isGuest, guestEmail, theme, onClose, onSignUp }: Props) {
  const [passes,     setPasses]    = useState<Pass[]>([]);
  const [loading,    setLoading]   = useState(!isGuest);
  const [activePass, setActivePass] = useState(0);

  useEffect(() => {
    // Guests are unauthenticated — Firestore rules deny reads on passes/orders,
    // so never query. Guests get an email-confirmation state instead (the
    // server emails their pass). Same for free guest tickets.
    if (isGuest) return;

    let cancelled = false;

    const load = async () => {
      try {
        const { getFirestore, collection, getDocs, query, where } =
          await import('@react-native-firebase/firestore');
        const db = getFirestore();

        // Webhook latency: retry resolution up to RESOLVE_ATTEMPTS times.
        // Handles both plain orderIds (free_...) and Stripe PaymentIntent ids
        // (pi_... → orders → passes).
        for (let attempt = 0; attempt < RESOLVE_ATTEMPTS; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, RESOLVE_DELAY_MS));
          if (cancelled) return;

          try {
            // Try direct orderId match first (free tickets use orderId directly)
            let snap = await getDocs(
              query(collection(db, 'passes'), where('orderId', '==', orderId))
            );

            // If no results, orderId may be a Stripe PaymentIntent ID — look up via order
            if (snap.empty && orderId.startsWith('pi_')) {
              const orderSnap = await getDocs(
                query(collection(db, 'orders'), where('stripePaymentIntentId', '==', orderId))
              );
              if (!orderSnap.empty) {
                const realOrderId = orderSnap.docs[0].id;
                snap = await getDocs(
                  query(collection(db, 'passes'), where('orderId', '==', realOrderId))
                );
              }
            }

            if (!snap.empty) {
              if (!cancelled) {
                setPasses(snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as Pass)));
                setLoading(false);
              }
              return;
            }
          } catch (e) {
            console.log('PassScreen resolve attempt failed:', e);
          }
        }
      } catch (e) {
        console.log('PassScreen error:', e);
      }
      // Exhausted retries (or module load failed) — render "still processing"
      // state. Never fabricate a pass.
      if (!cancelled) setLoading(false);
    };
    load();

    return () => { cancelled = true; };
  }, [orderId, isGuest]);

  const handleShare = async () => {
    const pass = passes[activePass];
    if (!pass) return;
    try {
      await Share.share({
        message: `My ticket to ${pass.eventName} at ${pass.venueName}\n${pass.eventDate} · ${pass.eventTime}\nTicket: ${pass.ticketNumber}`,
      });
    } catch (e) {}
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} size="large"/>
        <Text style={{ color: theme.subtext, fontSize: 13, marginTop: 12, fontFamily: FONTS.body }}>
          Loading your pass...
        </Text>
      </View>
    );
  }

  // ── Guest confirmation / authed still-processing states ────────────
  // Guests can never read passes from Firestore (rules require auth), and an
  // authed user's webhook may still be running. Neither case gets a QR or a
  // scan-status badge — no fabricated passes, ever.
  if (isGuest || passes.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        {/* Nav header */}
        <SafeAreaView style={{ borderBottomWidth: 1, borderBottomColor: theme.divider, paddingHorizontal: 16, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8 }}>
            <View style={{ flex: 1 }}/>
            <Text style={{ color: theme.text, fontSize: 16, fontFamily: FONTS.medium }}>
              {isGuest ? 'Order Confirmed' : 'Your Pass'}
            </Text>
            <TouchableOpacity onPress={onClose} style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={{ color: theme.accent, fontSize: 14, fontFamily: FONTS.medium }}>Done</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {/* Success hero */}
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <View style={{
              width: 52, height: 52, borderRadius: 26,
              backgroundColor: theme.accent,
              alignItems: 'center', justifyContent: 'center', marginBottom: 10,
            }}>
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                <Path d="M5 12l5 5L20 7" stroke={theme.onAccent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
              </Svg>
            </View>
            <Text style={{ color: theme.text, fontSize: 18, fontFamily: FONTS.display }}>You're in!</Text>
            <Text style={{ color: theme.subtext, fontSize: 13, marginTop: 4, fontFamily: FONTS.body }}>
              {isGuest ? 'Order confirmed' : 'Payment confirmed'}
            </Text>
          </View>

          {/* Confirmation / processing card */}
          <View style={{
            backgroundColor: theme.card, borderRadius: 20,
            borderWidth: 1, borderColor: theme.border,
            padding: 24, alignItems: 'center', marginBottom: 16,
          }}>
            <Text style={{ fontSize: 36, marginBottom: 12 }}>{isGuest ? '✉️' : '⏳'}</Text>
            <Text style={{ color: theme.text, fontSize: 16, fontFamily: FONTS.bold, textAlign: 'center' }}>
              {isGuest ? 'Your pass is on its way' : 'Finalizing your pass'}
            </Text>
            <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, textAlign: 'center', lineHeight: 19, marginTop: 8 }}>
              {isGuest
                ? `We've emailed your pass and receipt to ${guestEmail ?? 'your email'}. Show the QR from that email at the door.`
                : "Your payment went through. Your pass will appear in My Passes within a minute — we'll also email it to you."}
            </Text>
            {isGuest && (
              <Text style={{ color: theme.subtext, fontSize: 10, fontFamily: MONO, letterSpacing: 1, marginTop: 14 }}>
                Ref: {orderId}
              </Text>
            )}
          </View>

          {/* Guest account creation prompt */}
          {isGuest && onSignUp && (
            <View style={{
              backgroundColor: theme.card,
              borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 16,
              marginBottom: 16,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <Text style={{ fontSize: 22 }}>🎟️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 14, fontFamily: FONTS.bold }}>Save your passes</Text>
                  <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 2, fontFamily: FONTS.body }}>
                    Create an account to access all your tickets in one place
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={onSignUp}
                style={{ backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              >
                <Text style={{ color: theme.onAccent, fontSize: 14, fontFamily: FONTS.medium }}>Create a free account</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={{ paddingVertical: 10, alignItems: 'center' }}>
                <Text style={{ color: theme.subtext, fontSize: 12, fontFamily: FONTS.body }}>
                  No thanks, I'll find it in my email
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Done */}
          <TouchableOpacity
            onPress={onClose}
            style={{
              borderRadius: 12, paddingVertical: 13, alignItems: 'center',
              borderWidth: 1.5, borderColor: theme.border,
            }}
          >
            <Text style={{ color: theme.text, fontSize: 14, fontFamily: FONTS.medium }}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  const pass = passes[activePass];
  if (!pass) return null;

  const passColor   = pass.color || theme.accent;
  const statusColor = pass.scanStatus === 'valid'
    ? passColor
    : pass.scanStatus === 'scanned'
      ? theme.statusWarning
      : theme.statusDanger;
  const statusLabel = pass.scanStatus === 'valid' ? '✓ Valid'
    : pass.scanStatus === 'scanned' ? 'Used' : 'Invalid';
  const hasBalance  = (pass.balanceDue ?? 0) > 0;
  const isVerified  = pass.idVerification?.verified === true;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Nav header */}
      <SafeAreaView style={{ borderBottomWidth: 1, borderBottomColor: theme.divider, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8 }}>
          <View style={{ flex: 1 }}/>
          <Text style={{ color: theme.text, fontSize: 16, fontFamily: FONTS.medium }}>Your Pass</Text>
          <TouchableOpacity onPress={onClose} style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={{ color: theme.accent, fontSize: 14, fontFamily: FONTS.medium }}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>

        {/* ── Success hero ─────────────────────────────────────────── */}
        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          <View style={{
            width: 52, height: 52, borderRadius: 26,
            backgroundColor: theme.accent,
            alignItems: 'center', justifyContent: 'center', marginBottom: 10,
          }}>
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
              <Path d="M5 12l5 5L20 7" stroke={theme.onAccent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </View>
          <Text style={{ color: theme.text, fontSize: 18, fontFamily: FONTS.display }}>You're in!</Text>
          <Text style={{ color: theme.subtext, fontSize: 13, marginTop: 4, fontFamily: FONTS.body }}>
            {passes.length > 1 ? `${passes.length} passes ready` : 'Your pass is ready'}
          </Text>
        </View>

        {/* ── Pass card ────────────────────────────────────────────── */}
        <View style={{
          borderRadius: 20, overflow: 'hidden',
          borderWidth: 1.5, borderColor: passColor,
          marginBottom: 16,
          shadowColor: passColor, shadowOpacity: 0.25, shadowRadius: 12,
          shadowOffset: { width: 0, height: 8 },
        }}>
          {/* Green header — wugi wordmark + event details */}
          <View style={{ backgroundColor: passColor, padding: 18, alignItems: 'center' }}>
            <Text style={{ color: theme.onAccent, fontSize: 22, fontFamily: FONTS.display, letterSpacing: -1 }}>
              wugi
            </Text>
            <Text style={{ color: theme.onAccent, fontSize: 15, fontFamily: FONTS.bold, marginTop: 4 }} numberOfLines={1}>
              {pass.eventName}
            </Text>
            <Text style={{ color: theme.onImageSoft, fontSize: 12, fontFamily: FONTS.body, marginTop: 2 }}>
              {pass.venueName}{pass.eventDate ? ` · ${pass.eventDate}` : ''}{pass.eventTime ? ` · ${pass.eventTime}` : ''}
            </Text>
          </View>

          {/* Balance-due warning */}
          {hasBalance && (
            <View style={{
              backgroundColor: theme.statusWarning + '15',
              padding: 12, alignItems: 'center',
              borderBottomWidth: 1, borderBottomColor: theme.statusWarning,
            }}>
              <Text style={{ color: theme.statusWarning, fontFamily: FONTS.bold, fontSize: 14 }}>
                {'⚠️  $' + ((pass.balanceDue ?? 0) / 100).toFixed(2) + ' balance due at door'}
              </Text>
              <Text style={{ color: theme.subtext, fontFamily: FONTS.body, fontSize: 11, marginTop: 2 }}>
                Please have payment ready upon arrival
              </Text>
            </View>
          )}

          {/* Tear line */}
          <View style={{ height: 1, backgroundColor: theme.divider }}/>

          {/* QR Code — real scannable code, NOT decorative */}
          <View style={{ backgroundColor: theme.card, alignItems: 'center', paddingVertical: 24 }}>
            <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 12 }}>
              <QRCode
                value={pass.id || 'wugi-pass'}
                size={160}
                color="#000"
                backgroundColor="#fff"
                logoSize={30}
              />
            </View>
            <Text style={{
              color: theme.subtext, fontSize: 11, marginTop: 10,
              letterSpacing: 1.5, fontFamily: MONO,
            }}>
              {pass.ticketNumber}
            </Text>
            <View style={{
              marginTop: 8, paddingHorizontal: 12, paddingVertical: 4,
              borderRadius: 20,
              backgroundColor: statusColor + '22',
              borderWidth: 1, borderColor: statusColor,
            }}>
              <Text style={{ color: statusColor, fontSize: 11, fontFamily: FONTS.medium }}>
                {statusLabel}
              </Text>
            </View>
          </View>

          {/* Tear line */}
          <View style={{ height: 1, backgroundColor: theme.divider }}/>

          {/* Details rows */}
          <View style={{ backgroundColor: theme.card }}>
            {[
              { label: 'Name',        value: pass.holderName },
              { label: 'Ticket type', value: pass.ticketTypeName },
              ...(pass.tableAssignment ? [{ label: 'Table', value: pass.tableAssignment }] : []),
            ].map((row, i) => (
              <View key={i} style={{
                flexDirection: 'row', justifyContent: 'space-between',
                paddingHorizontal: 16, paddingVertical: 12,
                borderTopWidth: i > 0 ? 1 : 0, borderTopColor: theme.divider,
              }}>
                <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body }}>{row.label}</Text>
                <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.medium }}>{row.value}</Text>
              </View>
            ))}
            {isVerified && (
              <View style={{
                flexDirection: 'row', justifyContent: 'space-between',
                paddingHorizontal: 16, paddingVertical: 12,
                borderTopWidth: 1, borderTopColor: theme.divider,
              }}>
                <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body }}>ID Verified</Text>
                <Text style={{ color: passColor, fontSize: 13, fontFamily: FONTS.medium }}>✓ Verified at door</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Multi-pass pagination ────────────────────────────────── */}
        {passes.length > 1 && (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
              {passes.map((_, i) => (
                <TouchableOpacity key={i} onPress={() => setActivePass(i)}>
                  <View style={{
                    width: i === activePass ? 20 : 8, height: 8, borderRadius: 4,
                    backgroundColor: i === activePass ? theme.accent : theme.border,
                  }}/>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: theme.subtext, fontSize: 12, textAlign: 'center', marginBottom: 16, fontFamily: FONTS.body }}>
              Pass {activePass + 1} of {passes.length}
            </Text>
          </>
        )}

        {/* ── Actions ──────────────────────────────────────────────── */}
        {/* Share pass */}
        <TouchableOpacity
          onPress={handleShare}
          style={{
            borderRadius: 12, paddingVertical: 13,
            alignItems: 'center', borderWidth: 1.5, borderColor: theme.border,
            flexDirection: 'row', justifyContent: 'center', gap: 8,
          }}
        >
          <ShareIcon color={theme.text}/>
          <Text style={{ color: theme.text, fontSize: 14, fontFamily: FONTS.medium }}>Share pass</Text>
        </TouchableOpacity>

        <Text style={{ color: theme.subtext, fontSize: 10, textAlign: 'center', marginTop: 16, fontFamily: FONTS.body }}>
          Present QR code at the door for entry
        </Text>
      </ScrollView>
    </View>
  );
}
