// ─────────────────────────────────────────────────────────────────────
// Wugi — color helpers
// ─────────────────────────────────────────────────────────────────────

// "#0e0c08" + 0.85 → "rgba(14, 12, 8, 0.85)". Theme tokens (colors.ts) are
// all 6-digit hex, so that's the only shape handled.
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
