// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — Firebase lib
// ─────────────────────────────────────────────────────────────────────
import auth from '@react-native-firebase/auth'
import firestore from '@react-native-firebase/firestore'
import storage from '@react-native-firebase/storage'
import type { LensEvent, PhotoItem } from '../types'

const db = firestore()

// ── Get active events for today ───────────────────────────────────────
export async function getActiveEvents(): Promise<LensEvent[]> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const snap = await db.collection('events')
    .where('status', '==', 'approved')
    .orderBy('date', 'desc')
    .limit(20)
    .get()

  return snap.docs.map(d => ({
    id:        d.id,
    title:     d.data().title     || 'Untitled Event',
    venueName: d.data().venueName || d.data().venue || '',
    venueId:   d.data().venueId   || '',
    date:      d.data().date      || '',
    status:    'active' as const,
    galleryId: d.data().galleryId || null,
  }))
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

  // Link gallery to event
  await db.collection('events').doc(event.id).update({ galleryId: ref.id })
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

  // Create Firestore doc for this photo
  await db.collection('eventGalleries').doc(galleryId)
    .collection('photos').doc(photoId).set({
      url,
      thumbUrl:       url, // thumb = same for now; CDN resize in v2
      uploadedAt:     firestore.FieldValue.serverTimestamp(),
      photographerId: uid,
      approved:       true,
      width:          0,
      height:         0,
    })

  // Increment photo count
  await db.collection('eventGalleries').doc(galleryId).update({
    photoCount: firestore.FieldValue.increment(1),
    updatedAt:  firestore.FieldValue.serverTimestamp(),
  })

  return { url, thumbUrl: url }
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
