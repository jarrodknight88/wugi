// ─────────────────────────────────────────────────────────────────────
// Wugi — safeData.ts
// Defensive data utilities. Every Firestore value that touches UI goes
// through here. Nothing in this file can throw or return undefined.
//
// Principle: bad data should degrade gracefully, never crash the app.
// ─────────────────────────────────────────────────────────────────────

// ── Primitive guards ──────────────────────────────────────────────────

/** Always returns a string. Handles null, undefined, numbers, objects. */
export function safeStr(val: unknown, fallback = ''): string {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') return val.trim() || fallback;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return fallback;
}

/** Always returns a number. Returns fallback for NaN, null, undefined. */
export function safeNum(val: unknown, fallback = 0): number {
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

/** Always returns a boolean. */
export function safeBool(val: unknown, fallback = false): boolean {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'boolean') return val;
  if (val === 'true' || val === 1) return true;
  if (val === 'false' || val === 0) return false;
  return fallback;
}

/** Safe object key lookup — never returns undefined. */
export function safeGet<T>(
  obj: Record<string, T> | undefined | null,
  key: string,
  fallback: T,
): T {
  if (!obj || typeof obj !== 'object') return fallback;
  return obj[key] !== undefined && obj[key] !== null ? obj[key] : fallback;
}

// ── Pass style resolver ───────────────────────────────────────────────
//
// Derives { color, label, abbrev } from any ticket type name + optional
// passColor override. Works for ANY future ticket type with zero code
// changes — no hardcoded lookup table.
//
// Priority:
//  1. passColor field on the pass doc (venue-set override)
//  2. Semantic match on well-known keywords (vip, table, backstage, free…)
//  3. Deterministic color hash from the ticket type name string
//     — same name always produces the same color across all devices/sessions

const PALETTE = [
  '#2a7a5a', // wugi green
  '#7c3aed', // purple
  '#1d4ed8', // blue
  '#b45309', // amber
  '#0f766e', // teal
  '#be185d', // pink
  '#1e40af', // indigo
  '#065f46', // emerald
  '#92400e', // yellow-brown
  '#1e3a5f', // navy
];

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function abbreviate(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words.map(w => w[0]).join('').slice(0, 4).toUpperCase();
}

export interface PassStyle {
  color:   string;
  label:   string;
  abbrev:  string;
}

/**
 * getPassStyle(ticketTypeName, passColor?)
 *
 * Safe, dynamic, never throws, never returns undefined fields.
 * Works for any ticket type name — current or future.
 */
export function getPassStyle(
  ticketTypeName: unknown,
  passColor?: unknown,
): PassStyle {
  const name  = safeStr(ticketTypeName, 'Ticket');
  const lower = name.toLowerCase();

  // 1. Venue color override (stored on pass doc by dashboard)
  const overrideColor = safeStr(passColor);

  // 2. Semantic keyword matches
  let semanticColor: string | null = null;
  if (lower.includes('vip'))        semanticColor = '#7c3aed';
  else if (lower.includes('table')) semanticColor = '#1d4ed8';
  else if (lower.includes('backstage') || lower.includes('artist')) semanticColor = '#111827';
  else if (lower.includes('early')) semanticColor = '#2196F3';
  else if (lower.includes('free') || lower.includes('rsvp')) semanticColor = '#2a7a5a';
  else if (lower.includes('press') || lower.includes('media')) semanticColor = '#374151';
  else if (lower.includes('vvip') || lower.includes('ultra')) semanticColor = '#9f1239';

  const color = overrideColor || semanticColor || hashColor(lower);

  return {
    color,
    label:  name,
    abbrev: abbreviate(name),
  };
}

// ── Event / scan status helpers ───────────────────────────────────────

export interface StatusStyle {
  label: string;
  color: string;
  bg:    string;
}

export function getScanStatus(scanStatus: unknown): StatusStyle {
  switch (safeStr(scanStatus)) {
    case 'scanned': return { label: 'USED',     color: '#fff',    bg: 'rgba(0,0,0,0.4)'      };
    case 'voided':  return { label: 'VOIDED',   color: '#e74c3c', bg: 'rgba(231,76,60,0.3)'  };
    case 'cancelled': return { label: 'CANCELLED', color: '#e74c3c', bg: 'rgba(231,76,60,0.3)' };
    default:        return { label: 'VALID',    color: '#fff',    bg: 'rgba(0,0,0,0.25)'     };
  }
}

export function getTicketStatus(status: unknown): StatusStyle {
  switch (safeStr(status)) {
    case 'on_sale':   return { label: 'On Sale',   color: '#2a7a5a', bg: 'rgba(42,122,90,0.1)'  };
    case 'sold_out':  return { label: 'Sold Out',  color: '#e74c3c', bg: 'rgba(231,76,60,0.1)'  };
    case 'paused':    return { label: 'Paused',    color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' };
    case 'scheduled': return { label: 'Scheduled', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' };
    case 'cancelled': return { label: 'Cancelled', color: '#6b7280', bg: 'rgba(107,114,128,0.1)' };
    default:          return { label: safeStr(status, 'Unknown'), color: '#6b7280', bg: 'rgba(107,114,128,0.1)' };
  }
}

export function getEventStatus(status: unknown): StatusStyle {
  switch (safeStr(status)) {
    case 'approved':   return { label: 'Approved',   color: '#2a7a5a', bg: 'rgba(42,122,90,0.1)'  };
    case 'draft':      return { label: 'Draft',      color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' };
    case 'cancelled':  return { label: 'Cancelled',  color: '#e74c3c', bg: 'rgba(231,76,60,0.1)'  };
    case 'completed':  return { label: 'Completed',  color: '#6b7280', bg: 'rgba(107,114,128,0.1)' };
    default:           return { label: safeStr(status, 'Pending'), color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' };
  }
}
