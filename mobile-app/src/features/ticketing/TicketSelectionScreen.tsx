// ─────────────────────────────────────────────────────────────────────
// Wugi — TicketSelectionScreen
// Ticket type picker, quantity selector, fee + tax breakdown dropdown
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  SafeAreaView, ActivityIndicator, Animated,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../../constants/colors';
import { BackIcon } from '../../components/icons';

// ── Types ─────────────────────────────────────────────────────────────
export type TicketType = {
  id: string;
  name: string;
  description: string;
  price: number;           // in cents
  isFree: boolean;
  taxIncluded: boolean;
  capacity: number;
  remaining: number;
  status: 'on_sale' | 'sold_out' | 'cancelled';
  maxPerOrder: number;
  bookingFeePercent: number | null;
  bookingFeeMin: number | null;
  bookingFeeMax: number | null;
};

type Props = {
  eventId: string;
  eventName: string;
  venueName: string;
  eventDate: string;
  eventTime: string;
  theme: Theme;
  onBack: () => void;
  onContinue: (selection: TicketSelection) => void;
};

export type TicketSelection = {
  eventId: string;
  eventName: string;
  venueName: string;
  eventDate: string;
  eventTime: string;
  ticketType: TicketType;
  quantity: number;
  subtotal: number;
  bookingFee: number;
  total: number;
};

// ── Fee calculations (all in cents) ──────────────────────────────────
const PLATFORM_FEE_PERCENT = 0.12;
const PLATFORM_FEE_MIN     = 199;   // $1.99
const PLATFORM_FEE_MAX     = 10000; // $100.00

function calcBookingFee(subtotal: number, tt: TicketType): number {
  if (tt.isFree) return 0;
  const pct = tt.bookingFeePercent ?? PLATFORM_FEE_PERCENT;
  const min = tt.bookingFeeMin     ?? PLATFORM_FEE_MIN;
  const max = tt.bookingFeeMax     ?? PLATFORM_FEE_MAX;
  return Math.min(max, Math.max(min, Math.round(subtotal * pct)));
}

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ── Component ─────────────────────────────────────────────────────────
export function TicketSelectionScreen({
  eventId, eventName, venueName, eventDate, eventTime,
  theme, onBack, onContinue,
}: Props) {
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState<TicketType | null>(null);
  const [quantity,    setQuantity]    = useState(1);
  const [feeExpanded, setFeeExpanded] = useState(false);
  const feeAnim = useState(new Animated.Value(0))[0];

  // ── Load ticket types ───────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const { getFirestore, collection, getDocs, query, where } =
          await import('@react-native-firebase/firestore');
        const db = getFirestore();
        const snap = await getDocs(
          query(
            collection(db, 'events', eventId, 'ticketTypes'),
            where('status', '==', 'on_sale'),
            where('approvalStatus', '==', 'approved'),
          )
        );
        const types = snap.docs.map(d => ({ id: d.id, ...d.data() } as TicketType));
        setTicketTypes(types);
        if (types.length > 0) setSelected(types[0]);
      } catch (e) {
        console.log('TicketSelectionScreen: load error', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [eventId]);

  // ── Calculations ────────────────────────────────────────────────────
  const subtotal   = selected ? selected.price * quantity : 0;
  const bookingFee = selected ? calcBookingFee(subtotal, selected) : 0;
  const total      = subtotal + bookingFee; // tax calculated by Stripe at payment

  // ── Fee dropdown animation ──────────────────────────────────────────
  const toggleFee = () => {
    const toValue = feeExpanded ? 0 : 1;
    Animated.timing(feeAnim, { toValue, duration: 200, useNativeDriver: false }).start();
    setFeeExpanded(!feeExpanded);
  };

  const feeHeight = feeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, selected?.taxIncluded ? 72 : 96],
  });

  const handleContinue = () => {
    if (!selected) return;
    onContinue({
      eventId, eventName, venueName, eventDate, eventTime,
      ticketType: selected, quantity, subtotal, bookingFee, total,
    });
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} size="large"/>
      </View>
    );
  }

  if (ticketTypes.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <SafeAreaView style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <TouchableOpacity onPress={onBack} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' }}>
            <BackIcon color={theme.text}/>
          </TouchableOpacity>
        </SafeAreaView>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ fontSize: 32, marginBottom: 16 }}>🎟️</Text>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>No tickets available</Text>
          <Text style={{ color: theme.subtext, fontSize: 14, textAlign: 'center' }}>Ticket sales for this event have ended or haven't started yet.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header */}
      <SafeAreaView style={{ borderBottomWidth: 1, borderBottomColor: theme.divider, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 }}>
          <TouchableOpacity onPress={onBack} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' }}>
            <BackIcon color={theme.text}/>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{eventName}</Text>
            <Text style={{ color: theme.subtext, fontSize: 12 }}>{venueName} · {eventDate} · {eventTime}</Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 160 }}>

        {/* Ticket type selection */}
        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 12 }}>Select ticket type</Text>

        {ticketTypes.map(tt => {
          const isSelected  = selected?.id === tt.id;
          const isSoldOut   = tt.remaining <= 0;
          return (
            <TouchableOpacity
              key={tt.id}
              onPress={() => { if (!isSoldOut) { setSelected(tt); setQuantity(1); } }}
              disabled={isSoldOut}
              style={{
                borderRadius: 12,
                borderWidth: 1.5,
                borderColor: isSelected ? theme.accent : theme.border,
                backgroundColor: isSelected ? theme.accent + '12' : theme.card,
                padding: 14,
                marginBottom: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                opacity: isSoldOut ? 0.5 : 1,
              }}
            >
              {/* Radio */}
              <View style={{
                width: 20, height: 20, borderRadius: 10,
                borderWidth: 2,
                borderColor: isSelected ? theme.accent : theme.border,
                backgroundColor: isSelected ? theme.accent : 'transparent',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {isSelected && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' }}/>}
              </View>

              {/* Info */}
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>{tt.name}</Text>
                <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 2 }}>{tt.description}</Text>
                {tt.remaining <= 10 && tt.remaining > 0 && (
                  <Text style={{ color: '#e74c3c', fontSize: 11, marginTop: 3, fontWeight: '600' }}>Only {tt.remaining} left</Text>
                )}
                {isSoldOut && (
                  <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 3, fontWeight: '600' }}>Sold out</Text>
                )}
              </View>

              {/* Price */}
              <Text style={{ color: tt.isFree ? theme.text : theme.accent, fontSize: 16, fontWeight: '800' }}>
                {tt.isFree ? 'FREE' : centsToDisplay(tt.price)}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Quantity */}
        {selected && !selected.isFree && (
          <>
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700', marginTop: 20, marginBottom: 12 }}>Quantity</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 12, gap: 16 }}>
              <TouchableOpacity
                onPress={() => setQuantity(q => Math.max(1, q - 1))}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: quantity <= 1 ? theme.divider : theme.accent, alignItems: 'center', justifyContent: 'center' }}
                disabled={quantity <= 1}
              >
                <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 24 }}>−</Text>
              </TouchableOpacity>
              <Text style={{ color: theme.text, fontSize: 22, fontWeight: '800', flex: 1, textAlign: 'center' }}>{quantity}</Text>
              <TouchableOpacity
                onPress={() => setQuantity(q => Math.min(selected.maxPerOrder, selected.remaining, q + 1))}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: quantity >= Math.min(selected.maxPerOrder, selected.remaining) ? theme.divider : theme.accent, alignItems: 'center', justifyContent: 'center' }}
                disabled={quantity >= Math.min(selected.maxPerOrder, selected.remaining)}
              >
                <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 24 }}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 6, textAlign: 'center' }}>
              Max {selected.maxPerOrder} per order · {selected.remaining} remaining
            </Text>
          </>
        )}

        {/* Order summary */}
        {selected && (
          <View style={{ marginTop: 24, backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' }}>
            {/* Subtotal */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 14 }}>
              <Text style={{ color: theme.subtext, fontSize: 14 }}>
                {selected.isFree ? `${quantity} × ${selected.name}` : `${quantity} × ${selected.name}`}
              </Text>
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                {selected.isFree ? 'FREE' : centsToDisplay(subtotal)}
              </Text>
            </View>

            {/* Fee + tax row with dropdown */}
            {!selected.isFree && (
              <>
                <View style={{ height: 1, backgroundColor: theme.divider }}/>
                <TouchableOpacity
                  onPress={toggleFee}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: theme.subtext, fontSize: 14 }}>Booking fee & taxes</Text>
                    <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
                      <Path
                        d={feeExpanded ? 'M3 9l4-4 4 4' : 'M3 5l4 4 4-4'}
                        stroke={theme.subtext}
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  </View>
                  <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                    {centsToDisplay(bookingFee)} + tax
                  </Text>
                </TouchableOpacity>

                {/* Expanded breakdown */}
                <Animated.View style={{ height: feeHeight, overflow: 'hidden' }}>
                  <View style={{ backgroundColor: theme.surface, paddingHorizontal: 14, paddingBottom: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                      <Text style={{ color: theme.subtext, fontSize: 12 }}>Booking fee (12%)</Text>
                      <Text style={{ color: theme.subtext, fontSize: 12 }}>{centsToDisplay(bookingFee)}</Text>
                    </View>
                    {selected.taxIncluded ? (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                        <Text style={{ color: theme.subtext, fontSize: 12 }}>Tax</Text>
                        <Text style={{ color: theme.subtext, fontSize: 12 }}>Included in price</Text>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                        <Text style={{ color: theme.subtext, fontSize: 12 }}>Tax</Text>
                        <Text style={{ color: theme.subtext, fontSize: 12 }}>Calculated at checkout</Text>
                      </View>
                    )}
                  </View>
                </Animated.View>
              </>
            )}

            {/* Total */}
            <View style={{ height: 1, backgroundColor: theme.divider }}/>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 14 }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>Total</Text>
              <Text style={{ color: theme.accent, fontSize: 16, fontWeight: '800' }}>
                {selected.isFree ? 'FREE' : `${centsToDisplay(total)} + tax`}
              </Text>
            </View>
          </View>
        )}

        {/* No refund notice */}
        <Text style={{ color: theme.subtext, fontSize: 11, textAlign: 'center', marginTop: 16, lineHeight: 16 }}>
          All ticket sales are final. No refunds or exchanges.
        </Text>
      </ScrollView>

      {/* Sticky CTA */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.divider, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}>
        <TouchableOpacity
          onPress={handleContinue}
          disabled={!selected || (selected.remaining <= 0 && !selected.isFree)}
          style={{
            backgroundColor: theme.accent,
            borderRadius: 12,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: !selected ? 0.5 : 1,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
            {selected?.isFree
              ? `Reserve ${quantity} Spot${quantity > 1 ? 's' : ''} — Free`
              : `Continue · ${centsToDisplay(total)} + tax`
            }
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
