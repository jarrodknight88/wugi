// ─────────────────────────────────────────────────────────────────────
// Wugi — PaywallSheet
// Photo-unlock paywall. Opens from PhotoViewer's "Buy" button. Rebuilt for
// the 3-SKU credit economy (Asana 1218248530084817 / issue #282, replaces
// the 2-SKU unlock_single_photo/unlock_gallery IAP): Apple sells CREDIT
// PACKS only, and every price (photo unlock, gallery bundle) is spent
// server-side out of the user's credit-ledger balance. Offers, in order:
// the evergreen free HD-unlock credit (if unused, unrelated one-time
// mechanic), "unlock this photo" / "unlock the full gallery" priced in
// credits, the three credit packs to top up a short balance, and Restore
// Purchases — which Apple requires for any IAP-selling app regardless of
// consumable vs non-consumable (see mobile-app/src/lib/iap.ts
// restorePurchases doc comment for what it actually recovers).
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import type { Theme } from '../constants/colors';
import {
  PRODUCT_IDS, fetchCreditProducts, purchaseCreditPack, useFreeUnlock,
  spendCreditsOnPhoto, spendCreditsOnGallery,
  restorePurchases, isStoreKitAvailable, CallableFunctionError,
  type CreditPack,
} from '../lib/iap';
import type { StoreProduct } from '../../modules/storekit-iap';
import { getUserProfile, getGalleryById } from '../../firestoreService';
import { formatHalfCredits, displayPhotoCreditCostHalfCredits } from '../utils/credits';

type Props = {
  visible: boolean;
  onClose: () => void;
  // Fired once a photo/gallery unlock is durably confirmed (free credit or
  // credit redemption), BEFORE onClose — lets the caller (PhotoViewer) flip
  // its local "unlocked" state so the Buy button updates without a re-fetch.
  onUnlocked: (kind: 'photo' | 'gallery') => void;
  theme: Theme;
  uid: string;
  photoId: string;
  galleryId: string;
  photoIndex: number;
};

type Busy = 'free' | 'photo' | 'gallery' | CreditPack | 'restore' | null;

export function PaywallSheet({ visible, onClose, onUnlocked, theme, uid, photoId, galleryId, photoIndex }: Props) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [freeUnlockAvailable, setFreeUnlockAvailable] = useState(false);
  const [balanceHalfCredits, setBalanceHalfCredits] = useState(0);
  const [photoCostHalfCredits, setPhotoCostHalfCredits] = useState(2);
  const [galleryBundleHalfCredits, setGalleryBundleHalfCredits] = useState<number | null>(null);
  const [isPromo, setIsPromo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState('');

  async function refreshWallet() {
    const profile = await getUserProfile(uid);
    setFreeUnlockAvailable(!profile?.freeUnlockUsed);
    setBalanceHalfCredits(profile?.creditBalanceHalfCredits || 0);
  }

  useEffect(() => {
    if (!visible) return;
    setError('');
    setLoading(true);
    (async () => {
      const [fetchedProducts, gallery] = await Promise.all([
        fetchCreditProducts(),
        getGalleryById(galleryId),
        refreshWallet(),
      ]);
      setProducts(fetchedProducts);
      setIsPromo(!!gallery?.promoFlag);
      setPhotoCostHalfCredits(displayPhotoCreditCostHalfCredits(gallery?.photoCreditCostHalfCredits));
      const bundleCost = Number(gallery?.galleryUnlockCreditsHalfCredits);
      setGalleryBundleHalfCredits(Number.isInteger(bundleCost) && bundleCost > 0 ? bundleCost : null);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, uid, galleryId]);

  const productByPack: Record<CreditPack, StoreProduct | undefined> = {
    credits1: products.find(p => p.productId === PRODUCT_IDS.credits1),
    credits3: products.find(p => p.productId === PRODUCT_IDS.credits3),
    credits5: products.find(p => p.productId === PRODUCT_IDS.credits5),
  };

  function friendlyError(e: unknown): string {
    if (e instanceof CallableFunctionError) {
      if (e.code === 'failed-precondition') return e.message;
      return 'Something went wrong. Please try again.';
    }
    const message = e instanceof Error ? e.message : String(e);
    if (message === 'user_cancelled') return '';
    if (message === 'purchase_pending') return 'Waiting on approval for this purchase — you’ll be notified once it clears.';
    return 'Something went wrong. Please try again.';
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

  async function handleUnlockPhoto() {
    setBusy('photo');
    setError('');
    try {
      await spendCreditsOnPhoto(photoId);
      onUnlocked('photo');
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleUnlockGallery() {
    setBusy('gallery');
    setError('');
    try {
      await spendCreditsOnGallery(galleryId);
      onUnlocked('gallery');
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleBuyCredits(pack: CreditPack) {
    setBusy(pack);
    setError('');
    try {
      await purchaseCreditPack({ uid, pack });
      // Buying credits never unlocks anything by itself — just refresh the
      // balance so the unlock buttons above re-enable, and keep the sheet
      // open so the user can immediately spend what they just bought.
      await refreshWallet();
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
        recovered > 0 ? `Recovered ${recovered} credit purchase${recovered === 1 ? '' : 's'}.` : 'No pending purchases were found for this account.'
      );
      if (recovered > 0) await refreshWallet();
    } catch (e) {
      console.log('PaywallSheet: restore failed', e);
      setError('Restore failed. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const storeKitReady = isStoreKitAvailable();
  const canAffordPhoto = isPromo || balanceHalfCredits >= photoCostHalfCredits;
  const canAffordGallery = galleryBundleHalfCredits != null && balanceHalfCredits >= galleryBundleHalfCredits;

  const packLabel: Record<CreditPack, string> = {
    credits1: 'credits_1',
    credits3: 'credits_3',
    credits5: 'credits_5',
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 }}>
            <TouchableOpacity onPress={onClose} disabled={busy != null}>
              <Text style={{ color: theme.subtext, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Unlock Photo</Text>
            <View style={{ width: 60 }}/>
          </View>

          {!loading && (
            <Text style={{ color: theme.subtext, fontSize: 13, textAlign: 'center', marginBottom: 16 }}>
              Wallet: {formatHalfCredits(balanceHalfCredits)}
            </Text>
          )}

          <View style={{ paddingHorizontal: 20 }}>
            {loading ? (
              <ActivityIndicator color={theme.accent} style={{ marginTop: 40 }}/>
            ) : !storeKitReady ? (
              <Text style={{ color: theme.subtext, fontSize: 14, textAlign: 'center', marginTop: 40 }}>
                In-app purchases aren’t available on this device.
              </Text>
            ) : (
              <>
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
                  onPress={handleUnlockPhoto}
                  disabled={busy != null || !canAffordPhoto}
                  style={{ backgroundColor: theme.card, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderWidth: 1, borderColor: theme.divider, opacity: busy != null && busy !== 'photo' ? 0.5 : (canAffordPhoto ? 1 : 0.5) }}
                >
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>Unlock this photo</Text>
                  {busy === 'photo' ? <ActivityIndicator color={theme.text} size="small"/> : (
                    <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '700' }}>
                      {isPromo ? 'Free' : formatHalfCredits(photoCostHalfCredits)}
                    </Text>
                  )}
                </TouchableOpacity>

                {galleryBundleHalfCredits != null && (
                  <TouchableOpacity
                    onPress={handleUnlockGallery}
                    disabled={busy != null || !canAffordGallery}
                    style={{ backgroundColor: theme.card, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderWidth: 1, borderColor: theme.divider, opacity: busy != null && busy !== 'gallery' ? 0.5 : (canAffordGallery ? 1 : 0.5) }}
                  >
                    <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>Unlock the full gallery</Text>
                    {busy === 'gallery' ? <ActivityIndicator color={theme.text} size="small"/> : (
                      <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '700' }}>{formatHalfCredits(galleryBundleHalfCredits)}</Text>
                    )}
                  </TouchableOpacity>
                )}

                {!!error && <Text style={{ color: '#e74c3c', fontSize: 13, marginTop: 4, marginBottom: 8, textAlign: 'center' }}>{error}</Text>}

                <Text style={{ color: theme.subtext, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 8, marginBottom: 10 }}>
                  Buy credits
                </Text>

                {(['credits1', 'credits3', 'credits5'] as CreditPack[]).map((pack) => {
                  const product = productByPack[pack];
                  return (
                    <TouchableOpacity
                      key={pack}
                      onPress={() => handleBuyCredits(pack)}
                      disabled={busy != null || !product}
                      style={{ backgroundColor: theme.card, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderWidth: 1, borderColor: theme.divider, opacity: busy != null && busy !== pack ? 0.5 : 1 }}
                    >
                      <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>{product?.displayName || packLabel[pack]}</Text>
                      {busy === pack ? <ActivityIndicator color={theme.text} size="small"/> : (
                        <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '700' }}>{product?.displayPrice ?? '—'}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}

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
