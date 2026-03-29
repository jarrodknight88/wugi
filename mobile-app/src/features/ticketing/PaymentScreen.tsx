// ─────────────────────────────────────────────────────────────────────
// Wugi — PaymentScreen
// Stripe Payment Sheet with Apple Pay, saved cards, Face ID
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  SafeAreaView, ActivityIndicator, Alert, TextInput,
} from 'react-native';
import type { Theme } from '../../constants/colors';
import type { TicketSelection } from './TicketSelectionScreen';
import { BackIcon } from '../../components/icons';
import Svg, { Path } from 'react-native-svg';

type Props = {
  selection: TicketSelection;
  userId: string;
  userEmail: string;
  userName: string;
  theme: Theme;
  onBack: () => void;
  onSuccess: (orderId: string) => void;
};

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function PaymentScreen({
  selection, userId, userEmail, userName,
  theme, onBack, onSuccess,
}: Props) {
  const [phone,     setPhone]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [feeExpanded, setFeeExpanded] = useState(false);

  const handlePay = async () => {
    if (!phone.trim()) {
      Alert.alert('Phone required', 'We need your phone number to deliver your pass.');
      return;
    }

    setLoading(true);

    try {
      // ── Step 1: Create payment intent on backend ────────────────────
      // In production this calls a Cloud Function to create a
      // Stripe PaymentIntent and returns the client secret.
      // The PaymentIntent metadata contains the cart items for
      // the webhook to process.
      //
      // For now we create the payment intent directly via Stripe API
      // (move to Cloud Function before production for security).

      const { initStripe, useStripe } = await import('@stripe/stripe-react-native');

      // ── Step 2: Present Stripe Payment Sheet ────────────────────────
      // This handles Apple Pay, saved cards, and Face ID natively.
      // The payment sheet is configured server-side.

      Alert.alert(
        'Payment Sheet',
        'Stripe Payment Sheet integration requires a backend endpoint to create PaymentIntents. ' +
        'Set up the Cloud Function endpoint and add your Stripe publishable key to complete this step.\n\n' +
        `Order summary:\n${selection.quantity}× ${selection.ticketType.name}\n` +
        `Total: ${centsToDisplay(selection.total)} + tax`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Simulate Success (Dev)',
            onPress: () => {
              // Simulate successful payment for UI development
              onSuccess('dev_order_' + Date.now());
            },
          },
        ]
      );
    } catch (e: any) {
      Alert.alert('Payment failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header */}
      <SafeAreaView style={{ borderBottomWidth: 1, borderBottomColor: theme.divider, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 }}>
          <TouchableOpacity onPress={onBack} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' }}>
            <BackIcon color={theme.text}/>
          </TouchableOpacity>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>Payment</Text>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 160 }}>

        {/* Order summary card */}
        <View style={{ backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14, marginBottom: 20 }}>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700', marginBottom: 2 }}>{selection.eventName}</Text>
          <Text style={{ color: theme.subtext, fontSize: 12, marginBottom: 10 }}>{selection.venueName} · {selection.eventDate} · {selection.eventTime}</Text>

          <View style={{ height: 1, backgroundColor: theme.divider, marginBottom: 10 }}/>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ color: theme.subtext, fontSize: 13 }}>{selection.quantity} × {selection.ticketType.name}</Text>
            <Text style={{ color: theme.text, fontSize: 13 }}>{centsToDisplay(selection.subtotal)}</Text>
          </View>

          {/* Fee dropdown */}
          <TouchableOpacity
            onPress={() => setFeeExpanded(!feeExpanded)}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: feeExpanded ? 6 : 0 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ color: theme.subtext, fontSize: 13 }}>Booking fee & taxes</Text>
              <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
                <Path d={feeExpanded ? 'M2 8l4-4 4 4' : 'M2 4l4 4 4-4'} stroke={theme.subtext} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
              </Svg>
            </View>
            <Text style={{ color: theme.text, fontSize: 13 }}>{centsToDisplay(selection.bookingFee)} + tax</Text>
          </TouchableOpacity>

          {feeExpanded && (
            <View style={{ backgroundColor: theme.surface, borderRadius: 8, padding: 10, marginBottom: 6 }}>
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
                <>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text style={{ color: theme.subtext, fontSize: 11 }}>Georgia state tax (4%)</Text>
                    <Text style={{ color: theme.subtext, fontSize: 11 }}>Calculated at payment</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: theme.subtext, fontSize: 11 }}>Atlanta city tax (4%)</Text>
                    <Text style={{ color: theme.subtext, fontSize: 11 }}>Calculated at payment</Text>
                  </View>
                </>
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
          {/* Name — pre-filled */}
          <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
            <Text style={{ color: theme.subtext, fontSize: 11, marginBottom: 3 }}>Full name</Text>
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '500' }}>{userName}</Text>
          </View>
          {/* Email — pre-filled */}
          <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
            <Text style={{ color: theme.subtext, fontSize: 11, marginBottom: 3 }}>Email</Text>
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '500' }}>{userEmail}</Text>
          </View>
          {/* Phone — required */}
          <View style={{ padding: 14 }}>
            <Text style={{ color: theme.subtext, fontSize: 11, marginBottom: 3 }}>Phone (for pass delivery)</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="+1 (404) 555-0100"
              placeholderTextColor={theme.subtext}
              keyboardType="phone-pad"
              style={{ color: theme.text, fontSize: 14, fontWeight: '500', padding: 0 }}
            />
          </View>
        </View>

        {/* No refund notice */}
        <Text style={{ color: theme.subtext, fontSize: 11, textAlign: 'center', lineHeight: 16 }}>
          All ticket sales are final. No refunds or exchanges.{'\n'}
          Secured by Stripe · Your card info is never stored by Wugi.
        </Text>
      </ScrollView>

      {/* Pay CTA */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.divider, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}>
        <TouchableOpacity
          onPress={handlePay}
          disabled={loading}
          style={{ backgroundColor: '#000', borderRadius: 12, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small"/>
          ) : (
            <>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" fill="white"/>
              </Svg>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                {selection.ticketType.isFree
                  ? 'Reserve for Free'
                  : `Pay with Apple Pay · ${centsToDisplay(selection.total)}`
                }
              </Text>
            </>
          )}
        </TouchableOpacity>

        {!selection.ticketType.isFree && (
          <TouchableOpacity
            onPress={handlePay}
            disabled={loading}
            style={{ borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 10, borderWidth: 1.5, borderColor: theme.border }}
          >
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>Pay with card</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
