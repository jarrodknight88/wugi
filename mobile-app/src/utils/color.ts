// ─────────────────────────────────────────────────────────────────────
// Wugi — Color helpers
// ─────────────────────────────────────────────────────────────────────

// Converts a 3- or 6-digit hex color to an rgba() string at the given alpha.
// Used to derive theme-matched translucent washes (e.g. the status-bar
// scrim) from theme.bg, which is stored as opaque hex.
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean;
  const int = parseInt(full, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
