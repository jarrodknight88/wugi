// ─────────────────────────────────────────────────────────────────────
// Wugi — PaywallSheet
// Photo-unlock paywall (Asana 1216729383901466 / issue #252). Opens from
// PhotoViewer's "Buy" button. Offers, in order: the evergreen free
// HD-unlock credit (if unused), the single-photo StoreKit purchase, and
// the whole-gallery StoreKit purchase — plus Restore Purchases, which
// Apple requires for any IAP-selling app regardless of consumable vs
// non-consumable (see mobile-app/src/lib/iap.ts restorePurchases doc
// comment for what it actually recovers).
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import type { Theme } from '../constants/colors';
import {
  PRODUCT_IDS, fetchUnlockProducts, purchaseSinglePhoto, purchaseGallery, useFreeUnlock,
  restorePurchases, isStoreKitAvailable, CallableFunctionError,
} from '../lib/iap';
import type { StoreProduct } from '../../modules/storekit-iap';
import { getUserProfile } from '../../firestoreService';

type Props = {
  visible: boolean;
  onClose: () => void;
  // Fired once a photo/gallery unlock is durably confirmed (free credit or
  // paid), BEFORE onClose — lets the caller (PhotoViewer) flip its local
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
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [busy, setBusy] = useState<'free' | 'photo' | 'gallery' | 'restore' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setError('');
    setLoadingProducts(true);
    (async () => {
      const [fetchedProducts, profile] = await Promise.all([
        fetchUnlockProducts(),
        getUserProfile(uid),
      ]);
      setProducts(fetchedProducts);
      setFreeUnlockAvailable(!profile?.freeUnlockUsed);
      setLoadingProducts(false);
    })();
  }, [visible, uid]);

  const photoProduct   = products.find(p => p.productId === PRODUCT_IDS.photo);
  const galleryProduct = products.find(p => p.productId === PRODUCT_IDS.gallery);

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

  async function handleBuyPhoto() {
    setBusy('photo');
    setError('');
    try {
      await purchaseSinglePhoto({ uid, photoId, galleryId, photoIndex });
      onUnlocked('photo');
      onClose();
    } catch (e) {
      const msg = friendlyError(e);
      if (msg) setError(msg);
    } finally {
      setBusy(null);
    }
  }

  async function handleBuyGallery() {
    setBusy('gallery');
    setError('');
    try {
      await purchaseGallery({ uid, galleryId });
      onUnlocked('gallery');
      onClose();
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
        recovered > 0 ? `Recovered ${recovered} unlock${recovered === 1 ? '' : 's'}.` : 'No pending purchases were found for this account.'
      );
      if (recovered > 0) { onUnlocked('photo'); onClose(); }
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
                  onPress={handleBuyPhoto}
                  disabled={busy != null || !photoProduct}
                  style={{ backgroundColor: theme.card, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderWidth: 1, borderColor: theme.divider, opacity: busy != null && busy !== 'photo' ? 0.5 : 1 }}
                >
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>Unlock this photo</Text>
                  {busy === 'photo' ? <ActivityIndicator color={theme.text} size="small"/> : (
                    <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '700' }}>{photoProduct?.displayPrice ?? '—'}</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleBuyGallery}
                  disabled={busy != null || !galleryProduct}
                  style={{ backgroundColor: theme.card, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderWidth: 1, borderColor: theme.divider, opacity: busy != null && busy !== 'gallery' ? 0.5 : 1 }}
                >
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>Unlock the full gallery</Text>
                  {busy === 'gallery' ? <ActivityIndicator color={theme.text} size="small"/> : (
                    <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '700' }}>{galleryProduct?.displayPrice ?? '—'}</Text>
                  )}
                </TouchableOpacity>

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
