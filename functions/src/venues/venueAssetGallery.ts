// ─────────────────────────────────────────────────────────────────────
// Wugi — Venue Asset Pool: automatic event gallery composition (issue #269)
//
// Decouples event-specific hero media (the scraped Instagram flyer, already
// written to events/{id}.media by the scrape pipeline / draft-events publish
// flow — untouched by this file) from evergreen venue media. Supporting
// gallery imagery is drawn automatically, at event-creation time, from the
// venue's curated venueAssets pool: up to 6 approved assets, weighted toward
// least-recently-used so repeat events at the same venue rotate shots
// instead of repeating them.
//
// Firestore trigger only (fires regardless of which write path created the
// event — scrape script or dashboard draft-events publish) so this needs no
// changes to either producer. Idempotent: skips events that already carry
// galleryAssets (an onUpdate to media/venueId would otherwise recompose a
// gallery that's already rotated its assets' lastUsedAt).
// ─────────────────────────────────────────────────────────────────────
import * as functions from 'firebase-functions';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export const GALLERY_ASSET_LIMIT = 6;

export type GalleryAsset = {
  id: string;
  type: 'image' | 'video';
  url: string;
  thumbnailUrl: string;
  tags: string[];
};

// Selects up to `limit` approved venueAssets for `venueId`, least-recently-used
// first (lastUsedAt ascending — Firestore orderBy excludes docs missing the
// field, so every venueAssets doc must be written with lastUsedAt set at
// creation; enforced by the dashboard upload route). Rotates the selection by
// stamping lastUsedAt = now on every asset picked, so the next event built at
// this venue naturally draws from the remainder first. Graceful degradation:
// a venue with fewer than `limit` approved assets just returns what exists
// (never pads with unapproved media — the query itself excludes them).
export async function selectAndRotateGalleryAssets(venueId: string, limit = GALLERY_ASSET_LIMIT): Promise<GalleryAsset[]> {
  const snap = await db.collection('venueAssets')
    .where('venueId', '==', venueId)
    .where('approved', '==', true)
    .orderBy('lastUsedAt', 'asc')
    .limit(limit)
    .get();

  if (snap.empty) return [];

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  const assets: GalleryAsset[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    batch.update(doc.ref, { lastUsedAt: now });
    assets.push({
      id: doc.id,
      type: data.type === 'video' ? 'video' : 'image',
      url: data.url || '',
      thumbnailUrl: data.thumbnailUrl || data.url || '',
      tags: Array.isArray(data.tags) ? data.tags : [],
    });
  }

  await batch.commit();
  return assets;
}

// onCreate(events/{eventId}) — composes and writes galleryAssets once, right
// after an event doc is created by any producer.
export const composeEventGallery = functions.firestore
  .document('events/{eventId}')
  .onCreate(async (snap) => {
    const event = snap.data();
    if (!event) return;
    if (event.galleryAssets !== undefined) return; // already composed (defensive; onCreate only fires once per doc)

    const venueId = event.venueId;
    if (!venueId || typeof venueId !== 'string') {
      // Hand-seeded / malformed events without a venueId simply get no pool gallery.
      await snap.ref.update({ galleryAssets: [] }).catch(() => {});
      return;
    }

    try {
      const galleryAssets = await selectAndRotateGalleryAssets(venueId);
      await snap.ref.update({ galleryAssets });
    } catch (err) {
      logger.error('composeEventGallery failed', { eventId: snap.id, venueId, err });
    }
  });
