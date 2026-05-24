// ─────────────────────────────────────────────────────────────────────
// Wugi — useVenueById
// Stop-gap for the EventScreen blank-venue-block bug (2026-05-08): one
// Firestore read on mount to resolve event.venueId → VenueData. Long-term
// fix is to embed venue data in the event query at the feed layer
// (Approach 2 — see memory: approach-2-event-venue-embedding-followup).
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import type { VenueData } from '../types';

export function useVenueById(venueId: string | null): {
  venue: VenueData | null;
  loading: boolean;
} {
  const [venue,   setVenue]   = useState<VenueData | null>(null);
  const [loading, setLoading] = useState<boolean>(!!venueId);

  useEffect(() => {
    let cancelled = false;
    if (!venueId) { setVenue(null); setLoading(false); return; }
    setLoading(true);
    (async () => {
      try {
        const { getFirestore, doc, getDoc } =
          await import('@react-native-firebase/firestore');
        const snap = await getDoc(doc(getFirestore(), 'venues', venueId));
        if (cancelled) return;
        if (!snap.exists) { setVenue(null); setLoading(false); return; }
        const d: any = snap.data();
        setVenue({
          id:              snap.id,
          name:            d.name ?? '',
          category:        d.category ?? d.primaryCategory ?? '',
          address:         d.address ?? '',
          phone:           d.phone ?? d.defaultPhone ?? '',
          website:         d.website ?? d.defaultWebsite ?? '',
          instagram:       d.instagram ?? '',
          logoUrl:         d.logoUrl ?? undefined,
          attributes:      Array.isArray(d.attributes) ? d.attributes : [],
          about:           d.about ?? d.defaultAbout ?? '',
          media:           Array.isArray(d.media) ? d.media : [],
          menuDescription: d.menuDescription ?? '',
          menuAttributes:  Array.isArray(d.menuAttributes) ? d.menuAttributes : [],
          bestSellers:     [],
          upcomingEvents:  [],
          galleries:       [],
        });
        setLoading(false);
      } catch {
        if (cancelled) return;
        setVenue(null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [venueId]);

  return { venue, loading };
}
