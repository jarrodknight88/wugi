// ─────────────────────────────────────────────────────────────────────
// Wugi — synthetic photo id helpers
//
// Photo entitlements (`favorites`, `unlocks`) reference a photo by the
// synthetic `${galleryId}-${index}` id into a `galleries/{id}.images[]`
// array — there is no per-photo Firestore doc in the live gallery model.
// Split on the FINAL hyphen since gallery ids can themselves contain
// hyphens. Mirrors the inline parse in
// mobile-app/src/navigation/RootNavigator.tsx (openLikedPhoto) and
// functions/src/unlocks/spendFreeUnlock.ts — keep all three in sync.
// ─────────────────────────────────────────────────────────────────────
export function buildPhotoId(galleryId: string, index: number): string {
  return `${galleryId}-${index}`;
}

export function parsePhotoId(photoId: string): { galleryId: string; index: number } | null {
  const m = String(photoId || '').match(/^(.*)-(\d+)$/);
  if (!m) return null;
  return { galleryId: m[1], index: Number(m[2]) };
}
