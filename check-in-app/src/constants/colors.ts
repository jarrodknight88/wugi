// ─────────────────────────────────────────────────────────────────────
// Wugi Door — Color Tokens
//
// Phase A of the Door redesign (docs/DOOR-REDESIGN-SPEC.md): the values
// below are the app's CURRENT chrome colours, extracted as-is so this
// file is a pure refactor — no visual change. Phase B (separate task)
// swaps only the values here, making the whole restyle a one-file diff.
//
// Door is dark-only for now, so unlike mobile-app/src/constants/colors.ts
// there is no light/dark split — COLORS is used directly.
// ─────────────────────────────────────────────────────────────────────

export const COLORS = {
  // Surfaces
  bg:      '#0a0a0a',
  card:    '#1a1a1a',
  card2:   '#2a2a2a',
  surface: '#161616',
  border:  '#2a2a2a',
  divider: '#222222',

  // Text
  text:    '#ffffff',
  subtext: '#555555',

  // Brand
  brand:   '#2a7a5a',
  onBrand: '#ffffff',

  // Status / semantic
  go:       '#2a7a5a',
  goDeep:   '#0d1f16',
  stop:     '#cc3333',
  stopDeep: '#2a1a1a',
  warn:     '#e6a817',
  warnDeep: '#2a1a00',
  info:     '#7c8aed',
};

// Derived type — used throughout the app for theme prop typing
export type Theme = typeof COLORS;

// ── Ticket/pass colour contract ─────────────────────────────────────
// Fallback used when a pass has no `passColor` set. This mirrors the
// cross-app pass-colour contract owned by getPassStyle()
// (mobile-app/src/utils/safeData.ts) — it is a DATA colour, not chrome.
// It happens to equal COLORS.brand today, but must stay a separate,
// literal export: Phase B may change COLORS.brand without touching the
// pass-colour system, and getPassStyle's resolution must not move.
export const PASS_FALLBACK = '#2a7a5a';
