// ─────────────────────────────────────────────────────────────────────
// Wugi — Color Tokens & Theme
// ─────────────────────────────────────────────────────────────────────

export const COLORS = {
  dark: {
    // Surfaces — warm black / parchment palette
    bg:            '#0e0c08',
    card:          '#1a1612',
    surface:       '#131009',
    border:        '#2a241c',
    divider:       '#221d16',

    // Text
    text:          '#e8e3d6',
    subtext:       '#8a7f6f',

    // Brand
    accent:        '#2a7a5a',
    onAccent:      '#f4efe1',

    // Pills / chips
    pill:          '#1a1612',
    pillBorder:    '#2a241c',

    // Status / semantic
    iconAccent:    '#f5a623',  // amber — rating star, warning
    statusWarning: '#f5a623',
    statusDanger:  '#ef4444',

    // Image overlays (stay dark in both themes — they sit on photos)
    overlayStrong: 'rgba(0,0,0,0.75)',
    overlayMedium: 'rgba(0,0,0,0.5)',
    overlaySoft:   'rgba(0,0,0,0.25)',
    onImage:       '#ffffff',
    onImageSoft:   'rgba(255,255,255,0.85)',
    onImageMuted:  'rgba(255,255,255,0.55)',
  },
  light: {
    // Surfaces — warm cream
    bg:            '#faf6ed',
    card:          '#ffffff',
    surface:       '#f0ebde',
    border:        '#e6dfce',
    divider:       '#eee6d6',

    // Text
    text:          '#1a1612',
    subtext:       '#7a705c',

    // Brand (locked across themes)
    accent:        '#2a7a5a',
    onAccent:      '#fbf7ec',

    // Pills / chips
    pill:          '#f0ebde',
    pillBorder:    '#e6dfce',

    // Status / semantic — slightly darker amber for legibility on cream
    iconAccent:    '#c97f00',
    statusWarning: '#c97f00',
    statusDanger:  '#dc2626',

    // Image overlays — stay dark regardless of theme
    overlayStrong: 'rgba(0,0,0,0.75)',
    overlayMedium: 'rgba(0,0,0,0.5)',
    overlaySoft:   'rgba(0,0,0,0.25)',
    onImage:       '#ffffff',
    onImageSoft:   'rgba(255,255,255,0.85)',
    onImageMuted:  'rgba(255,255,255,0.55)',
  },
};

// Derived type — used throughout the app for theme prop typing
export type Theme = typeof COLORS.dark;
