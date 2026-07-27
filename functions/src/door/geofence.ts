// ─────────────────────────────────────────────────────────────────────
// Wugi Door — shared geofence utilities.
// venues/{id}.location is live in three shapes — {lat,lng},
// {latitude,longitude}, and docs carrying all four keys — every caller
// must go through extractVenueLatLng() so all three are handled the
// same way everywhere the venue's coordinates are read.
//
// GEOFENCE_RADIUS_METERS must stay in sync with the client-side copy at
// check-in-app/src/hooks/useLocationCheck.ts.
// ─────────────────────────────────────────────────────────────────────
export const GEOFENCE_RADIUS_METERS = 200;

export function extractVenueLatLng(location: unknown): { lat: number; lng: number } | null {
  if (!location || typeof location !== 'object') return null;
  const loc = location as Record<string, unknown>;
  const lat = typeof loc.lat === 'number' ? loc.lat : (typeof loc.latitude === 'number' ? loc.latitude : null);
  const lng = typeof loc.lng === 'number' ? loc.lng : (typeof loc.longitude === 'number' ? loc.longitude : null);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
