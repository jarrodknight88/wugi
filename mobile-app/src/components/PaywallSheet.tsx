// ─────────────────────────────────────────────────────────────────────
// Wugi — PaywallSheet
// Photo-unlock paywall, now on the CREDIT ECONOMY (Asana 1218248530084817
// / issue #282 — replaces the 2-SKU photo IAP, Asana 1216729383901466 /
// issue #252). Opens from PhotoViewer's "Buy" button. Offers, in order:
// the evergreen free HD-unlock credit (if unused), spending existing
// wallet credits on this photo (server resolves + clamps the price — see
// functions/src/creditEconomy/spendCredit.ts), and buying more credits
// via the three StoreKit consumables — plus Restore Purchases, which
// Apple requires for any IAP-selling app regardless of consumable vs
// non-consumable.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import type { Theme } from '../constants/colors';
import {
  PRODUCT_IDS, fetchCreditProducts, purchaseCredits, spendCredit, useFreeUnlock,
  restorePurchases, isStoreKitAvailable, CallableFunctionError, type CreditSku,
} from '../lib/iap';
import type { StoreProduct } from '../../modules/storekit-iap';
import { getUserProfile, getGalleryById } from '../../firestoreService';

const SKU_LABELS: Record<CreditSku, string> = {
  credits_1: '1 credit',
  credits_3: '3 credits',
  credits_5: '5 credits',
};

type Props = {
  visible: boolean;
  onClose: () => void;
  // Fired once a photo unlock is durably confirmed (free credit or
  // credit-redemption), BEFORE onClose — lets the caller (PhotoViewer)
  // flip its local "unlocked" state so the Buy button updates without a
  // re-fetch.
  onUnlocked: (kind: 'photo') => void;
  theme: Theme;
  uid: string;
  photoId: string;
  galleryId: string;
  photoIndex: number;
};

export function PaywallSheet({ visible, onClose, onUnlocked, theme, uid, photoId, galleryId, photoIndex }: Props) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [freeUnlockAvailable, setFreeUnlockAvailable] = useState(false);
  const [balance, setBalance] = useState(0);
  const [photoCost, setPhotoCost] = useState(1);
  const [galleryFree, setGalleryFree] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [busy, setBusy] = useState<'free' | 'spend' | CreditSku | 'restore' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setError('');
    setLoadingProducts(true);
    (async () => {
      const [fetchedProducts, profile, gallery] = await Promise.all([
        fetchCreditProducts(),
        getUserProfile(uid),
        getGalleryById(galleryId),
      ]);
      setProducts(fetchedProducts);
      setFreeUnlockAvailable(!profile?.freeUnlockUsed);
      setBalance(profile?.creditBalance ?? 0);
      setGalleryFree(gallery?.promoFlag === true);
      // Display-only estimate — the server (spendCredit) is the source of
      // truth and clamps this same value independently at spend time.
      setPhotoCost(Math.min(4, Math.max(1, gallery?.photoCreditCost ?? 1)));
      setLoadingProducts(false);
    })();
  }, [visible, uid, galleryId]);

  function friendlyError(e: unknown): string {
    if (e instanceof CallableFunctionError) {
      if (e.code === 'failed-precondition') return e.message;
      return 'Something went wrong validating your purchase. Please try again.';
    }
    const message = e instanceof Error ? e.message : String(e);
    if (message === 'user_cancelled') return '';
    if (message === 'purchase_pending') return 'Waiting on approval for this purchase — you’ll be notified once it clears.';
    return 'Purchase failed. Please try again.';
  }

  async function handleFreeUnlock() {
    setBusy('free');
    setError('');
    try {
      await useFreeUnlock(photoId);
      onUnlocked('photo');
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleSpendCredit() {
    setBusy('spend');
    setError('');
    try {
      const result = await spendCredit(photoId);
      if (typeof result.balance === 'number') setBalance(result.balance);
      onUnlocked('photo');
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleBuyCredits(sku: CreditSku) {
    setBusy(sku);
    setError('');
    try {
      const result = await purchaseCredits({ uid, sku });
      setBalance(result.balance);
    } catch (e) {
      const msg = friendlyError(e);
      if (msg) setError(msg);
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore() {
    setBusy('restore');
    setError('');
    try {
      const recovered = await restorePurchases();
      Alert.alert(
        recovered > 0 ? 'Purchases restored' : 'Nothing to restore',
        recovered > 0 ? `Recovered ${recovered} purchase${recovered === 1 ? '' : 's'}.` : 'No pending purchases were found for this account.'
      );
      if (recovered > 0) {
        const profile = await getUserProfile(uid);
        setBalance(profile?.creditBalance ?? 0);
      }
    } catch (e) {
      console.log('PaywallSheet: restore failed', e);
      setError('Restore failed. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const storeKitReady = isStoreKitAvailable();
  const effectiveCost = galleryFree ? 0 : photoCost;
  const canSpend = effectiveCost === 0 || balance >= effectiveCost;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}>
            <TouchableOpacity onPress={onClose} disabled={busy != null}>
              <Text style={{ color: theme.subtext, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Unlock Photo</Text>
            <View style={{ width: 60 }}/>
          </View>

          <View style={{ paddingHorizontal: 20 }}>
            {loadingProducts ? (
              <ActivityIndicator color={theme.accent} style={{ marginTop: 40 }}/>
            ) : !storeKitReady ? (
              <Text style={{ color: theme.subtext, fontSize: 14, textAlign: 'center', marginTop: 40 }}>
                In-app purchases aren’t available on this device.
              </Text>
            ) : (
              <>
                <Text style={{ color: theme.subtext, fontSize: 13, fontWeight: '600', textAlign: 'center', marginBottom: 16 }}>
                  You have {balance} credit{balance === 1 ? '' : 's'}
                </Text>

                {freeUnlockAvailable && (
                  <TouchableOpacity
                    onPress={handleFreeUnlock}
                    disabled={busy != null}
                    style={{ backgroundColor: theme.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12, opacity: busy != null && busy !== 'free' ? 0.5 : 1 }}
                  >
                    {busy === 'free' ? <ActivityIndicator color="#000" size="small"/> : (
                      <Text style={{ color: '#000', fontSize: 16, fontWeight: '700' }}>Use your free unlock</Text>
                    )}
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  onPress={handleSpendCredit}
                  disabled={busy != null || !canSpend}
                  style={{ backgroundColor: theme.card, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderWidth: 1, borderColor: theme.divider, opacity: busy != null && busy !== 'spend' ? 0.5 : (canSpend ? 1 : 0.5) }}
                >
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>
                    {effectiveCost === 0 ? 'Unlock (gallery is free)' : 'Unlock with credits'}
                  </Text>
                  {busy === 'spend' ? <ActivityIndicator color={theme.text} size="small"/> : (
                    <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '700' }}>
                      {effectiveCost === 0 ? 'Free' : `${effectiveCost} credit${effectiveCost === 1 ? '' : 's'}`}
                    </Text>
                  )}
                </TouchableOpacity>

                {!canSpend && (
                  <Text style={{ color: theme.subtext, fontSize: 12, textAlign: 'center', marginBottom: 16 }}>
                    Not enough credits — buy more below
                  </Text>
                )}

                <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8 }}>
                  BUY CREDITS
                </Text>
                {(Object.keys(PRODUCT_IDS) as CreditSku[]).map((sku) => {
                  const product = products.find(p => p.productId === PRODUCT_IDS[sku]);
                  return (
                    <TouchableOpacity
                      key={sku}
                      onPress={() => handleBuyCredits(sku)}
                      disabled={busy != null || !product}
                      style={{ backgroundColor: theme.card, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderWidth: 1, borderColor: theme.divider, opacity: busy != null && busy !== sku ? 0.5 : 1 }}
                    >
                      <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>{SKU_LABELS[sku]}</Text>
                      {busy === sku ? <ActivityIndicator color={theme.text} size="small"/> : (
                        <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '700' }}>{product?.displayPrice ?? '—'}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}

                {!!error && <Text style={{ color: '#e74c3c', fontSize: 13, marginTop: 4, marginBottom: 8, textAlign: 'center' }}>{error}</Text>}

                <TouchableOpacity onPress={handleRestore} disabled={busy != null} style={{ paddingVertical: 14, alignItems: 'center' }}>
                  {busy === 'restore' ? <ActivityIndicator color={theme.subtext} size="small"/> : (
                    <Text style={{ color: theme.subtext, fontSize: 13, fontWeight: '600' }}>Restore Purchases</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
