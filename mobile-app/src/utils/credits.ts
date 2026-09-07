// ─────────────────────────────────────────────────────────────────────
// Wugi — credit display helpers (issue #282)
//
// Credits are stored server-side and in Firestore as integer HALF-CREDIT
// sub-units (1 credit = 2 half-credits) — never floats. This module is
// the ONLY place the client converts that integer to a display string.
// Mirrors functions/src/unlocks/creditEconomy.ts halfCreditsLabel() BY
// HAND (no shared package between functions/ and mobile-app/) — keep
// both in sync if the copy changes.
// ─────────────────────────────────────────────────────────────────────

// Whole/half-credit split, e.g. 5 half-credits → { whole: 2, half: true }.
export function splitHalfCredits(halfCredits: number): { whole: number; half: boolean } {
  const safe = Number.isFinite(halfCredits) ? Math.max(0, Math.round(halfCredits)) : 0;
  return { whole: Math.floor(safe / 2), half: safe % 2 === 1 };
}

// 1 → "½ credit", 2 → "1 credit", 5 → "2½ credits", 0 → "0 credits".
export function creditsLabel(halfCredits: number): string {
  const { whole, half } = splitHalfCredits(halfCredits);
  if (whole === 0 && half) return '½ credit';
  const amount = `${whole}${half ? '½' : ''}`;
  return `${amount} credit${halfCredits === 2 ? '' : 's'}`;
}

// Short numeric form for tight UI (badges, buttons): "0.5", "1", "2.5".
export function creditsDecimal(halfCredits: number): string {
  const { whole, half } = splitHalfCredits(halfCredits);
  return half ? `${whole}.5` : `${whole}`;
}

export function creditsToHalfCredits(credits: number): number {
  return Math.round(credits * 2);
}
