// ─────────────────────────────────────────────────────────────────────
// Wugi — VenueEventsListScreen   (full "View all" destination)
//
// Pushed from the HAPPENING HERE section on VenueScreen when a venue has more
// than UPCOMING_INLINE_MAX collapsed upcoming cards. Renders ALL upcoming
// events for one venueId — collapsed to one card per series (soonest eligible,
// expired dropped) via the SAME computeSeriesFeed the marquee uses — as a
// vertical stack of full-length cards, tapping through to EventScreen.
//
// Read-only against `events`. Single-field where venueId == X; collapse + sort
// client-side (no composite index needed).
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, Dimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../constants/colors';
import type { EventData } from '../types';
import { FONTS, MONO } from '../constants/fonts';
import { computeSeriesFeed } from '../../firestoreService';
import { VibeEventCard } from '../components/VibeEventCard';

const CARD_W = Dimensions.get('window').width - 32;

type Props = {
  venueId: string;
  theme: Theme;
  onBack: () => void;
  onEventPress: (event: EventData) => void;
};

export function VenueEventsListScreen({ venueId, theme, onBack, onEventPress }: Props) {
  const [events, setEvents] = useState<EventData[]>([]);
  const [venueName, setVenueName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getFirestore, collection, getDocs, query, where, doc, getDoc } =
          await import('@react-native-firebase/firestore');
        const db = getFirestore();
        const [esnap, vdoc] = await Promise.all([
          getDocs(query(collection(db, 'events'), where('venueId', '==', venueId))),
          getDoc(doc(collection(db, 'venues'), venueId)),
        ]);
        if (cancelled) return;
        const vname = vdoc.exists() ? (((vdoc.data() as any)?.name) || '') : '';
        setVenueName(vname);

        const approved = esnap.docs.filter((d: any) => d.data().status === 'approved');
        const raw = approved.map((d: any) => ({ id: d.id, ...(d.data() as object) }));
        const evs: EventData[] = computeSeriesFeed(raw as any)
          .slice()
          .sort((a: any, b: any) => {
            const ad = a.dateISO || '9999-99-99', bd = b.dateISO || '9999-99-99';
            return ad < bd ? -1 : ad > bd ? 1 : 0;
          })
          .map((e: any) => ({
            id: e.id, title: e.title || e.name || '', venue: vname, venueId,
            seriesId: e.seriesId ?? null,
            date: e.date || '', time: e.time || '', age: e.age || '', about: e.about || '',
            media: (e.media || []).map((m: any) => typeof m === 'string' ? { type: 'image', uri: m } : m),
            hasTickets: e.hasTickets === true,
            gallery: { id: e.id, title: e.title || '', venue: vname, date: e.date || '', coverImage: '', photos: [] },
          })) as EventData[];
        setEvents(evs);
      } catch (e) {
        console.log('VenueEventsListScreen: load failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [venueId]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ width: 36, alignItems: 'flex-start' }}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M15 18l-6-6 6-6" stroke={theme.text} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"/>
            </Svg>
          </TouchableOpacity>
          <Text style={{ color: theme.text, fontSize: 20, fontFamily: FONTS.display, letterSpacing: -0.5 }}>Upcoming</Text>
          <View style={{ width: 36 }}/>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 16, paddingBottom: 40 }}>
        {!!venueName && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
            <Text style={{ color: theme.subtext, fontSize: 11, fontFamily: MONO, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 }}>
              HAPPENING HERE · {events.length} UPCOMING
            </Text>
            <Text style={{ color: theme.text, fontSize: 22, fontFamily: FONTS.display, letterSpacing: -0.6 }} numberOfLines={2}>
              {venueName}
            </Text>
          </View>
        )}

        {loading ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}>
            <ActivityIndicator color={theme.accent} size="large"/>
          </View>
        ) : events.length === 0 ? (
          <View style={{ paddingTop: 60, paddingHorizontal: 32, alignItems: 'center' }}>
            <Text style={{ color: theme.text, fontSize: 15, fontFamily: FONTS.display, letterSpacing: -0.2, marginBottom: 6, textAlign: 'center' }}>
              Nothing upcoming
            </Text>
            <Text style={{ color: theme.subtext, fontSize: 13, fontFamily: FONTS.body, textAlign: 'center', opacity: 0.7 }}>
              New nights will appear here as they're scheduled.
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            {events.map(ev => (
              <VibeEventCard key={ev.id} event={ev} label={ev.date} theme={theme} onPress={() => onEventPress(ev)} width={CARD_W} height={220}/>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
