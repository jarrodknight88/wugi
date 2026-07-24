// ─────────────────────────────────────────────────────────────────────
// Wugi — useEventGalleriesByEventId
//
// Resolves an event's gallery from the TOP-LEVEL `galleries` collection by
// gallery.eventId === eventId (Build #74 §2). This is the real Home→Event→
// photo link: events used to show a generic placeholder because gallery.eventId
// was null in prod. Once the eventId backfill (scripts/backfill-gallery-eventid.ts)
// runs, this lights up and EventScreen renders the actual linked gallery.
//
// Returns { gallery: null } when no gallery is linked yet — the caller falls
// back to its existing generic gallery (live eventGalleries / embedded mock).
// One read on mount; builds GalleryData from the newest matched gallery doc's
// images[] and resolves the venue name for the caption.
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import type { GalleryData } from '../types';

export function useEventGalleriesByEventId(eventId: string | null): {
  gallery: GalleryData | null;
  loading: boolean;
} {
  const [gallery, setGallery] = useState<GalleryData | null>(null);
  const [loading, setLoading] = useState<boolean>(!!eventId);

  useEffect(() => {
    let cancelled = false;
    if (!eventId) { setGallery(null); setLoading(false); return; }
    setLoading(true);
    (async () => {
      try {
        const svc = await import('../../firestoreService');
        const docs = await svc.getGalleriesByEvent(eventId);
        if (cancelled) return;
        if (!docs || docs.length === 0) { setGallery(null); setLoading(false); return; }

        // getGalleriesByEvent already returns newest-first; take the canonical
        // (most recent) gallery for this event.
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
          eventId,
        });
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setGallery(null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  return { gallery, loading };
}
