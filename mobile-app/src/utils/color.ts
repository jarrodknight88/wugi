// ─────────────────────────────────────────────────────────────────────
// Wugi — color helpers.
// ─────────────────────────────────────────────────────────────────────

// "#0e0c08" + 0.85 → "rgba(14,12,8,0.85)". Used to derive a semi-opaque
// wash from a theme's solid `bg` token (dark → black wash, light → beige
// wash) instead of hardcoding one tint for both themes.
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
