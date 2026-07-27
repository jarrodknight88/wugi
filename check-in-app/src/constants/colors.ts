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
  bg:      '#0e0c08',
  card:    '#1a1612',
  card2:   '#231e18',
  surface: '#131009',
  border:  '#2a241c',
  divider: '#221d16',

  // Text
  text:    '#f4efe1',
  subtext: '#9a8f7c',

  // Brand
  brand:   '#2a7a5a',
  onBrand: '#f4efe1',

  // Status / semantic
  go:       '#2bd46a',
  goDeep:   '#0e3d22',
  stop:     '#fb4b3e',
  stopDeep: '#3d130f',
  warn:     '#f5b73d',
  warnDeep: '#3a2c0c',
  info:     '#43b4e0',
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
