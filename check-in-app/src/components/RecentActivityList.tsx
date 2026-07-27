// ─────────────────────────────────────────────────────────────────────
// RecentActivityList — Dashboard door log: who's come in, and (once the
// data exists) who got turned away.
//
// The 'denied'/'pending' statuses are fully styled and ready to render —
// COLORS.stop / COLORS.warn per the design's color rule — but nothing in
// the schema persists a scan denial today. ScannerScreen/ManualLookupScreen
// only show "already scanned" / "wrong event" / "balance blocked" as local
// UI state (see check-in-app/src/screens/ScannerScreen.tsx resultConfig)
// and never write it to Firestore. Wiring a denial write is out of scope
// here (this task only touches DashboardScreen.tsx + new components; those
// screens are owned by concurrent tasks) — see PR description. Until then
// this list only ever receives 'success' items from live check-ins.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../constants/colors';

export type ActivityStatus = 'success' | 'denied' | 'pending';

export interface ActivityItem {
  id: string;
  name: string;
  tier: string;
  at: Date;
  status: ActivityStatus;
  /** e.g. "Ticket reused" — only meaningful for denied/pending items */
  detail?: string;
}

const STATUS_CONFIG: Record<ActivityStatus, { icon: string; color: string }> = {
  success: { icon: '✓', color: COLORS.go },
  denied:  { icon: '✕', color: COLORS.stop },
  pending: { icon: '!', color: COLORS.warn },
};

function formatRelativeTime(at: Date, now: Date): string {
  const diffSec = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));
  if (diffSec < 45) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
}

function metaLine(item: ActivityItem, now: Date): string {
  if (item.status === 'denied') return `${item.detail || 'Denied'} · ${item.tier} · denied`;
  if (item.status === 'pending') return `${item.detail || item.tier} · pending`;
  return `${item.tier} · ${formatRelativeTime(item.at, now)}`;
}

interface Props {
  items: ActivityItem[];
}

export default function RecentActivityList({ items }: Props) {
  // Ticks the relative-time labels ("1m" → "2m") without needing new reads.
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionTitle}>Recent Activity</Text>
      {items.length === 0 ? (
        <Text style={styles.empty}>No check-ins yet tonight</Text>
      ) : (
        items.map(item => {
          const cfg = STATUS_CONFIG[item.status];
          return (
            <View key={item.id} style={styles.row}>
              <View style={[styles.iconWrap, { borderColor: cfg.color }]}>
                <Text style={[styles.icon, { color: cfg.color }]}>{cfg.icon}</Text>
              </View>
              <View style={styles.body}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                <Text style={[styles.meta, item.status !== 'success' && { color: cfg.color }]}>
                  {metaLine(item, now)}
                </Text>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 12 },
  empty: { fontSize: 13, color: COLORS.subtext, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  iconWrap: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  icon: { fontSize: 13, fontWeight: '800' },
  body: { flex: 1 },
  name: { fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: 2 },
  meta: { fontSize: 12, color: COLORS.subtext },
});
