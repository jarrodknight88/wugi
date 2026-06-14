// ─────────────────────────────────────────────────────────────────────
// Wugi — useEventGalleriesBySeriesId
//
// Resolves a gallery for an event by its recurring-series id, from the
// TOP-LEVEL `galleries` collection (gallery.seriesId === event.seriesId).
// Complements useEventGalleriesByEventId: the eventId link is per-occurrence,
// whereas a series link lets a single backfilled gallery surface on EVERY
// occurrence of that series. EventScreen prefers the more specific paths
// (Lens live → eventId) and falls back to this series path.
//
// Returns { gallery: null } when no gallery carries this seriesId yet — the
// caller treats null as "no series gallery" (real-or-nothing). One read on
// mount; builds GalleryData from the newest matched gallery doc's images[].
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import type { GalleryData } from '../types';

export function useEventGalleriesBySeriesId(seriesId: string | null): {
  gallery: GalleryData | null;
  loading: boolean;
} {
  const [gallery, setGallery] = useState<GalleryData | null>(null);
  const [loading, setLoading] = useState<boolean>(!!seriesId);

  useEffect(() => {
    let cancelled = false;
    if (!seriesId) { setGallery(null); setLoading(false); return; }
    setLoading(true);
    (async () => {
      try {
        const svc = await import('../../firestoreService');
        const docs = await svc.getGalleriesBySeries(seriesId);
        if (cancelled) return;
        if (!docs || docs.length === 0) { setGallery(null); setLoading(false); return; }

        // getGalleriesBySeries already returns newest-first; take the canonical
        // (most recent) gallery for this series.
        const g = docs[0];
        const images = (g.images || []).filter(Boolean);
        const photos = images.map((uri, i) => ({ id: `${g.id}-${i}`, uri, height: 1000 }));

        // Resolve the venue name for the caption / tappable venue line. Best-
        // effort — a missing venue just leaves the caption venue blank.
        let venueName = '';
        if (g.venueId) {
          venueName = (await svc.getVenueById(g.venueId).catch(() => null))?.name || '';
        }
        if (cancelled) return;

        setGallery({
          id: g.id,
          title: g.title || 'Gallery',
          venue: venueName,
          date: g.date || '',
          coverImage: g.coverImage || images[0] || '',
          photos,
          venueId: g.venueId || undefined,
        });
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setGallery(null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [seriesId]);

  return { gallery, loading };
}
