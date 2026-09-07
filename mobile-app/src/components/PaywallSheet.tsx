// ─────────────────────────────────────────────────────────────────────
// Wugi — PaywallSheet
// Photo-unlock paywall (issue #282 — credit economy, superseding the
// fixed-price unlock_single_photo/unlock_gallery SKUs from Asana
// 1216729383901466 / issue #252). Opens from PhotoViewer's "Buy" button.
// Offers, in order: the evergreen free HD-unlock credit (if unused,
// independent of the credit wallet — see functions/src/unlocks/
// spendFreeUnlock.ts), spending from the credit wallet (if the balance
// covers this photo's price), and buying a credit pack (StoreKit) when it
// doesn't — plus Restore Purchases, which Apple requires for any
// IAP-selling app regardless of consumable vs non-consumable (see
// mobile-app/src/lib/iap.ts restorePurchases doc comment for what it
// actually recovers).
//
// PRICING is display-only here — read straight off the gallery doc
// (photoCreditCostHalfCredits / galleryUnlockCreditsHalfCredits), with a
// client-side fallback to the same default the server falls back to
// (functions/src/unlocks/creditEconomy.ts DEFAULT_CONFIG) when the
// gallery has no override. The server (spendCredits) ALWAYS recomputes
// the real charge itself — this is only so the UI doesn't have to wait on
// a round trip to show a price.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import type { Theme } from '../constants/colors';
import {
  PRODUCT_IDS, fetchCreditPackProducts, purchaseCreditPack, useFreeUnlock,
  spendCreditsOnPhoto, spendCreditsOnGallery,
  restorePurchases, isStoreKitAvailable, CallableFunctionError,
} from '../lib/iap';
import type { StoreProduct } from '../../modules/storekit-iap';
import { getUserProfile, getGalleryById } from '../../firestoreService';
import { creditsLabel } from '../utils/credits';

// Mirrors creditEconomy.ts DEFAULT_CONFIG.defaultPhotoCreditCostHalfCredits
// — display-only fallback, see module doc comment above.
const DEFAULT_PHOTO_COST_HALF_CREDITS = 2; // 1 credit

type Props = {
  visible: boolean;
  onClose: () => void;
  // Fired once a photo/gallery unlock is durably confirmed (free credit,
  // spent from the wallet, or a fresh purchase that immediately covered
  // it), BEFORE onClose — lets the caller (PhotoViewer) flip its local
  // "unlocked" state so the Buy button updates without a re-fetch.
  onUnlocked: (kind: 'photo' | 'gallery') => void;
  theme: Theme;
  uid: string;
  photoId: string;
  galleryId: string;
  photoIndex: number;
};

export function PaywallSheet({ visible, onClose, onUnlocked, theme, uid, photoId, galleryId, photoIndex }: Props) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [freeUnlockAvailable, setFreeUnlockAvailable] = useState(false);
  const [balanceHalfCredits, setBalanceHalfCredits] = useState(0);
  const [photoCostHalfCredits, setPhotoCostHalfCredits] = useState(DEFAULT_PHOTO_COST_HALF_CREDITS);
  const [galleryBundleHalfCredits, setGalleryBundleHalfCredits] = useState<number | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [busy, setBusy] = useState<'free' | 'spend-photo' | 'spend-gallery' | 'credits1' | 'credits3' | 'credits5' | 'restore' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setError('');
    setLoadingProducts(true);
    (async () => {
      const [fetchedProducts, profile, gallery] = await Promise.all([
        fetchCreditPackProducts(),
        getUserProfile(uid),
        getGalleryById(galleryId),
      ]);
      setProducts(fetchedProducts);
      setFreeUnlockAvailable(!profile?.freeUnlockUsed);
      setBalanceHalfCredits(profile?.creditBalanceHalfCredits ?? 0);
      const isFree = gallery?.free === true || gallery?.promoFlag === true;
      setPhotoCostHalfCredits(isFree ? 0 : (gallery?.photoCreditCostHalfCredits ?? DEFAULT_PHOTO_COST_HALF_CREDITS));
      setGalleryBundleHalfCredits(isFree ? 0 : (gallery?.galleryUnlockCreditsHalfCredits ?? null));
      setLoadingProducts(false);
    })();
  }, [visible, uid, galleryId]);

  const pack1 = products.find(p => p.productId === PRODUCT_IDS.credits1);
  const pack3 = products.find(p => p.productId === PRODUCT_IDS.credits3);
  const pack5 = products.find(p => p.productId === PRODUCT_IDS.credits5);

  const canSpendOnPhoto = balanceHalfCredits >= photoCostHalfCredits;
  const canSpendOnGallery = galleryBundleHalfCredits != null && balanceHalfCredits >= galleryBundleHalfCredits;

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

  async function handleSpendOnPhoto() {
    setBusy('spend-photo');
    setError('');
    try {
      const result = await spendCreditsOnPhoto(photoId);
      setBalanceHalfCredits(result.balanceAfterHalfCredits);
      onUnlocked('photo');
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleSpendOnGallery() {
    setBusy('spend-gallery');
    setError('');
    try {
      const result = await spendCreditsOnGallery(galleryId);
      setBalanceHalfCredits(result.balanceAfterHalfCredits);
      onUnlocked('gallery');
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleBuyPack(key: 'credits1' | 'credits3' | 'credits5', productId: string) {
    setBusy(key);
    setError('');
    try {
      const result = await purchaseCreditPack({ uid, productId: productId as typeof PRODUCT_IDS[keyof typeof PRODUCT_IDS] });
      setBalanceHalfCredits(result.balanceAfterHalfCredits);
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
        setBalanceHalfCredits(profile?.creditBalanceHalfCredits ?? 0);
      }
    } catch (e) {
      console.log('PaywallSheet: restore failed', e);
      setError('Restore failed. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const storeKitReady = isStoreKitAvailable();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}>
            <TouchableOpacity onPress={onClose} disabled={busy != null}>
              <Text style={{ color: theme.subtext, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Unlock Photo</Text>
            <Text style={{ color: theme.subtext, fontSize: 12, fontWeight: '600', width: 60, textAlign: 'right' }}>
              {loadingProducts ? '' : creditsLabel(balanceHalfCredits)}
            </Text>
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
                  onPress={handleSpendOnPhoto}
                  disabled={busy != null || !canSpendOnPhoto}
                  style={{ backgroundColor: canSpendOnPhoto ? theme.card : theme.card, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderWidth: 1, borderColor: theme.divider, opacity: busy != null && busy !== 'spend-photo' ? 0.5 : (canSpendOnPhoto ? 1 : 0.4) }}
                >
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>Unlock this photo</Text>
                  {busy === 'spend-photo' ? <ActivityIndicator color={theme.text} size="small"/> : (
                    <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '700' }}>{creditsLabel(photoCostHalfCredits)}</Text>
                  )}
                </TouchableOpacity>

                {galleryBundleHalfCredits != null && (
                  <TouchableOpacity
                    onPress={handleSpendOnGallery}
                    disabled={busy != null || !canSpendOnGallery}
                    style={{ backgroundColor: theme.card, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderWidth: 1, borderColor: theme.divider, opacity: busy != null && busy !== 'spend-gallery' ? 0.5 : (canSpendOnGallery ? 1 : 0.4) }}
                  >
                    <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>Unlock the full gallery</Text>
                    {busy === 'spend-gallery' ? <ActivityIndicator color={theme.text} size="small"/> : (
                      <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '700' }}>{creditsLabel(galleryBundleHalfCredits)}</Text>
                    )}
                  </TouchableOpacity>
                )}

                {!!error && <Text style={{ color: '#e74c3c', fontSize: 13, marginTop: 4, marginBottom: 8, textAlign: 'center' }}>{error}</Text>}

                <Text style={{ color: theme.subtext, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginTop: 8, marginBottom: 10 }}>
                  {balanceHalfCredits > 0 ? 'NOT ENOUGH CREDITS? BUY MORE' : 'BUY CREDITS'}
                </Text>

                {([
                  ['credits1', pack1] as const,
                  ['credits3', pack3] as const,
                  ['credits5', pack5] as const,
                ]).map(([key, product]) => product && (
                  <TouchableOpacity
                    key={key}
                    onPress={() => handleBuyPack(key, product.productId)}
                    disabled={busy != null}
                    style={{ backgroundColor: theme.card, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, borderWidth: 1, borderColor: theme.divider, opacity: busy != null && busy !== key ? 0.5 : 1 }}
                  >
                    <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>{product.displayName || product.productId}</Text>
                    {busy === key ? <ActivityIndicator color={theme.text} size="small"/> : (
                      <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '700' }}>{product.displayPrice}</Text>
                    )}
                  </TouchableOpacity>
                ))}

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
