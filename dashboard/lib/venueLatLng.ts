// Local mirror of functions/src/door/geofence.ts's extractVenueLatLng.
// venues/{id}.location is live in three shapes — {lat,lng}, {latitude,longitude},
// and docs carrying all four keys — every caller must go through this helper.
// Duplicated (not imported) because dashboard/ and functions/ are separate
// TypeScript packages with independent builds; functions/ is out of scope
// for this change. Keep in sync manually if the venue location shape changes.
export function extractVenueLatLng(location: unknown): { lat: number; lng: number } | null {
  if (!location || typeof location !== "object") return null
  const loc = location as Record<string, unknown>
  const lat = typeof loc.lat === "number" ? loc.lat : typeof loc.latitude === "number" ? loc.latitude : null
  const lng = typeof loc.lng === "number" ? loc.lng : typeof loc.longitude === "number" ? loc.longitude : null
  if (lat === null || lng === null) return null
  return { lat, lng }
}
