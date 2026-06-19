// ─────────────────────────────────────────────────────────────────────
// Wugi — passGrouping.ts
//
// Shared pass helpers so the Saved tab preview and the My Passes screen
// render the SAME grouped passes from the SAME mapping. This removes the
// divergence where Saved flattened a multi-guest order into N identical
// rows while My Passes grouped it into one colorful card.
//
// Color resolution is NOT here — it lives in safeData.getPassStyle (the
// cross-surface ticket-type → color contract) and is left untouched.
// ─────────────────────────────────────────────────────────────────────
import type { PassData } from '../types';

// Canonical "redeemed" value. Wugi Door (check-in-app) writes
// `scanStatus: 'scanned'` on check-in
// (check-in-app/src/screens/ScannerScreen.tsx + ManualLookupScreen.tsx).
// Both pass listeners mirror that onto PassData.status as 'scanned'.
export const REDEEMED_STATUS: PassData['status'] = 'scanned';

/** Pass docs we never render: Door-origin and cancelled/voided tickets. */
export function isRenderablePassDoc(data: any): boolean {
  if (data.source === 'door') return false;
  if (data.scanStatus === 'cancelled' || data.scanStatus === 'voided') return false;
  return true;
}

/**
 * Map a Firestore pass doc → PassData.
 * Single source of truth for both the Saved tab and My Passes (previously
 * each screen mapped the doc differently — e.g. Saved read `data.date`
 * while the webhook writes `data.eventDate`, so dates rendered blank).
 */
export function mapPassDoc(d: any): PassData {
  const data = d.data();
  const ticketTypeLower = (data.ticketTypeName || '').toLowerCase();
  const typeKey = ticketTypeLower.includes('vip') ? 'vip'
    : ticketTypeLower.includes('table') ? 'table'
    : ticketTypeLower.includes('backstage') ? 'backstage'
    : ticketTypeLower.includes('free') ? 'free'
    : 'general';
  return {
    orderId:              data.orderId || d.id,
    passId:               d.id,
    passNumber:           1,
    totalPasses:          1,
    ticketType:           typeKey,
    ticketTypeName:       data.ticketTypeName || 'General Admission',
    eventTitle:           data.eventTitle || 'Event',
    venueName:            data.venueName  || '',
    date:                 data.eventDate  || '',
    time:                 data.eventTime  || '',
    holderName:           data.holderName || data.holderEmail || '',
    status:               data.scanStatus === 'scanned' ? 'scanned' : 'valid',
    qrValue:              d.id,
    passUrl:              data.appleWalletPassUrl || data.passUrl || null,
    passColor:            data.passColor   || null,
    colorLabel:           data.colorLabel  || null,
    tableNumber:          data.tableAssignment || null,
    transferPending:      data.transferPending || false,
    transferred:          data.isTransferred || false,
    transferId:           data.transferId || null,
    totalPaid:            data.totalPaid ?? null,
    balanceDue:           data.balanceDue ?? null,
    depositPaid:          data.depositPaid ?? null,
    paymentMethodLast4:   data.paymentMethodLast4 || null,
    purchasedAt:          data.createdAt || null,
    source:               data.source || null,
    transferredFromName:  data.transferredFromName  || null,
    transferredFromEmail: data.transferredFromEmail || null,
    transferredAt:        data.transferredAt || null,
  } as PassData;
}

/**
 * Group passes by purchase order — the same key My Passes already uses.
 * A VIP table bought with N guest passes shares one orderId and collapses
 * into a single group. Insertion order is preserved (createdAt desc).
 */
export function groupPassesByOrder(passes: PassData[]): PassData[][] {
  const groups = new Map<string, PassData[]>();
  passes.forEach(p => {
    const key = p.orderId || p.passId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  });
  return Array.from(groups.values());
}

/**
 * Best-effort "has the event date already passed?" for the yearless
 * display strings stored on passes (e.g. "WED JUN 18"). Mirrors the
 * weekday-stripping parse used in EventScreen, but does NOT roll the
 * date forward a year — a past date should read as past. Returns false
 * when the string is missing or unparseable (treat as not-expired).
 */
export function eventDateHasPassed(dateStr: string | undefined | null, now: Date = new Date()): boolean {
  if (!dateStr) return false;
  const withoutWeekday = String(dateStr).replace(/^[A-Z]{2,3}\s+/i, '').trim();
  if (!withoutWeekday) return false;
  const parsed = new Date(`${withoutWeekday} ${now.getFullYear()}`);
  if (isNaN(parsed.getTime())) return false;
  // Day granularity — an event is "past" only once its day has fully ended.
  const endOfEventDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 23, 59, 59);
  return endOfEventDay.getTime() < now.getTime();
}

export type PassGroupArchive = {
  archived: boolean;
  badge: 'EXPIRED' | 'REDEEMED' | null;
};

/**
 * A pass group is archived when its event date has passed OR its ticket
 * was redeemed/scanned by Door. REDEEMED takes precedence over EXPIRED.
 * Status is read off the representative (first) pass, matching how the
 * colorful card already derives its status badge.
 */
export function classifyPassGroup(group: PassData[], now: Date = new Date()): PassGroupArchive {
  const first = group[0];
  if (first?.status === REDEEMED_STATUS) return { archived: true, badge: 'REDEEMED' };
  if (eventDateHasPassed(first?.date, now)) return { archived: true, badge: 'EXPIRED' };
  return { archived: false, badge: null };
}
