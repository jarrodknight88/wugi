// ─────────────────────────────────────────────────────────────────────
// Wugi — MenuScreen
// Reads venues/{venueId}/menu subcollection, groups items by section.
// Phase 2 ingest populates the data; until then the screen renders a
// "Menu coming soon" empty state so the entry point doesn't dead-end.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator } from 'react-native';
import type { Theme } from '../constants/colors';
import type { MenuItem } from '../types';
import { BackIcon, ChevronRightIcon } from '../components/icons';

type Props = {
  venueId: string;
  venueName: string;
  theme: Theme;
  onBack: () => void;
  onItemPress: (item: MenuItem) => void;
};

export function MenuScreen({ venueId, venueName, theme, onBack, onItemPress }: Props) {
  const [items,   setItems]   = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { getFirestore, collection, getDocs } =
          await import('@react-native-firebase/firestore');
        const db   = getFirestore();
        const snap = await getDocs(collection(db, 'venues', venueId, 'menu'));
        if (cancelled) return;
        const loaded = (snap.docs as any[]).map((d) => {
          const data = (d.data?.() ?? {}) as Partial<MenuItem>;
          return { ...data, id: data.id ?? d.id } as MenuItem;
        });
        setItems(loaded);
      } catch (e) {
        // Subcollection missing or offline — render empty state. Don't
        // surface an error to the user; this is expected pre-ingest.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [venueId]);

  // Group items by section. Items with no section land in "Menu".
  const sections: { name: string; items: MenuItem[] }[] = [];
  for (const item of items) {
    const sectionName = item.section || 'Menu';
    let bucket = sections.find(s => s.name === sectionName);
    if (!bucket) { bucket = { name: sectionName, items: [] }; sections.push(bucket); }
    bucket.items.push(item);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ borderBottomWidth: 1, borderBottomColor: theme.divider, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8 }}>
          <TouchableOpacity onPress={onBack} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <BackIcon color={theme.text}/>
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: theme.subtext, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 }}>MENU</Text>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700', marginTop: 1 }} numberOfLines={1}>{venueName}</Text>
          </View>
          <View style={{ width: 36 }}/>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} size="large"/>
          <Text style={{ color: theme.subtext, fontSize: 13, marginTop: 12 }}>Loading menu…</Text>
        </View>
      ) : sections.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ fontSize: 36, marginBottom: 12 }}>🍽️</Text>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700', textAlign: 'center' }}>Menu coming soon</Text>
          <Text style={{ color: theme.subtext, fontSize: 13, marginTop: 6, textAlign: 'center', lineHeight: 18 }}>
            We're working with {venueName} to bring their full menu inside the app. Check back shortly.
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
          {sections.map(section => (
            <View key={section.name}>
              <View style={{ paddingHorizontal: 16, paddingTop: 22, paddingBottom: 8 }}>
                <Text style={{ color: theme.subtext, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 }}>
                  {section.name.toUpperCase()}
                </Text>
              </View>
              <View style={{ marginHorizontal: 16, borderRadius: 12, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' }}>
                {section.items.map((item, idx) => (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => onItemPress(item)}
                    activeOpacity={0.7}
                    style={{ flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 14, borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: theme.divider, gap: 12, alignItems: 'flex-start' }}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{item.name}</Text>
                        {(item.badges || []).slice(0, 1).map(b => (
                          <View key={b} style={{ backgroundColor: theme.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                            <Text style={{ color: theme.onAccent, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 }}>{b}</Text>
                          </View>
                        ))}
                      </View>
                      {item.description ? (
                        <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 4, lineHeight: 17 }} numberOfLines={2}>
                          {item.description}
                        </Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', minWidth: 56 }}>
                      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{item.priceDisplay || (typeof item.price === 'number' ? `$${item.price.toFixed(0)}` : '')}</Text>
                      <ChevronRightIcon color={theme.subtext}/>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
