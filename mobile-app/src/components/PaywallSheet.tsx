// ─────────────────────────────────────────────────────────────────────
// Wugi — PaywallSheet
// Credit-economy paywall (Asana 1218248530084817 / issue #282 — replaces
// the original 2-SKU photo-unlock paywall this component shipped for
// under issue #252). Opens from PhotoViewer's "Buy" button. Shows the
// user's wallet balance, an "Unlock this photo" / "Unlock the full
// gallery" action priced in credits (server-clamped per-gallery pricing,
// see functions/src/credits/spendCredits.ts), and the three credit-pack
// StoreKit purchases to top up the balance — plus Restore Purchases,
// which Apple requires for any IAP-selling app regardless of consumable
// vs non-consumable.
//
// DELTA 3 (Jarrod/PM 9/12): the evergreen "Use your free unlock" row is
// retired from this surface — credits are the only giveaway mechanism
// now (see the signup grant in functions/src/users/onUserCreated.ts).
// `spendFreeUnlock` stays deployed untouched; it's just no longer offered
// here.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, SafeAreaView, ActivityIndicator } from 'react-native';
import type { Theme } from '../constants/colors';
import {
  CREDIT_PACK_IDS, fetchCreditPackProducts, purchaseCreditPack, spendCreditsOnPhoto, spendCreditsOnGallery,
  restorePurchases, isStoreKitAvailable, CallableFunctionError,
} from '../lib/iap';
import type { CreditPackId } from '../lib/iap';
import type { StoreProduct } from '../../modules/storekit-iap';
import { getUserProfile, getGalleryById } from '../../firestoreService';
import { formatCredits } from '../utils/credits';

type Props = {
  visible: boolean;
  onClose: () => void;
  // Fired once a photo/gallery unlock is durably confirmed, BEFORE
  // onClose — lets the caller (PhotoViewer) flip its local "unlocked"
  // state so the Buy button updates without a re-fetch.
  onUnlocked: (kind: 'photo' | 'gallery') => void;
  theme: Theme;
  uid: string;
  photoId: string;
  galleryId: string;
  photoIndex: number;
};

const DEFAULT_PHOTO_COST_HALF_UNITS = 2; // 1 credit — mirrors config/creditEconomy's launch default

export function PaywallSheet({ visible, onClose, onUnlocked, theme, uid, photoId, galleryId }: Props) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [balanceHalfUnits, setBalanceHalfUnits] = useState(0);
  const [photoCostHalfUnits, setPhotoCostHalfUnits] = useState(DEFAULT_PHOTO_COST_HALF_UNITS);
  const [bundleCostHalfUnits, setBundleCostHalfUnits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function refresh() {
    const [fetchedProducts, profile, gallery] = await Promise.all([
      fetchCreditPackProducts(),
      getUserProfile(uid),
      getGalleryById(galleryId),
    ]);
    setProducts(fetchedProducts);
    setBalanceHalfUnits(profile?.creditBalanceHalfUnits ?? 0);
    setPhotoCostHalfUnits(gallery?.photoCreditCostHalfUnits ?? DEFAULT_PHOTO_COST_HALF_UNITS);
    setBundleCostHalfUnits(typeof gallery?.galleryUnlockCreditsHalfUnits === 'number' ? gallery.galleryUnlockCreditsHalfUnits : null);
  }

  useEffect(() => {
    if (!visible) return;
    setError('');
    setLoading(true);
    refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, uid, galleryId]);

  function friendlyError(e: unknown): string {
    if (e instanceof CallableFunctionError) {
      if (e.message === 'insufficient_credits') return "You don't have enough credits for this yet — buy a pack below.";
      if (e.code === 'failed-precondition') return e.message;
      return 'Something went wrong. Please try again.';
    }
    const message = e instanceof Error ? e.message : String(e);
    if (message === 'user_cancelled') return '';
    if (message === 'purchase_pending') return 'Waiting on approval for this purchase — you’ll be notified once it clears.';
    return 'Purchase failed. Please try again.';
  }

  async function handleUnlockPhoto() {
    setBusy('unlock-photo');
    setError('');
    try {
      await spendCreditsOnPhoto({ photoId });
      onUnlocked('photo');
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleUnlockGallery() {
    setBusy('unlock-gallery');
    setError('');
    try {
      await spendCreditsOnGallery({ galleryId });
      onUnlocked('gallery');
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleBuyPack(packId: CreditPackId) {
    setBusy(packId);
    setError('');
    try {
      await purchaseCreditPack({ uid, packId });
      await refresh();
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
      if (recovered > 0) await refresh();
      setError(recovered > 0 ? '' : 'No pending purchases were found for this account.');
    } catch (e) {
      console.log('PaywallSheet: restore failed', e);
      setError('Restore failed. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const storeKitReady = isStoreKitAvailable();
  const canAffordPhoto = balanceHalfUnits >= photoCostHalfUnits;
  const canAffordBundle = bundleCostHalfUnits != null && balanceHalfUnits >= bundleCostHalfUnits;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
            <TouchableOpacity onPress={onClose} disabled={busy != null}>
              <Text style={{ color: theme.subtext, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Unlock Photo</Text>
            <View style={{ width: 60 }}/>
          </View>

          {!loading && (
            <Text style={{ color: theme.subtext, fontSize: 13, textAlign: 'center', marginBottom: 16 }}>
              Your balance: {formatCredits(balanceHalfUnits)}
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
                <TouchableOpacity
                  onPress={handleUnlockPhoto}
                  disabled={busy != null || !canAffordPhoto}
                  style={{ backgroundColor: theme.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12, opacity: busy != null && busy !== 'unlock-photo' ? 0.5 : canAffordPhoto ? 1 : 0.4 }}
                >
                  {busy === 'unlock-photo' ? <ActivityIndicator color="#000" size="small"/> : (
                    <Text style={{ color: '#000', fontSize: 16, fontWeight: '700' }}>Unlock this photo — {formatCredits(photoCostHalfUnits)}</Text>
                  )}
                </TouchableOpacity>

                {bundleCostHalfUnits != null && (
                  <TouchableOpacity
                    onPress={handleUnlockGallery}
                    disabled={busy != null || !canAffordBundle}
                    style={{ backgroundColor: theme.card, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderWidth: 1, borderColor: theme.divider, opacity: busy != null && busy !== 'unlock-gallery' ? 0.5 : canAffordBundle ? 1 : 0.4 }}
                  >
                    <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>Unlock the full gallery</Text>
                    {busy === 'unlock-gallery' ? <ActivityIndicator color={theme.text} size="small"/> : (
                      <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '700' }}>{formatCredits(bundleCostHalfUnits)}</Text>
                    )}
                  </TouchableOpacity>
                )}

                <Text style={{ color: theme.subtext, fontSize: 12, fontWeight: '600', marginBottom: 8, marginTop: 4 }}>BUY CREDITS</Text>
                {(Object.values(CREDIT_PACK_IDS) as CreditPackId[]).map((packId) => {
                  const product = products.find(p => p.productId === packId);
                  return (
                    <TouchableOpacity
                      key={packId}
                      onPress={() => handleBuyPack(packId)}
                      disabled={busy != null || !product}
                      style={{ backgroundColor: theme.card, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, borderWidth: 1, borderColor: theme.divider, opacity: busy != null && busy !== packId ? 0.5 : 1 }}
                    >
                      <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>{product?.displayName ?? packId}</Text>
                      {busy === packId ? <ActivityIndicator color={theme.text} size="small"/> : (
                        <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '700' }}>{product?.displayPrice ?? '—'}</Text>
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
