// ─────────────────────────────────────────────────────────────────────
// Wugi — Uber ride deep link (universal link, no SDK/package).
//
// https://m.uber.com/ul/ opens the Uber app when installed and falls back
// to the mobile web flow in the browser otherwise — Linking.openURL alone
// handles both cases natively, no availability check needed.
// ─────────────────────────────────────────────────────────────────────

export type UberRideDestination = {
  latitude: number;
  longitude: number;
  nickname?: string;
};

export function buildUberRideLink({ latitude, longitude, nickname }: UberRideDestination): string {
  const params = [
    'action=setPickup',
    'pickup=my_location',
    `dropoff[latitude]=${encodeURIComponent(String(latitude))}`,
    `dropoff[longitude]=${encodeURIComponent(String(longitude))}`,
  ];
  if (nickname) {
    params.push(`dropoff[nickname]=${encodeURIComponent(nickname)}`);
  }
  return `https://m.uber.com/ul/?${params.join('&')}`;
}
