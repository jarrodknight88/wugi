// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — ingestWebUpload (browser bulk-upload ingest)
//
// Storage trigger on the default bucket. Watches the token-gated web upload
// path
//   web-uploads/{token}/{filename}
// written by web/app/api/upload/route.ts — the public, no-Firebase-Auth
// upload endpoint behind the drag-and-drop page at /upload/[token]. This is
// the no-hardware counterpart to ingestLensUpload.ts: a photographer with
// their own gear (Bronze tier — no Lens device) or a fallback for a
// mis-provisioned/failed device both land photos in the same
// eventGalleries/{galleryId}/photos pool via a dashboard-minted upload link
// instead of a paired capture device.
//
// For each new object:
//   1. Validates the token: webUploadTokens/{token} must exist, be active,
//      and not be past expiresAt. Any failure moves the object to
//      lens-quarantine/ and logs a lensQuarantine doc — nothing enters the
//      gallery. (Mirrors ingestLensUpload's device-validation step; token
//      here plays the role deviceId plays there.)
//   2. Builds the same sharp renditions (web 1600px @ q80, thumb 400px) via
//      the shared helper in photoIngest.ts, uploaded to
//      lens-renditions/{galleryId}/. The original is preserved untouched in
//      web-uploads/ (private prefix, no public reads — same treatment as
//      lens-ingest/).
//   3. Writes eventGalleries/{galleryId}/photos/{photoId} with
//      status 'published' (auto-publish: there's no staff review queue for
//      this path yet, and the whole point is zero-touch — see issue #255),
//      capturedAt from EXIF DateTimeOriginal (falls back to the object's
//      timeCreated) so the gallery page can render photos in shot order
//      regardless of upload order.
//   4. Increments the gallery's publishedCount/photoCount. The gallery doc
//      itself already exists — it's created eagerly when the dashboard
//      mints the upload token (dashboard/app/api/events/[eventId]/
//      bronze-upload-link/route.ts), not lazily here, since the token needs
//      a galleryId to hand the client up front.
//
// Idempotent: photoId is derived deterministically from the object path and
// the doc is created inside a transaction that no-ops on re-delivery.
// ─────────────────────────────────────────────────────────────────────
import { onObjectFinalized, StorageObjectData } from 'firebase-functions/v2/storage';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { photoIdFor, downloadUrl, buildRenditions } from './photoIngest';

const UPLOAD_PREFIX     = 'web-uploads/';
const QUARANTINE_PREFIX = 'lens-quarantine/';

type WebUploadTokenDoc = {
  eventId?: string;
  eventTitle?: string;
  venueId?: string;
  venueName?: string;
  galleryId?: string;
  active?: boolean;
  expiresAt?: admin.firestore.Timestamp;
  createdBy?: string;
};

async function quarantine(
  object: StorageObjectData,
  token: string,
  reason: string,
): Promise<void> {
  const db     = admin.firestore();
  const bucket = admin.storage().bucket(object.bucket);
  const destPath = `${QUARANTINE_PREFIX}web-${token}/${Date.now()}_${path.basename(object.name)}`;

  await bucket.file(object.name).move(destPath);
  await db.collection('lensQuarantine').add({
    reason,
    deviceId:        `web-token:${token}`,
    galleryId:       null,
    originalPath:    object.name,
    quarantinePath:  destPath,
    size:            Number(object.size) || 0,
    contentType:     object.contentType || null,
    createdAt:       admin.firestore.FieldValue.serverTimestamp(),
  });
  logger.warn(`ingestWebUpload: quarantined ${object.name} → ${destPath} (${reason})`);
}

export const ingestWebUpload = onObjectFinalized(
  { memory: '1GiB', timeoutSeconds: 300, concurrency: 1 },
  async (event) => {
    const object = event.data;
    const name = object.name || '';
    if (!name.startsWith(UPLOAD_PREFIX)) return;   // renditions/quarantine/other media
    if (!object.contentType?.startsWith('image/')) {
      logger.warn(`ingestWebUpload: non-image upload ignored: ${name} (${object.contentType})`);
      return;
    }

    // web-uploads/{token}/{filename} — exactly 3 segments.
    const segments = name.split('/');
    if (segments.length !== 3 || segments.some(s => !s)) {
      await quarantine(object, segments[1] || 'unknown', 'malformed-path');
      return;
    }
    const [, token, filename] = segments;

    const db = admin.firestore();
    const tokenSnap = await db.doc(`webUploadTokens/${token}`).get();
    const tokenDoc = tokenSnap.data() as WebUploadTokenDoc | undefined;

    if (!tokenSnap.exists || !tokenDoc) {
      await quarantine(object, token, 'unknown-token');
      return;
    }
    if (tokenDoc.active === false) {
      await quarantine(object, token, 'token-inactive');
      return;
    }
    if (tokenDoc.expiresAt && tokenDoc.expiresAt.toMillis() < Date.now()) {
      await quarantine(object, token, 'token-expired');
      return;
    }
    const galleryId = tokenDoc.galleryId;
    if (!galleryId) {
      await quarantine(object, token, 'token-missing-gallery');
      return;
    }

    const photoId  = photoIdFor(name);
    const photoRef = db.doc(`eventGalleries/${galleryId}/photos/${photoId}`);

    // Cheap idempotency pre-check (transaction re-checks authoritatively).
    if ((await photoRef.get()).exists) {
      logger.info(`ingestWebUpload: ${photoId} already ingested, skipping`);
      return;
    }

    // ── Renditions ───────────────────────────────────────────────────
    const bucket  = admin.storage().bucket(object.bucket);
    const tmpFile = path.join(os.tmpdir(), `web_${photoId}${path.extname(filename) || '.jpg'}`);
    await bucket.file(name).download({ destination: tmpFile });

    try {
      const fallbackCapturedAt = object.timeCreated ? new Date(object.timeCreated) : new Date();
      const {
        webPath, thumbPath, webToken, thumbToken, capturedAt, width, height,
      } = await buildRenditions(bucket, tmpFile, galleryId, photoId, fallbackCapturedAt);

      const galleryRef = db.doc(`eventGalleries/${galleryId}`);

      await db.runTransaction(async (tx) => {
        const existing = await tx.get(photoRef);
        if (existing.exists) return;  // duplicate trigger delivery

        tx.set(photoRef, {
          url:            downloadUrl(object.bucket, webPath, webToken),
          thumbUrl:       downloadUrl(object.bucket, thumbPath, thumbToken),
          originalPath:   name,
          width,
          height,
          status:         'published',
          approved:       true,   // consumer surfaces filter approved == true
          capturedAt:     admin.firestore.Timestamp.fromDate(capturedAt),
          uploadedAt:     admin.firestore.FieldValue.serverTimestamp(),
          publishedAt:    admin.firestore.FieldValue.serverTimestamp(),
          deviceId:       null,
          uploadToken:    token,
          galleryId,
          eventId:        tokenDoc.eventId || null,
          venueId:        tokenDoc.venueId || null,
          photographerId: tokenDoc.createdBy || null,
          source:         'web-upload',
        });

        tx.set(galleryRef, {
          updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
          publishedCount: admin.firestore.FieldValue.increment(1),
          photoCount:     admin.firestore.FieldValue.increment(1),
        }, { merge: true });
      });

      // Ingest heartbeat — best-effort, outside the transaction.
      await db.doc(`webUploadTokens/${token}`).set({
        lastUploadAt: admin.firestore.FieldValue.serverTimestamp(),
        uploadCount:  admin.firestore.FieldValue.increment(1),
      }, { merge: true }).catch(() => undefined);

      logger.info(`ingestWebUpload: ${name} → ${photoId} (published)`);
    } finally {
      fs.unlink(tmpFile, () => undefined);
    }
  }
);
