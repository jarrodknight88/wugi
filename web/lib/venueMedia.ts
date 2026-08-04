// venues.media is migrating from a flat string[] to a typed
// {uri,type,rightsStatus}[] shape (issue #238 — dashboard/app/api/venues/
// [venueId]/media/route.ts PATCH now writes typed objects so venue videos
// render, mirroring events). Existing docs still hold legacy strings until
// scripts/backfill-venue-media-types.js runs, and this public site only
// ever needs the plain uri (no video playback here), so every reader
// normalizes through this at the boundary rather than assuming string[].
export function normalizeVenueMediaUris(media: unknown): string[] {
  if (!Array.isArray(media)) return []
  return media
    .map((m) => (typeof m === "string" ? m : (m as { uri?: unknown })?.uri))
    .filter((uri): uri is string => typeof uri === "string" && !!uri)
}
