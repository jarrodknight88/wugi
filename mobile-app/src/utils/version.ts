// ─────────────────────────────────────────────────────────────────────
// Wugi — version.ts
// Dotted-numeric version compare for the min-version forced-update gate.
// Missing/non-numeric segments compare as 0 so "5.0" < "5.0.1".
// ─────────────────────────────────────────────────────────────────────

export function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map((n) => parseInt(n, 10) || 0);
  const bParts = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function isVersionBelow(version: string, minVersion: string): boolean {
  return compareVersions(version, minVersion) < 0;
}
