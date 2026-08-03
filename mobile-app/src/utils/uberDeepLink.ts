// ─────────────────────────────────────────────────────────────────────
// Wugi — Uber ride deep link
//
// Universal link only — no @uber/rn-sdk or any other package. Opening it
// via Linking.openURL hands off to the Uber app when installed; when it
// isn't, the universal link falls back to the Uber web flow in the browser
// natively (no separate fallback URL needed).
// https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links/introduction
// ─────────────────────────────────────────────────────────────────────

export type RideDropoff = {
  latitude: number;
  longitude: number;
  nickname?: string;
};

export function buildUberRideLink({ latitude, longitude, nickname }: RideDropoff): string {
  const params = [
    'action=setPickup',
    'pickup=my_location',
    `dropoff[latitude]=${encodeURIComponent(latitude)}`,
    `dropoff[longitude]=${encodeURIComponent(longitude)}`,
  ];
  if (nickname) {
    params.push(`dropoff[nickname]=${encodeURIComponent(nickname)}`);
  }
  return `https://m.uber.com/ul/?${params.join('&')}`;
}
