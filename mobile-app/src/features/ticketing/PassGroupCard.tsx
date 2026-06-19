// ─────────────────────────────────────────────────────────────────────
// Wugi — PassGroupCard
//
// The canonical colorful grouped pass card, extracted VERBATIM from
// MyPassesScreen so both My Passes and the Saved tab render passes the
// same way. Color resolution is delegated to safeData.getPassStyle — the
// ticket-type → color contract is unchanged.
//
// Modes:
//   showExpansion (default true) — My Passes: multi-pass orders expand
//     into "Your Pass" + guest rows (Share / View QR).
//   showExpansion = false        — Saved preview: summary card only,
//     tapping routes to My Passes.
//   archived                     — muted styling + EXPIRED/REDEEMED badge.
// ─────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { PassData } from '../../types';
import { getPassStyle, getScanStatus } from '../../utils/safeData';

type PassGroupCardProps = {
  group:          PassData[];
  expanded?:      boolean;
  showExpansion?: boolean;                       // default true
  archived?:      boolean;                       // default false
  archivedBadge?: 'EXPIRED' | 'REDEEMED' | null;
  onPressCard:    () => void;
  onSelectPass:   (pass: PassData) => void;
};

export function PassGroupCard({
  group, expanded = false, showExpansion = true, archived = false, archivedBadge = null,
  onPressCard, onSelectPass,
}: PassGroupCardProps) {
  const first         = group[0];
  const count         = group.length;
  const isTransferred = first.transferred;
  const style         = getPassStyle(first.ticketTypeName || first.ticketType, first.passColor);
  const cardColor     = style.color;
  const scanStyle     = getScanStatus(first.status);
  const isPending     = first.transferPending;
  const isMulti       = count > 1;
  const canExpand     = showExpansion && isMulti;
  const showExpanded  = canExpand && expanded;

  // Purchaser pass = role:'purchaser' or first pass
  // Guest passes = role:'guest' or passes 2..N
  const purchaserPass = group.find(p => (p as any).role === 'purchaser') || first;
  const guestPasses   = group.filter(p => p.passId !== purchaserPass.passId);

  // Status badge — archived (EXPIRED/REDEEMED) overrides the live VALID/USED
  // badge; transferred / pending still take precedence.
  const badgeBg = isTransferred ? 'rgba(231,76,60,0.4)'
    : isPending  ? 'rgba(230,150,0,0.3)'
    : archived   ? 'rgba(0,0,0,0.4)'
    : scanStyle.bg;
  const badgeColor = isTransferred ? '#e74c3c'
    : isPending  ? '#e6961e'
    : archived   ? 'rgba(255,255,255,0.92)'
    : scanStyle.color;
  const badgeLabel = isTransferred ? 'TRANSFERRED'
    : isPending  ? 'PENDING'
    : archived && archivedBadge ? archivedBadge
    : scanStyle.label;

  const footerRight = isTransferred ? ''
    : !showExpansion ? 'View →'
    : isMulti ? (expanded ? 'Tap to collapse' : 'Tap to manage →')
    : 'Tap to view →';

  return (
    <View style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 0 }}>
      {/* Main card — tap to expand if multi-pass, view if single */}
      <TouchableOpacity
        onPress={onPressCard}
        activeOpacity={isTransferred ? 1 : 0.88}
        style={{
          borderRadius: showExpanded ? 0 : 16,
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          borderBottomLeftRadius: showExpanded ? 0 : 16,
          borderBottomRightRadius: showExpanded ? 0 : 16,
          backgroundColor: cardColor,
          shadowColor: isTransferred || archived ? 'transparent' : cardColor,
          shadowOpacity: isTransferred || archived ? 0 : 0.4,
          shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
          opacity: isTransferred ? 0.45 : archived ? 0.6 : 1,
        }}
      >
        {/* Muting wash for archived groups — presentation only, does not
            alter the resolved cardColor. */}
        {archived && (
          <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' }}/>
        )}
        <View style={{ padding: 16, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10, fontWeight: '800', letterSpacing: 2 }}>
              {(first.colorLabel || first.ticketTypeName || style.abbrev || 'TICKET').toUpperCase()}
              {count > 1 ? ` × ${count}` : ''}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ backgroundColor: badgeBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: badgeColor, fontSize: 10, fontWeight: '700' }}>
                  {badgeLabel}
                </Text>
              </View>
              {canExpand && (
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>
                  {expanded ? '▲' : '▼'}
                </Text>
              )}
            </View>
          </View>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '900', marginBottom: 4 }}>{first.eventTitle}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>{first.venueName}{first.date ? ` · ${first.date}` : ''}</Text>
        </View>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.12)', height: 1 }}/>
        <View style={{ backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600' }}>
            {isTransferred ? 'Ticket transferred' : first.holderName}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' }}>
            {footerRight}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Expanded inline pass list — shown for multi-pass orders */}
      {showExpanded && (
        <View style={{ backgroundColor: 'rgba(0,0,0,0.35)', borderBottomLeftRadius: 16, borderBottomRightRadius: 16, overflow: 'hidden' }}>
          {/* Purchaser pass row */}
          <TouchableOpacity
            onPress={() => onSelectPass(purchaserPass)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' }}
          >
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: cardColor, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
              <Text style={{ fontSize: 14 }}>🎟️</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Your Pass</Text>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>{purchaserPass.holderName || 'Purchaser'}</Text>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>View QR →</Text>
          </TouchableOpacity>

          {/* Guest pass rows */}
          {guestPasses.map((gp, i) => {
            const gpTransferred = gp.transferred;
            const gpPending     = gp.transferPending;
            const gpClaimed     = gpTransferred || gpPending;
            return (
              <View
                key={gp.passId}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: i < guestPasses.length - 1 ? 1 : 0, borderBottomColor: 'rgba(255,255,255,0.1)' }}
              >
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <Text style={{ fontSize: 14 }}>👤</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
                    Guest Pass {i + 1}
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
                    {gpTransferred ? `Claimed by ${gp.holderName || 'recipient'}` : gpPending ? 'Pending acceptance' : 'Not yet shared'}
                  </Text>
                </View>
                {gpClaimed ? (
                  <View style={{ backgroundColor: gpTransferred ? 'rgba(46,204,113,0.3)' : 'rgba(230,150,0,0.3)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: gpTransferred ? '#2ecc71' : '#e6961e', fontSize: 10, fontWeight: '700' }}>
                      {gpTransferred ? '✓ CLAIMED' : '⏳ PENDING'}
                    </Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => onSelectPass(gp)}
                    style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }}
                  >
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Share →</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
