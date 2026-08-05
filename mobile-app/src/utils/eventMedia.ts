// ─────────────────────────────────────────────────────────────────────
// Wugi — event card hero selection
//
// Single source of truth for picking an event CARD's hero/thumbnail image.
// The data pipeline publishes video-post events with media ordered
// video-first (intel.videoUrl posts) — a bare `media[0].uri` breaks any
// <Image> card (a video URL isn't decodable as an image). Card/list
// surfaces (This Weekend, home hero banner, Picks for you, venue profile
// event lists, search results, series/occurrence lists, related-event
// rails, favorites) must all route through this helper instead of reading
// media[0] directly.
//
// The event DETAIL view (EventScreen's media carousel) must NOT use this —
// it renders the full media array in its original order so a video-first
// event still plays the video first when opened.
// ─────────────────────────────────────────────────────────────────────
import type { MediaItem } from '../types';

export function getEventCardHero(media: MediaItem[] | undefined | null): string | undefined {
  const list = media || [];
  if (list.length === 0) return undefined;

  if (list[0]?.type !== 'video') return list[0]?.uri || undefined;

  const firstImage = list.find(m => m?.type === 'image' && !!m.uri);
  if (firstImage) return firstImage.uri;

  // No image anywhere in the array — fall back to the lead video's own
  // poster/thumbnail frame when the data pipeline supplied one. Absent →
  // undefined, so callers render their existing neutral placeholder
  // instead of a broken video-as-image src.
  return list[0]?.posterUri || undefined;
}
