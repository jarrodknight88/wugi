// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — ingestLensUpload (Phase 1 hardware-capture ingest)
//
// Storage trigger on the default bucket. Watches the hardware ingest path
//   lens-ingest/{deviceId}/{galleryId}/{filename}
// written by capture devices (or scripts/lens-simulate-device.js pre-
// hardware). For each new object:
//
//   1. Validates the device: devices/{deviceId} must exist, be active, and
//      its assignment.galleryId must match the path's galleryId. Any
//      mismatch moves the object to lens-quarantine/ and logs a
//      lensQuarantine doc — nothing enters the pending pool.
//   2. Builds sharp renditions: web 1600px @ q80 and thumb 400px, uploaded
//      to lens-renditions/{galleryId}/. The original is preserved untouched
//      in lens-ingest/ for the paid tier (that prefix has no public reads).
//   3. Writes eventGalleries/{galleryId}/photos/{photoId} with
//      status 'pending' (or 'published' when device.mode == 'auto'),
//      capturedAt from EXIF DateTimeOriginal (falls back to the object's
//      timeCreated), and deviceId. `approved` is always written explicitly
//      (false while pending) — consumer surfaces filter approved == true
//      and Firestore silently drops docs missing the field.
//   4. Increments gallery pendingCount / publishedCount (+ the existing
//      photoCount convention on publish), creating the gallery doc from the
//      device assignment if it doesn't exist yet.
//
// Idempotent: photoId is derived deterministically from the object path and
// the doc is created inside a transaction that no-ops on re-delivery.
//
// No new secrets. New deps: sharp (pre-approved) + exif-reader (flagged in
// the Phase 1 PR — tiny zero-dep EXIF parser for sharp's raw EXIF buffer).
// ─────────────────────────────────────────────────────────────────────
import { onObjectFinalized, StorageObjectData } from 'firebase-functions/v2/storage';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import sharp from 'sharp';
import exifReader from 'exif-reader';

const INGEST_PREFIX     = 'lens-ingest/';
const QUARANTINE_PREFIX = 'lens-quarantine/';
const RENDITION_PREFIX  = 'lens-renditions/';

const WEB_WIDTH    = 1600;
const WEB_QUALITY  = 80;
const THUMB_WIDTH  = 400;
const THUMB_QUALITY = 70;

type DeviceDoc = {
  authUid?: string;
  active?: boolean;
  mode?: 'auto' | 'review';
  label?: string;
  assignment?: {
    venueId?: string;
    venueName?: string;
    eventId?: string;
    eventTitle?: string;
    galleryId?: string;
    photographerId?: string;
  };
};

// Deterministic doc id from the storage path so trigger re-deliveries hit
// the same doc (transaction below then no-ops).
function photoIdFor(objectName: string): string {
  const base = path.basename(objectName).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  const hash = crypto.createHash('sha1').update(objectName).digest('hex').slice(0, 8);
  return `${base}_${hash}`;
}

// Tokenized Firebase download URL for an object we just uploaded.
function downloadUrl(bucketName: string, objectPath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

// EXIF DateTimeOriginal via exif-reader; sharp exposes the raw EXIF buffer.
// exif-reader returns { Image, Photo, ... } with JS Dates for datetime tags.
function capturedAtFromExif(exifBuffer: Buffer | undefined): Date | null {
  if (!exifBuffer) return null;
  try {
    const exif: any = exifReader(exifBuffer);
    const raw = exif?.Photo?.DateTimeOriginal || exif?.Image?.DateTime || null;
    if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
    if (typeof raw === 'string') {
      // EXIF format "YYYY:MM:DD HH:MM:SS"
      const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
      if (m) {
        const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
        if (!isNaN(d.getTime())) return d;
      }
    }
  } catch (e) {
    logger.warn('ingestLensUpload: EXIF parse failed, falling back to object timeCreated', e);
  }
  return null;
}

async function quarantine(
  object: StorageObjectData,
  deviceId: string,
  galleryId: string,
  reason: string,
): Promise<void> {
  const db     = admin.firestore();
  const bucket = admin.storage().bucket(object.bucket);
  const destPath = `${QUARANTINE_PREFIX}${deviceId}/${Date.now()}_${path.basename(object.name)}`;

  await bucket.file(object.name).move(destPath);
  await db.collection('lensQuarantine').add({
    reason,
    deviceId,
    galleryId,
    originalPath:    object.name,
    quarantinePath:  destPath,
    size:            Number(object.size) || 0,
    contentType:     object.contentType || null,
    createdAt:       admin.firestore.FieldValue.serverTimestamp(),
  });
  logger.warn(`ingestLensUpload: quarantined ${object.name} → ${destPath} (${reason})`);
}

export const ingestLensUpload = onObjectFinalized(
  { memory: '1GiB', timeoutSeconds: 300, concurrency: 1 },
  async (event) => {
    const object = event.data;
    const name = object.name || '';
    if (!name.startsWith(INGEST_PREFIX)) return;   // renditions/quarantine/other media
    if (!object.contentType?.startsWith('image/')) {
      logger.warn(`ingestLensUpload: non-image upload ignored: ${name} (${object.contentType})`);
      return;
    }

    // lens-ingest/{deviceId}/{galleryId}/{filename} — exactly 4 segments.
    const segments = name.split('/');
    if (segments.length !== 4 || segments.some(s => !s)) {
      await quarantine(object, segments[1] || 'unknown', segments[2] || 'unknown', 'malformed-path');
      return;
    }
    const [, deviceId, galleryId, filename] = segments;

    const db = admin.firestore();
    const deviceSnap = await db.doc(`devices/${deviceId}`).get();
    const device = deviceSnap.data() as DeviceDoc | undefined;

    if (!deviceSnap.exists || !device) {
      await quarantine(object, deviceId, galleryId, 'unknown-device');
      return;
    }
    if (device.active === false) {
      await quarantine(object, deviceId, galleryId, 'device-inactive');
      return;
    }
    if (device.assignment?.galleryId !== galleryId) {
      await quarantine(object, deviceId, galleryId,
        `gallery-mismatch (assigned: ${device.assignment?.galleryId || 'none'})`);
      return;
    }

    const photoId  = photoIdFor(name);
    const photoRef = db.doc(`eventGalleries/${galleryId}/photos/${photoId}`);

    // Cheap idempotency pre-check (transaction re-checks authoritatively).
    if ((await photoRef.get()).exists) {
      logger.info(`ingestLensUpload: ${photoId} already ingested, skipping`);
      return;
    }

    // ── Renditions ───────────────────────────────────────────────────
    const bucket  = admin.storage().bucket(object.bucket);
    const tmpFile = path.join(os.tmpdir(), `lens_${photoId}${path.extname(filename) || '.jpg'}`);
    await bucket.file(name).download({ destination: tmpFile });

    try {
      const meta = await sharp(tmpFile, { failOn: 'none' }).metadata();
      const capturedAt = capturedAtFromExif(meta.exif)
        || (object.timeCreated ? new Date(object.timeCreated) : new Date());

      const webRendition = await sharp(tmpFile, { failOn: 'none' })
        .rotate() // honor EXIF orientation
        .resize({ width: WEB_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: WEB_QUALITY, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      const thumbRendition = await sharp(tmpFile, { failOn: 'none' })
        .rotate()
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      const webPath   = `${RENDITION_PREFIX}${galleryId}/${photoId}_web.jpg`;
      const thumbPath = `${RENDITION_PREFIX}${galleryId}/${photoId}_thumb.jpg`;
      const webToken   = crypto.randomUUID();
      const thumbToken = crypto.randomUUID();

      await Promise.all([
        bucket.file(webPath).save(webRendition.data, {
          contentType: 'image/jpeg',
          metadata: { metadata: { firebaseStorageDownloadTokens: webToken } },
        }),
        bucket.file(thumbPath).save(thumbRendition.data, {
          contentType: 'image/jpeg',
          metadata: { metadata: { firebaseStorageDownloadTokens: thumbToken } },
        }),
      ]);

      const autoPublish = device.mode === 'auto';
      const galleryRef  = db.doc(`eventGalleries/${galleryId}`);
      const assignment  = device.assignment || {};

      await db.runTransaction(async (tx) => {
        const [gallerySnap, existing] = await Promise.all([tx.get(galleryRef), tx.get(photoRef)]);
        if (existing.exists) return;  // duplicate trigger delivery

        if (!gallerySnap.exists) {
          // First photo for this assignment — create the gallery doc so the
          // consumer listener (eventGalleries where eventId==X, status=='live')
          // and web /gallery/[id] light up without manual setup.
          tx.set(galleryRef, {
            eventId:        assignment.eventId    || null,
            eventTitle:     assignment.eventTitle || device.label || 'Wugi Lens',
            venueId:        assignment.venueId    || null,
            venueName:      assignment.venueName  || '',
            photographerId: assignment.photographerId || null,
            status:         'live',
            source:         'lens-device',
            photoCount:     0,
            pendingCount:   0,
            publishedCount: 0,
            createdAt:      admin.firestore.FieldValue.serverTimestamp(),
            updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        tx.set(photoRef, {
          url:            downloadUrl(object.bucket, webPath, webToken),
          thumbUrl:       downloadUrl(object.bucket, thumbPath, thumbToken),
          originalPath:   name,                     // paid-tier original (private prefix)
          width:          webRendition.info.width,
          height:         webRendition.info.height,
          status:         autoPublish ? 'published' : 'pending',
          approved:       autoPublish,              // consumer surfaces filter approved == true
          capturedAt:     admin.firestore.Timestamp.fromDate(capturedAt),
          uploadedAt:     admin.firestore.FieldValue.serverTimestamp(),
          publishedAt:    autoPublish ? admin.firestore.FieldValue.serverTimestamp() : null,
          deviceId,
          galleryId,
          eventId:        assignment.eventId  || null,
          venueId:        assignment.venueId  || null,
          photographerId: assignment.photographerId || null,
          source:         'lens-device',
        });

        tx.set(galleryRef, {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(autoPublish
            ? {
                publishedCount: admin.firestore.FieldValue.increment(1),
                photoCount:     admin.firestore.FieldValue.increment(1),
              }
            : { pendingCount: admin.firestore.FieldValue.increment(1) }),
        }, { merge: true });
      });

      // Ingest heartbeat — best-effort, outside the transaction.
      await db.doc(`devices/${deviceId}`).set({
        lastIngestAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => undefined);

      logger.info(`ingestLensUpload: ${name} → ${photoId} (${autoPublish ? 'published' : 'pending'})`);
    } finally {
      fs.unlink(tmpFile, () => undefined);
    }
  }
);
