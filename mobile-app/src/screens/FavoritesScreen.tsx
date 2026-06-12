// ─────────────────────────────────────────────────────────────────────
// Wugi — FavoritesScreen (design: "Saved")
//
// Three sections:
//   1. Passes      — real Firestore data (passes collection, userId query)
//   2. Saved events — items swiped-right via ForYou, type === 'event'
//   3. Saved venues — items swiped-right via ForYou, type === 'venue'
//
// Photo galleries (Wugi Lens) — DROPPED: no real backing store.
// "Tonight" / "This week" groupings — DROPPED: no date metadata on saved items.
//
// Typography: FONTS.display titles · FONTS.body body · FONTS.medium
// buttons/labels · MONO ALLCAPS eyebrows.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator,
  FlatList, StyleSheet, Animated, Easing,
} from 'react-native';
import { Image } from 'expo-image';
import type { Theme } from '../constants/colors';
import type { EventData, VenueData, FavoriteItem, PassData } from '../types';
import { ChevronRightIcon } from '../components/icons';
import { HeartIconBordered } from '../components/HeartIconBordered';
import { FONTS, MONO } from '../constants/fonts';

// Undo window for unsave actions — within this delay the SavedCard is
// hidden locally but the parent's onRemove() (Firestore mutation + in-
// memory state filter) is NOT called yet. Tapping Undo cancels the
// timer and animates the card back in.
const UNDO_DURATION_MS = 4000;

// Number of items previewed in each section's horizontal carousel before the
// "View All" link takes the user to the full list.
const PREVIEW_LIMIT = 5;

type Props = {
  theme: Theme;
  favorites: FavoriteItem[];
  onEventPress: (event: EventData) => void;
  onVenuePress: (venue: VenueData) => void;
  onRemove: (id: string) => void;
  onMarkRead: (id: string) => void;
  onPassPress?: (pass: PassData) => void;
  // UAT-V3 (additive): tap "View All" on a Saved section to open the
  // corresponding full-list view. When omitted the link doesn't render.
  onViewAllSaved?: (kind: 'event' | 'venue') => void;
  // Build #74 §4 (additive): tap a liked photo to deep-link into PhotoViewer
  // at that exact photo. Receives the synthetic favorite id `${galleryId}-${i}`.
  // When omitted, tapping a saved photo just marks it read (legacy behavior).
  onPhotoPress?: (photoId: string) => void;
};

// ── Section header (Passes still uses the no-link variant) ────────────
function SectionHeader({ kicker, title, count, theme, onViewAll }: { kicker: string; title: string; count?: number; theme: Theme; onViewAll?: () => void }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ color: theme.accent, fontSize: 11, fontFamily: MONO, letterSpacing: 0.5 }}>{kicker}</Text>
        {count != null && <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO }}>{count}</Text>}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: theme.text, fontSize: 17, fontFamily: FONTS.display, letterSpacing: -0.3 }}>{title}</Text>
        {onViewAll && (
          <TouchableOpacity onPress={onViewAll} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Text style={{ color: theme.accent, fontSize: 13, fontFamily: FONTS.medium }}>View All</Text>
            <ChevronRightIcon color={theme.accent}/>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── Compact saved card — horizontal-carousel preview ──────────────────
// Image-led card with uniform overlay (matches Home "Picks/Weekend" pattern).
// Tappable heart in the top-right unsaves the item with a 250ms fade +
// width-collapse animation; the carousel's gap reflows as the card's
// outer width animates to 0. The card stays mounted (hidden) during the
// 4s undo window — if the user taps Undo, the same animation runs in
// reverse and the card pops back in. The heart's TouchableOpacity stops
// touch propagation (RN child-responder), so heart-tap removes without
// firing the parent card's onPress.
//
// The actual Firestore + in-memory state removal is owned by the parent
// (props.onRemove); SavedCard purely owns its visual state. The parent
// fires onRemove() either when the 4s timer expires or when the card is
// preempted by a newer removal (single-pending-removal rule).
const CARD_WIDTH = 140;
function SavedCard({
  item, theme, onPress, onRequestRemove, pending, onUndo,
}: {
  item: FavoriteItem;
  theme: Theme;
  onPress: () => void;
  onRequestRemove: () => void;
  pending: boolean;        // true while the 4s undo window is active for this card
  onUndo: () => void;      // called when Undo is requested for this specific card
}) {
  const fade   = useRef(new Animated.Value(1)).current;
  const widthA = useRef(new Animated.Value(CARD_WIDTH)).current;
  const lastPending = useRef(false);

  // Drive the collapse / restore animation off the `pending` flag so the
  // SavedCard re-animates back in when the parent flips pending → false
  // (Undo). Each direction is 250ms — fade and width animate together.
  useEffect(() => {
    if (pending === lastPending.current) return;
    lastPending.current = pending;
    Animated.parallel([
      Animated.timing(fade, {
        toValue: pending ? 0 : 1,
        duration: 250,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false, // width animates on JS thread; keep both in sync
      }),
      Animated.timing(widthA, {
        toValue: pending ? 0 : CARD_WIDTH,
        duration: 250,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start();
  }, [pending, fade, widthA]);

  const handleRemove = () => {
    if (pending) return;
    onRequestRemove();
  };

  return (
    <Animated.View style={{ width: widthA, opacity: fade, overflow: 'hidden' }}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={pending ? onUndo : onPress}
        disabled={false}
        style={{ width: CARD_WIDTH, height: 180, borderRadius: 12, overflow: 'hidden' }}
      >
        <Image cachePolicy="memory-disk" source={{ uri: item.image }} style={StyleSheet.absoluteFillObject} contentFit="cover"/>
        <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, backgroundColor: theme.overlaySoft }}/>
        {!item.read && (
          <View style={{ position: 'absolute', top: 8, left: 8, width: 7, height: 7, borderRadius: 3.5, backgroundColor: theme.accent }}/>
        )}
        {/* Heart-unsave — visible 24pt icon at top:8/right:8, hitSlop expands
            the touch area to ~44×44 (iOS HIG). White outline (Batch 3.1)
            improves legibility on busy photos. Nested TouchableOpacity
            catches the tap so it does NOT propagate to parent onPress. */}
        <TouchableOpacity
          onPress={handleRemove}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ position: 'absolute', top: 8, right: 8 }}
        >
          <HeartIconBordered color={theme.accent} filled size={24}/>
        </TouchableOpacity>
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 10 }}>
          <Text style={{ color: theme.accent, fontSize: 9, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.5, marginBottom: 3 }}>
            {item.type === 'event' ? 'EVENT' : item.type === 'venue' ? 'VENUE' : 'PHOTO'}
          </Text>
          <Text style={{ color: theme.onImage, fontSize: 13, fontFamily: FONTS.display, lineHeight: 16, marginBottom: 2 }} numberOfLines={2}>{item.title}</Text>
          <Text style={{ color: theme.onImageMuted, fontSize: 11, fontFamily: FONTS.body }} numberOfLines={1}>{item.subtitle}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Pass row ──────────────────────────────────────────────────────────
function PassRow({ pass, theme, onPress }: { pass: PassData; theme: Theme; onPress: () => void }) {
  const ticketLabel = pass.ticketTypeName || pass.ticketType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.82}
      style={{
        flexDirection: 'row', alignItems: 'stretch',
        backgroundColor: theme.card, borderRadius: 14, overflow: 'hidden',
        borderWidth: 1, borderColor: theme.accent,
        shadowColor: theme.accent, shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      <View style={{ width: 6, backgroundColor: theme.accent }}/>
      <View style={{ flex: 1, padding: 14, paddingRight: 12, gap: 3 }}>
        <Text style={{ color: theme.accent, fontSize: 10, fontFamily: MONO, letterSpacing: 0.8 }}>
          YOUR PASS · {ticketLabel.toUpperCase()}
        </Text>
        <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.display, lineHeight: 18 }} numberOfLines={1}>
          {pass.eventTitle}
        </Text>
        <Text style={{ color: theme.subtext, fontSize: 12, fontFamily: FONTS.body }}>{pass.venueName}</Text>
        <Text style={{ color: theme.text, fontSize: 11, fontFamily: MONO, letterSpacing: 0.4, marginTop: 2 }}>
          {pass.date}{pass.time ? ` · ${pass.time}` : ''}
        </Text>
      </View>
      <View style={{ alignSelf: 'center', paddingRight: 14 }}>
        <ChevronRightIcon color={theme.subtext}/>
      </View>
    </TouchableOpacity>
  );
}

// ── Saved item row (event or venue) ───────────────────────────────────
// Exported for the SavedListScreen full-list view, which renders the same row.
export function SavedItemRow({ item, theme, onPress, onRemove }: { item: FavoriteItem; theme: Theme; onPress: () => void; onRemove: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.82}
      style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: theme.card, borderRadius: 12, overflow: 'hidden',
        borderWidth: 1, borderColor: theme.border,
      }}
    >
      <View style={{ position: 'relative' }}>
        <Image
          cachePolicy="memory-disk"
          source={{ uri: item.image }}
          style={{ width: 72, height: 72 }}
          contentFit="cover"
        />
        {!item.read && (
          <View style={{ position: 'absolute', top: 6, left: 6, width: 7, height: 7, borderRadius: 3.5, backgroundColor: theme.accent }}/>
        )}
      </View>
      <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Text style={{ color: theme.accent, fontSize: 10, fontFamily: MONO, letterSpacing: 0.5, marginBottom: 3 }}>
          {item.type === 'event' ? 'EVENT' : 'VENUE'}
        </Text>
        <Text style={{ color: item.read ? theme.subtext : theme.text, fontSize: 13, fontFamily: FONTS.display, marginBottom: 2 }} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: FONTS.body }} numberOfLines={1}>
          {item.subtitle}
        </Text>
      </View>
      <TouchableOpacity onPress={onRemove} style={{ padding: 16 }} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
        <HeartIconBordered color="#e74c3c" filled/>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ── Empty state ───────────────────────────────────────────────────────
// Exported for reuse by SavedListScreen.
export function EmptySection({ label, theme }: { label: string; theme: Theme }) {
  return (
    <View style={{ marginHorizontal: 16, backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 20, alignItems: 'center' }}>
      <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, textAlign: 'center', lineHeight: 20 }}>
        {label}
      </Text>
    </View>
  );
}

// ── FavoritesScreen ───────────────────────────────────────────────────
export function FavoritesScreen({
  theme, favorites, onEventPress, onVenuePress, onRemove, onMarkRead, onPassPress, onViewAllSaved, onPhotoPress,
}: Props) {
  const [passes,       setPasses]       = useState<PassData[]>([]);
  const [passesLoading, setPassesLoading] = useState(true);

  // ── Pending-removal (undo) state — Batch 3.3 ──────────────────────
  // We defer the parent's onRemove(id) until the 4s undo window closes
  // (or another removal preempts it, or the screen unmounts). During
  // the window the SavedCard for `pendingId` animates to width:0 and
  // the undo pill banner is visible at the bottom.
  //
  // Only ONE pending removal exists at a time — a new unsave tap fires
  // the previous pending removal immediately, then takes its place.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pendingRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const bannerFade = useRef(new Animated.Value(0)).current;

  // Clears the timer + ref but does NOT call onRemove. Used both for
  // Undo (we want to keep the favorite) and when preempting one
  // pending removal with another (we already fired onRemove manually).
  const clearPending = useCallback(() => {
    if (pendingRef.current) {
      clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
    }
  }, []);

  const requestRemoval = useCallback((id: string) => {
    // If something else is already pending, commit it first so we never
    // hold more than one pending removal. This matches the "latest
    // action replaces existing banner" rule.
    if (pendingRef.current && pendingRef.current.id !== id) {
      const prev = pendingRef.current;
      clearTimeout(prev.timer);
      pendingRef.current = null;
      onRemove(prev.id);
    }
    const timer = setTimeout(() => {
      // 4s expired — finalize the removal.
      const cur = pendingRef.current;
      if (!cur || cur.id !== id) return;
      pendingRef.current = null;
      onRemove(id);
      setPendingId(null);
    }, UNDO_DURATION_MS);
    pendingRef.current = { id, timer };
    setPendingId(id);
  }, [onRemove]);

  const undoPending = useCallback(() => {
    clearPending();
    setPendingId(null);
  }, [clearPending]);

  // Fade the banner in/out as pendingId changes.
  useEffect(() => {
    Animated.timing(bannerFade, {
      toValue: pendingId ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [pendingId, bannerFade]);

  // On unmount: commit any in-flight pending removal so the user's
  // intent is honored even if they navigate away.
  useEffect(() => {
    return () => {
      const pr = pendingRef.current;
      if (pr) {
        clearTimeout(pr.timer);
        pendingRef.current = null;
        onRemove(pr.id);
      }
    };
    // onRemove is stable from RootNavigator's perspective per-render;
    // we intentionally run cleanup once on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live passes listener — mirrors MyPassesScreen pattern
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let mounted = true;

    async function subscribe() {
      try {
        const { getAuth }      = await import('@react-native-firebase/auth');
        const { getFirestore, collection, query, where, orderBy, onSnapshot } =
          await import('@react-native-firebase/firestore');
        const userId = getAuth().currentUser?.uid;
        if (!userId) { if (mounted) setPassesLoading(false); return; }

        const db = getFirestore();
        unsub = onSnapshot(
          query(
            collection(db, 'passes'),
            where('userId', '==', userId),
            orderBy('createdAt', 'desc')
          ),
          snap => {
            if (!mounted) return;
            const loaded: PassData[] = snap.docs
              .filter(d => {
                const data = d.data();
                if (data.source === 'door') return false;
                if (data.scanStatus === 'cancelled' || data.scanStatus === 'voided') return false;
                return true;
              })
              .map(d => {
                const data = d.data();
                return {
                  passId:          d.id,
                  eventTitle:      data.eventTitle  || data.event  || '',
                  venueName:       data.venueName   || data.venue  || '',
                  date:            data.date         || '',
                  time:            data.time         || '',
                  ticketType:      data.ticketType   || 'general_admission',
                  ticketTypeName:  data.ticketTypeName || null,
                  holderName:      data.holderName   || '',
                  orderId:         data.orderId      || '',
                  status:          data.status       || 'valid',
                  passColor:       data.passColor    || null,
                  qrValue:         data.qrValue      || null,
                } as PassData;
              });
            setPasses(loaded);
            setPassesLoading(false);
          },
          () => { if (mounted) setPassesLoading(false); }
        );
      } catch {
        if (mounted) setPassesLoading(false);
      }
    }

    subscribe();
    return () => { mounted = false; unsub?.(); };
  }, []);

  const savedEvents  = favorites.filter(f => f.type === 'event');
  const savedVenues  = favorites.filter(f => f.type === 'venue');
  const savedPhotos  = favorites.filter(f => f.type === 'photo');

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header */}
      <SafeAreaView style={{ paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 36 }}/>
          <Text style={{ color: theme.text, fontSize: 20, fontFamily: FONTS.display, letterSpacing: -0.5 }}>Saved</Text>
          <View style={{ width: 36 }}/>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* ── Passes ── */}
        <SectionHeader
          kicker="YOUR PASSES"
          title="Tickets in your pocket"
          count={passes.length > 0 ? passes.length : undefined}
          theme={theme}
        />
        {passesLoading ? (
          <View style={{ paddingHorizontal: 16 }}>
            <ActivityIndicator color={theme.accent} size="small" style={{ alignSelf: 'flex-start', marginLeft: 4 }}/>
          </View>
        ) : passes.length === 0 ? (
          <EmptySection label="No passes yet. Purchase a ticket to an event and it'll appear here." theme={theme}/>
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            {passes.map(p => (
              <PassRow
                key={p.passId}
                pass={p}
                theme={theme}
                onPress={() => onPassPress?.(p)}
              />
            ))}
          </View>
        )}

        {/* ── Saved Events — preview carousel, "View All" → SavedListScreen ── */}
        <SectionHeader
          kicker="SAVED EVENTS"
          title="Events you liked"
          count={savedEvents.length > 0 ? savedEvents.length : undefined}
          theme={theme}
          onViewAll={savedEvents.length > 0 && onViewAllSaved ? () => onViewAllSaved('event') : undefined}
        />
        {savedEvents.length === 0 ? (
          <EmptySection label="Swipe right on events in the For You tab to save them here." theme={theme}/>
        ) : (
          <FlatList
            data={savedEvents.slice(0, PREVIEW_LIMIT)}
            keyExtractor={f => f.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
            renderItem={({ item }) => (
              <SavedCard
                item={item}
                theme={theme}
                onPress={() => { onMarkRead(item.id); onEventPress(item.data as EventData); }}
                onRequestRemove={() => requestRemoval(item.id)}
                pending={pendingId === item.id}
                onUndo={undoPending}
              />
            )}
          />
        )}

        {/* ── Saved Venues — preview carousel, "View All" → SavedListScreen ── */}
        <SectionHeader
          kicker="SAVED VENUES"
          title="Places you like"
          count={savedVenues.length > 0 ? savedVenues.length : undefined}
          theme={theme}
          onViewAll={savedVenues.length > 0 && onViewAllSaved ? () => onViewAllSaved('venue') : undefined}
        />
        {savedVenues.length === 0 ? (
          <EmptySection label="Swipe right on venues in the For You tab to save them here." theme={theme}/>
        ) : (
          <FlatList
            data={savedVenues.slice(0, PREVIEW_LIMIT)}
            keyExtractor={f => f.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
            renderItem={({ item }) => (
              <SavedCard
                item={item}
                theme={theme}
                onPress={() => { onMarkRead(item.id); onVenuePress(item.data as VenueData); }}
                onRequestRemove={() => requestRemoval(item.id)}
                pending={pendingId === item.id}
                onUndo={undoPending}
              />
            )}
          />
        )}

        {/* ── Saved Photos — liked photos from Wugi Lens galleries.
            Build #74 §4: tapping deep-links into PhotoViewer at this exact
            photo (parse galleryId+index from the synthetic id, open the
            source gallery scrolled to it). Caption is event (gallery title) +
            venue · date, packed into the SavedCard title/subtitle. No
            photographer name (gated on the tier-system task). ── */}
        <SectionHeader
          kicker="SAVED PHOTOS"
          title="Photos you liked"
          count={savedPhotos.length > 0 ? savedPhotos.length : undefined}
          theme={theme}
        />
        {savedPhotos.length === 0 ? (
          <EmptySection label="Double-tap a photo in any gallery to like it and it'll appear here." theme={theme}/>
        ) : (
          <FlatList
            data={savedPhotos.slice(0, PREVIEW_LIMIT)}
            keyExtractor={f => f.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
            renderItem={({ item }) => (
              <SavedCard
                item={item}
                theme={theme}
                onPress={() => { onMarkRead(item.id); onPhotoPress?.(item.id); }}
                onRequestRemove={() => requestRemoval(item.id)}
                pending={pendingId === item.id}
                onUndo={undoPending}
              />
            )}
          />
        )}
      </ScrollView>

      {/* ── Undo banner — Batch 3.3 ─────────────────────────────────
          Bottom-anchored pill. Fades in when a removal is pending and
          fades out when the 4s timer expires OR the user taps Undo.
          pointerEvents flips with visibility so the banner doesn't
          block touches when hidden. */}
      <Animated.View
        pointerEvents={pendingId ? 'box-none' : 'none'}
        style={{
          position: 'absolute', left: 16, right: 16, bottom: 24,
          opacity: bannerFade,
          alignItems: 'center',
        }}
      >
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          backgroundColor: theme.card,
          borderRadius: 22, paddingLeft: 18, paddingRight: 6, paddingVertical: 6,
          borderWidth: 1, borderColor: theme.border,
          shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
          elevation: 4,
          maxWidth: '100%',
        }}>
          <Text style={{ color: theme.text, fontSize: 13, fontFamily: FONTS.body, marginRight: 12 }}>
            Card removed
          </Text>
          <TouchableOpacity
            onPress={undoPending}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: theme.accent }}
          >
            <Text style={{ color: theme.onAccent ?? '#fff', fontSize: 13, fontFamily: FONTS.medium, letterSpacing: 0.2 }}>
              Undo
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}
