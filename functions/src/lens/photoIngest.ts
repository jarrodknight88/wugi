// ─────────────────────────────────────────────────────────────────────
// Wugi Lens/Web — shared photo-ingest helpers
//
// Rendition-building, EXIF-date extraction, deterministic photo ids, and
// tokenized download URLs used by both Storage-trigger ingest functions:
//   - ingestLensUpload.ts  (hardware capture devices, lens-ingest/**)
//   - ingestWebUpload.ts   (token-gated browser bulk upload, web-uploads/**)
// Extracted so the two paths stay byte-for-byte consistent on rendition
// sizing/quality and EXIF parsing rather than drifting independently.
// ─────────────────────────────────────────────────────────────────────
import * as logger from 'firebase-functions/logger';
import * as crypto from 'crypto';
import * as path from 'path';
import sharp from 'sharp';
import exifReader from 'exif-reader';

export const RENDITION_PREFIX = 'lens-renditions/';

const WEB_WIDTH     = 1600;
const WEB_QUALITY   = 80;
const THUMB_WIDTH    = 400;
const THUMB_QUALITY  = 70;

// Deterministic doc id from the storage path so trigger re-deliveries hit
// the same doc (the caller's transaction then no-ops on the pre-existing doc).
export function photoIdFor(objectName: string): string {
  const base = path.basename(objectName).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  const hash = crypto.createHash('sha1').update(objectName).digest('hex').slice(0, 8);
  return `${base}_${hash}`;
}

// Tokenized Firebase download URL for an object we just uploaded.
export function downloadUrl(bucketName: string, objectPath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

// EXIF DateTimeOriginal via exif-reader; sharp exposes the raw EXIF buffer.
// exif-reader returns { Image, Photo, ... } with JS Dates for datetime tags.
export function capturedAtFromExif(exifBuffer: Buffer | undefined): Date | null {
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
    logger.warn('photoIngest: EXIF parse failed, falling back to caller default', e);
  }
  return null;
}

export type Renditions = {
  webPath: string;
  thumbPath: string;
  webToken: string;
  thumbToken: string;
  capturedAt: Date;
  width: number;
  height: number;
};

// Builds the web (1600px) and thumb (400px) JPEG renditions for a downloaded
// original at `tmpFile`, uploads both to lens-renditions/{galleryId}/, and
// returns their tokenized paths plus the EXIF-derived (or fallback)
// capture date. Orientation is normalized via sharp's `.rotate()` (honors
// EXIF orientation) on both renditions.
export async function buildRenditions(
  bucket: import('@google-cloud/storage').Bucket,
  tmpFile: string,
  galleryId: string,
  photoId: string,
  fallbackCapturedAt: Date,
): Promise<Renditions> {
  const meta = await sharp(tmpFile, { failOn: 'none' }).metadata();
  const capturedAt = capturedAtFromExif(meta.exif) || fallbackCapturedAt;

  const webRendition = await sharp(tmpFile, { failOn: 'none' })
    .rotate()
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

  return {
    webPath, thumbPath, webToken, thumbToken, capturedAt,
    width: webRendition.info.width,
    height: webRendition.info.height,
  };
}
