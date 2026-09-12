// ─────────────────────────────────────────────────────────────────────
// Wugi — credits.ts
// Display helpers for the credit economy (issue #282). Balances and
// prices are stored EVERYWHERE server-side as integer half-credit units
// (1 credit == 2 units, never a float) — this is the one place the
// client converts that back to the "½ credit" / "1 credit" / "3 credits"
// copy a user actually sees. Never render a raw half-unit number.
// ─────────────────────────────────────────────────────────────────────

export function halfUnitsToCredits(halfUnits: number): number {
  return halfUnits / 2;
}

// "½ credit", "1 credit", "1½ credits", "3 credits" — whole numbers never
// show a trailing ".0", halves always render as the ½ glyph.
export function formatCredits(halfUnits: number): string {
  const whole = Math.floor(halfUnits / 2);
  const hasHalf = halfUnits % 2 === 1;

  let amount: string;
  if (whole === 0 && hasHalf) amount = '½';
  else if (hasHalf) amount = `${whole}½`;
  else amount = `${whole}`;

  const isSingular = halfUnits === 2; // exactly "1 credit"
  return `${amount} credit${isSingular ? '' : 's'}`;
}
