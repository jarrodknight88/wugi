// ─────────────────────────────────────────────────────────────────────
// Wugi — Uber ride deep link (universal link, no SDK/package)
//
// https://m.uber.com/ul/ is a universal link: opens the Uber app when
// installed, falls back to the mobile web flow in the browser otherwise —
// no fallback logic needed on our end. Built with manual string
// concatenation rather than URLSearchParams — Hermes has no URL polyfill
// installed (see utils/deepLink.ts) and Uber's documented format uses
// literal `[...]` brackets in the query string, which URLSearchParams
// would percent-encode.
// ─────────────────────────────────────────────────────────────────────

export function buildUberRideLink(
  location: { latitude: number; longitude: number },
  nickname?: string
): string {
  const params = [
    'action=setPickup',
    'pickup=my_location',
    `dropoff[latitude]=${location.latitude}`,
    `dropoff[longitude]=${location.longitude}`,
  ];
  if (nickname) params.push(`dropoff[nickname]=${encodeURIComponent(nickname)}`);
  return `https://m.uber.com/ul/?${params.join('&')}`;
}
