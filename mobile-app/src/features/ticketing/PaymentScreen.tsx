// ─────────────────────────────────────────────────────────────────────
// Wugi — PaymentScreen
// Real Stripe Payment Sheet + guest checkout support
// ─────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, SafeAreaView,
  ActivityIndicator, Alert, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../../constants/colors';
import type { TicketSelection } from './TicketSelectionScreen';
import { BackIcon } from '../../components/icons';

// Cloud Function URL
const CREATE_PAYMENT_INTENT_URL =
  'https://us-central1-wugi-prod.cloudfunctions.net/createPaymentIntentHttp';

type Props = {
  selection:  TicketSelection;
  userId:     string | null;   // null = guest checkout
  userEmail:  string;
  userName:   string;
  theme:      Theme;
  onBack:     () => void;
  onSuccess:  (orderId: string, isGuest: boolean) => void;
};

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatPhone(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0,3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
}
export function PaymentScreen({
  selection, userId, userEmail, userName,
  theme, onBack, onSuccess,
}: Props) {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [phone,        setPhone]        = useState('');
  const [guestName,    setGuestName]    = useState(userName || '');
  const [guestEmail,   setGuestEmail]   = useState(userEmail || '');
  const [loading,      setLoading]      = useState(false);
  const [feeExpanded,  setFeeExpanded]  = useState(false);
  const isGuest = !userId;

  const handlePay = async () => {
    if (isGuest && (!guestName.trim() || !guestEmail.trim())) {
      Alert.alert('Info required', 'Please enter your name and email to continue.');
      return;
    }
    setLoading(true);
    try {
      // ── Step 1: Create PaymentIntent via Cloud Function ─────────────
      const response = await fetch(CREATE_PAYMENT_INTENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            eventId:      selection.eventId,
            ticketTypeId: selection.ticketType.id,
            quantity:     selection.quantity,
            userId:       userId ?? undefined,
            guestName:    isGuest ? guestName.trim()  : undefined,
            guestEmail:   isGuest ? guestEmail.trim() : undefined,
            guestPhone:   phone.trim() || undefined,
          },
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? 'Failed to create payment intent');
      }

      const json = await response.json();
      const { clientSecret, customerId, customerEphemeralKey } = json.result ?? json;

      // ── Step 2: Init Stripe Payment Sheet ──────────────────────────
      const { error: initError } = await initPaymentSheet({
        merchantDisplayName:        'Wugi',
        paymentIntentClientSecret:  clientSecret,
        customerId:                 customerId ?? undefined,
        customerEphemeralKeySecret: customerEphemeralKey ?? undefined,
        applePay: {
          merchantCountryCode: 'US',
        },
        defaultBillingDetails: {
          name:  isGuest ? guestName : userName,
          email: isGuest ? guestEmail : userEmail,
          phone: phone || undefined,
        },
        allowsDelayedPaymentMethods: false,
        returnURL:        'wugi://payment-complete',
        setupFutureUsage: userId ? 'OnSession' : undefined,
      });

      if (initError) {
        Alert.alert('Error', initError.message);
        setLoading(false);
        return;
      }

      // ── Step 3: Present Payment Sheet ──────────────────────────────
      const { error: payError } = await presentPaymentSheet();
      if (payError) {
        if (payError.code !== 'Canceled') {
          Alert.alert('Payment failed', payError.message);
        }
        setLoading(false);
        return;
      }

      // ── Step 4: Success — webhook will create order + passes ────────
      // Use the paymentIntentId as the order reference for now.
      // The webhook fires async and creates the order doc in Firestore.
      const piId = clientSecret.split('_secret_')[0];
      onSuccess(piId, isGuest);

    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <SafeAreaView style={{ borderBottomWidth: 1, borderBottomColor: theme.divider, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 }}>
          <TouchableOpacity onPress={onBack} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' }}>
            <BackIcon color={theme.text}/>
          </TouchableOpacity>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
            {isGuest ? 'Guest Checkout' : 'Payment'}
          </Text>
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 200 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Guest banner */}
        {isGuest && (
          <View style={{ backgroundColor: theme.accent + '18', borderRadius: 12, borderWidth: 1, borderColor: theme.accent + '44', padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 18 }}>👋</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>Checking out as guest</Text>
              <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 1 }}>Your pass will be sent to your email. Create an account after purchase to save passes.</Text>
            </View>
          </View>
        )}

        {/* Order summary */}
        <View style={{ backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14, marginBottom: 20 }}>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700', marginBottom: 2 }}>{selection.eventName}</Text>
          <Text style={{ color: theme.subtext, fontSize: 12, marginBottom: 10 }}>{selection.venueName} · {selection.eventDate} · {selection.eventTime}</Text>
          <View style={{ height: 1, backgroundColor: theme.divider, marginBottom: 10 }}/>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ color: theme.subtext, fontSize: 13 }}>{selection.quantity} × {selection.ticketType.name}</Text>
            <Text style={{ color: theme.text, fontSize: 13 }}>{centsToDisplay(selection.subtotal)}</Text>
          </View>
          <TouchableOpacity onPress={() => setFeeExpanded(!feeExpanded)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: feeExpanded ? 6 : 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ color: theme.subtext, fontSize: 13 }}>Booking fee & taxes</Text>
              <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
                <Path d={feeExpanded ? 'M2 8l4-4 4 4' : 'M2 4l4 4 4-4'} stroke={theme.subtext} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
              </Svg>
            </View>
            <Text style={{ color: theme.text, fontSize: 13 }}>{centsToDisplay(selection.bookingFee)} + tax</Text>
          </TouchableOpacity>
          {feeExpanded && (
            <View style={{ backgroundColor: (theme as any).surface ?? theme.card, borderRadius: 8, padding: 10, marginBottom: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ color: theme.subtext, fontSize: 11 }}>Booking fee (12%)</Text>
                <Text style={{ color: theme.subtext, fontSize: 11 }}>{centsToDisplay(selection.bookingFee)}</Text>
              </View>
              {selection.ticketType.taxIncluded ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: theme.subtext, fontSize: 11 }}>Tax</Text>
                  <Text style={{ color: theme.subtext, fontSize: 11 }}>Included in price</Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: theme.subtext, fontSize: 11 }}>Tax</Text>
                  <Text style={{ color: theme.subtext, fontSize: 11 }}>Calculated by Stripe Tax</Text>
                </View>
              )}
            </View>
          )}
          <View style={{ height: 1, backgroundColor: theme.divider, marginVertical: 10 }}/>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: '800' }}>Total</Text>
            <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '800' }}>
              {selection.ticketType.isFree ? 'FREE' : `${centsToDisplay(selection.total)} + tax`}
            </Text>
          </View>
        </View>

        {/* Contact info */}
        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 12 }}>Your info</Text>
        <View style={{ backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, marginBottom: 20, overflow: 'hidden' }}>
          {isGuest ? (
            <>
              <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
                <Text style={{ color: theme.subtext, fontSize: 11, marginBottom: 4 }}>Full name *</Text>
                <TextInput value={guestName} onChangeText={setGuestName} placeholder="Your full name" placeholderTextColor={theme.subtext} style={{ color: theme.text, fontSize: 14, padding: 0 }}/>
              </View>
              <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
                <Text style={{ color: theme.subtext, fontSize: 11, marginBottom: 4 }}>Email *</Text>
                <TextInput value={guestEmail} onChangeText={setGuestEmail} placeholder="your@email.com" placeholderTextColor={theme.subtext} keyboardType="email-address" autoCapitalize="none" style={{ color: theme.text, fontSize: 14, padding: 0 }}/>
              </View>
            </>
          ) : (
            <>
              <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
                <Text style={{ color: theme.subtext, fontSize: 11, marginBottom: 3 }}>Full name</Text>
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '500' }}>{userName}</Text>
              </View>
              <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
                <Text style={{ color: theme.subtext, fontSize: 11, marginBottom: 3 }}>Email</Text>
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '500' }}>{userEmail}</Text>
              </View>
            </>
          )}
          <View style={{ padding: 14 }}>
            <Text style={{ color: theme.subtext, fontSize: 11, marginBottom: 4 }}>Phone (optional)</Text>
            <TextInput value={phone} onChangeText={t => setPhone(formatPhone(t))} placeholder="(404) 555-0100" placeholderTextColor={theme.subtext} keyboardType="number-pad" maxLength={14} style={{ color: theme.text, fontSize: 14, padding: 0 }}/>
          </View>
        </View>

        <Text style={{ color: theme.subtext, fontSize: 11, textAlign: 'center', lineHeight: 16 }}>
          All ticket sales are final · No refunds or exchanges{'\n'}
          Secured by Stripe · Card info never stored by Wugi
        </Text>
      </ScrollView>

      {/* Pay CTA */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.divider, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}>
        <TouchableOpacity onPress={handlePay} disabled={loading} style={{ backgroundColor: '#000', borderRadius: 12, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          {loading
            ? <ActivityIndicator color="#fff" size="small"/>
            : <>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="white" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
                </Svg>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                  {selection.ticketType.isFree ? 'Reserve — Free' : `Pay · ${centsToDisplay(selection.total)}`}
                </Text>
              </>
          }
        </TouchableOpacity>
        {!isGuest && (
          <Text style={{ color: theme.subtext, fontSize: 10, textAlign: 'center', marginTop: 8 }}>
            Apple Pay · Saved cards · Face ID available at checkout
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
