// ─────────────────────────────────────────────────────────────────────
// Wugi — CreditBalanceBadge
// Small persistent "wallet" chip (Asana 1218248530084817 / issue #282,
// Part 2: "small wallet presence — retention hook"). Subscribes live to
// users/{uid}.creditBalance so a purchase or redemption elsewhere in the
// app reflects here without a manual refresh. Renders nothing until the
// first snapshot arrives (no flash of "0 credits" for a signed-out user).
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import type { Theme } from '../constants/colors';
import { subscribeToCreditBalance } from '../../firestoreService';

type Props = { uid: string | null | undefined; theme: Theme };

export function CreditBalanceBadge({ uid, theme }: Props) {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!uid) { setBalance(null); return; }
    return subscribeToCreditBalance(uid, setBalance);
  }, [uid]);

  if (balance === null) return null;

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: theme.card, borderRadius: 999,
      borderWidth: 1, borderColor: theme.divider,
      paddingHorizontal: 10, paddingVertical: 5,
    }}>
      <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '800' }}>{balance}</Text>
      <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: '600', marginLeft: 4 }}>
        {balance === 1 ? 'credit' : 'credits'}
      </Text>
    </View>
  );
}
