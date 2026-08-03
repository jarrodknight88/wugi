// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — Firebase lib
// ─────────────────────────────────────────────────────────────────────
import auth from '@react-native-firebase/auth'
import firestore from '@react-native-firebase/firestore'
import storage from '@react-native-firebase/storage'
import type { LensEvent, PendingPhoto, PhotoItem } from '../types'

const db = firestore()

// ── Get active events for today ───────────────────────────────────────
export async function getActiveEvents(): Promise<LensEvent[]> {
  // No orderBy — avoids composite index requirement
  const snap = await db.collection('events')
    .where('status', '==', 'approved')
    .limit(20)
    .get()

  // Sort client-side by createdAt descending
  const docs = snap.docs.map(d => ({
    id:        d.id,
    title:     d.data().title     || 'Untitled Event',
    venueName: d.data().venueName || d.data().venue || '',
    venueId:   d.data().venueId   || '',
    date:      d.data().date      || '',
    status:    'active' as const,
    galleryId: d.data().galleryId || null,
    _createdAt: d.data().createdAt?.toMillis?.() || 0,
  }))

  docs.sort((a, b) => b._createdAt - a._createdAt)
  return docs.map(({ _createdAt, ...rest }) => rest)
}

// ── Create or get gallery for an event ───────────────────────────────
export async function getOrCreateGallery(event: LensEvent): Promise<string> {
  const uid = auth().currentUser?.uid
  if (!uid) throw new Error('Not authenticated')

  // Check if gallery exists
  const existing = await db.collection('eventGalleries')
    .where('eventId', '==', event.id)
    .where('photographerId', '==', uid)
    .limit(1)
    .get()

  if (!existing.empty) return existing.docs[0].id

  // Create new gallery
  const ref = await db.collection('eventGalleries').add({
    eventId:        event.id,
    eventTitle:     event.title,
    venueId:        event.venueId,
    venueName:      event.venueName,
    photographerId: uid,
    status:         'live',
    photoCount:     0,
    createdAt:      firestore.FieldValue.serverTimestamp(),
    updatedAt:      firestore.FieldValue.serverTimestamp(),
  })

  // Note: we skip updating events/{id}.galleryId here since
  // that requires admin write — gallery is linked via eventId field instead
  return ref.id
}

// ── Upload a photo to Firebase Storage ───────────────────────────────
export async function uploadPhoto(
  galleryId: string,
  localUri:  string,
  photoId:   string,
  onProgress: (pct: number) => void
): Promise<{ url: string; thumbUrl: string }> {
  const uid  = auth().currentUser?.uid
  const path = `galleries/${galleryId}/${photoId}.jpg`
  const ref  = storage().ref(path)

  const task = ref.putFile(localUri)

  await new Promise<void>((resolve, reject) => {
    task.on('state_changed',
      snap => onProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
      reject,
      resolve
    )
  })

  const url = await ref.getDownloadURL()

  // Use transaction to create photo doc + increment count atomically
  const galleryRef = db.collection('eventGalleries').doc(galleryId)
  const photoRef   = galleryRef.collection('photos').doc(photoId)

  await db.runTransaction(async tx => {
    tx.set(photoRef, {
      url,
      thumbUrl:       url,
      uploadedAt:     firestore.FieldValue.serverTimestamp(),
      photographerId: uid,
      approved:       true,
      width:          0,
      height:         0,
    })
    tx.update(galleryRef, {
      photoCount: firestore.FieldValue.increment(1),
      updatedAt:  firestore.FieldValue.serverTimestamp(),
    })
  })

  return { url, thumbUrl: url }
}

// ── Lens Phase 1 — pending pool ───────────────────────────────────────
// Hardware-ingested photos land in eventGalleries/{galleryId}/photos with
// status 'pending' (written by the ingestLensUpload Cloud Function). The
// photographerId filter is required: the Firestore read rule only proves
// list queries that either filter approved==true or photographerId==uid.

export function subscribePendingPhotos(
  galleryId: string,
  onChange:  (photos: PendingPhoto[]) => void,
  onError?:  (e: Error) => void,
): () => void {
  const uid = auth().currentUser?.uid
  if (!uid) { onError?.(new Error('Not authenticated')); return () => {} }

  return db.collection('eventGalleries').doc(galleryId)
    .collection('photos')
    .where('status', '==', 'pending')
    .where('photographerId', '==', uid)
    .onSnapshot(snap => {
      const photos: PendingPhoto[] = snap.docs
        .map(d => ({
          id:         d.id,
          url:        d.data().url      || '',
          thumbUrl:   d.data().thumbUrl || d.data().url || '',
          deviceId:   d.data().deviceId || undefined,
          capturedAt: d.data().capturedAt?.toDate?.() || null,
        }))
        // Oldest first — review in capture order.
        .sort((a, b) => (a.capturedAt?.getTime() || 0) - (b.capturedAt?.getTime() || 0))
      onChange(photos)
    }, e => onError?.(e as Error))
}

// Live pending/published counters from the gallery doc (badge on LiveFeed).
export function subscribeGalleryCounts(
  galleryId: string,
  onChange:  (counts: { pendingCount: number; publishedCount: number }) => void,
): () => void {
  return db.collection('eventGalleries').doc(galleryId)
    .onSnapshot(snap => {
      const data = snap.data() || {}
      onChange({
        pendingCount:   data.pendingCount   || 0,
        publishedCount: data.publishedCount || 0,
      })
    }, () => {})
}

// Approve or reject a set of pending photos. Batched (Firestore caps batched
// writes at 500 ops — we chunk at 400 photo updates + 1 gallery counter
// update per batch). Approve publishes into the existing consumer surfaces:
// approved:true is what useEventGallery (mobile) and /gallery/[id] (web)
// filter on; photoCount keeps the existing published-count convention.
export async function moderatePhotos(
  galleryId: string,
  photoIds:  string[],
  action:    'approve' | 'reject',
): Promise<void> {
  const galleryRef = db.collection('eventGalleries').doc(galleryId)
  const CHUNK = 400

  for (let i = 0; i < photoIds.length; i += CHUNK) {
    const chunk = photoIds.slice(i, i + CHUNK)
    const batch = db.batch()

    for (const id of chunk) {
      const ref = galleryRef.collection('photos').doc(id)
      if (action === 'approve') {
        batch.update(ref, {
          status:      'published',
          approved:    true,
          publishedAt: firestore.FieldValue.serverTimestamp(),
        })
      } else {
        batch.update(ref, {
          status:     'rejected',
          approved:   false,
          rejectedAt: firestore.FieldValue.serverTimestamp(),
        })
      }
    }

    batch.set(galleryRef, {
      pendingCount: firestore.FieldValue.increment(-chunk.length),
      ...(action === 'approve' ? {
        publishedCount: firestore.FieldValue.increment(chunk.length),
        photoCount:     firestore.FieldValue.increment(chunk.length),
      } : {}),
      updatedAt: firestore.FieldValue.serverTimestamp(),
    }, { merge: true })

    await batch.commit()
  }
}

// ── Get session photos from Firestore ────────────────────────────────
export async function getSessionPhotos(galleryId: string) {
  const snap = await db.collection('eventGalleries').doc(galleryId)
    .collection('photos')
    .orderBy('uploadedAt', 'desc')
    .limit(50)
    .get()

  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}
