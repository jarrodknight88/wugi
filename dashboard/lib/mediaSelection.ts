// Shared picker selection/dedupe logic — issue #171 (media selection
// identity fix). Staged mediaAssets options carry a fresh 60-minute v4
// signed `url` on every fetch (see mediaSignedUrls.ts), so keying selection
// off `url` breaks across refetches: selections don't stick, previously
// -saved media never re-shows as selected, and duplicates become possible.
// Every option/selected-item shape here carries an optional stable `path`
// (the underlying Storage object path) — when present it's the identity key;
// stable external URLs (venue hero, gallery photos, uploads) have no `path`
// and fall back to `url`/`uri`, which is already stable for them.
export type SelectedMedia = {
  uri: string
  type: "image" | "video"
  thumbUrl?: string
  rightsStatus?: string
  path?: string
}

export type MediaOptionLike = {
  url: string
  thumbUrl?: string
  type?: "image" | "video"
  rightsStatus?: string
  path?: string
}

export function mediaOptionKey(opt: MediaOptionLike): string {
  return opt.path ?? opt.url
}

export function selectedMediaKey(m: { uri: string; path?: string }): string {
  return m.path ?? m.uri
}

// confirmUnverified defaults to always-allow so this stays pure/testable;
// callers wire it to a real confirm() prompt (see DraftEventsPanel.tsx).
export function toggleSelectedMedia(
  current: SelectedMedia[],
  opt: MediaOptionLike,
  confirmUnverified: () => boolean = () => true
): SelectedMedia[] {
  const key = mediaOptionKey(opt)
  const already = current.some((m) => selectedMediaKey(m) === key)
  if (already) return current.filter((m) => selectedMediaKey(m) !== key)
  if (opt.rightsStatus === "unverified" && !confirmUnverified()) return current
  return [...current, { uri: opt.url, type: opt.type === "video" ? "video" : "image", thumbUrl: opt.thumbUrl, rightsStatus: opt.rightsStatus, path: opt.path }]
}

export function reorderSelectedMedia<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items
  const copy = [...items]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}
