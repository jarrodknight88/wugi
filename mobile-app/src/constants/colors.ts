// ─────────────────────────────────────────────────────────────────────
// Wugi — Color Tokens & Theme
// ─────────────────────────────────────────────────────────────────────

export const COLORS = {
  dark: {
    bg:         '#0a0a0a',
    card:       '#141414',
    surface:    '#0f0f0f',
    border:     '#222',
    text:       '#f0f0f0',
    subtext:    '#666',
    accent:     '#2a7a5a',
    pill:       '#141414',
    pillBorder: '#222',
    divider:    '#1a1a1a',
  },
  light: {
    bg:         '#fafafa',
    card:       '#fff',
    surface:    '#f4f4f4',
    border:     '#eee',
    text:       '#0a0a0a',
    subtext:    '#999',
    accent:     '#2a7a5a',
    pill:       '#f4f4f4',
    pillBorder: '#eee',
    divider:    '#f0f0f0',
  },
};

// Derived type — used throughout the app for theme prop typing
export type Theme = typeof COLORS.dark;
