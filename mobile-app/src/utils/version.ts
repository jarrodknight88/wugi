// ─────────────────────────────────────────────────────────────────────
// Wugi — version comparison
// Dotted numeric version compare (e.g. "5.0.0" vs "5.1.0"). Non-numeric
// segments compare as 0 so malformed input degrades safely rather than
// throwing.
// ─────────────────────────────────────────────────────────────────────

export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.');
  const partsB = b.split('.');
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const numA = parseInt(partsA[i], 10) || 0;
    const numB = parseInt(partsB[i], 10) || 0;
    if (numA !== numB) return numA - numB;
  }
  return 0;
}

export function isVersionBelow(installed: string, minimum: string): boolean {
  return compareVersions(installed, minimum) < 0;
}
