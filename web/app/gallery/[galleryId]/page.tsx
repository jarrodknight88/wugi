// ─────────────────────────────────────────────────────────────────────
// Wugi — /gallery/[galleryId]
// Public photo gallery page — shareable link from Wugi Lens
// ─────────────────────────────────────────────────────────────────────
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import GalleryClient from './GalleryClient'

// ── Firebase Admin init ───────────────────────────────────────────────
function getDb() {
  if (!getApps().length) {
    const sa = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64!, 'base64').toString('utf8')
    )
    initializeApp({ credential: cert(sa) })
  }
  return getFirestore()
}

// ── Types ─────────────────────────────────────────────────────────────
export type GalleryPhoto = {
  id:         string
  url:        string
  thumbUrl:   string
  uploadedAt: string
}

export type GalleryData = {
  id:           string
  eventTitle:   string
  venueName:    string
  eventId:      string
  photoCount:   number
  status:       string
  createdAt:    string
  photos:       GalleryPhoto[]
}

// ── Metadata ──────────────────────────────────────────────────────────
export async function generateMetadata(
  { params }: { params: { galleryId: string } }
): Promise<Metadata> {
  try {
    const db  = getDb()
    const doc = await db.collection('eventGalleries').doc(params.galleryId).get()
    if (!doc.exists) return { title: 'Gallery — Wugi' }
    const d = doc.data()!
    return {
      title:       `${d.eventTitle} — Wugi`,
      description: `${d.photoCount} photos from ${d.eventTitle} at ${d.venueName}`,
      openGraph: {
        title:       `${d.eventTitle} Photos`,
        description: `${d.photoCount} photos from ${d.venueName} · Wugi`,
        siteName:    'Wugi',
      },
    }
  } catch {
    return { title: 'Gallery — Wugi' }
  }
}

// ── Page ──────────────────────────────────────────────────────────────
export default async function GalleryPage(
  { params }: { params: { galleryId: string } }
) {
  const db  = getDb()
  const doc = await db.collection('eventGalleries').doc(params.galleryId).get()
  if (!doc.exists) notFound()

  const data = doc.data()!

  // Fetch all photos
  const photosSnap = await db
    .collection('eventGalleries').doc(params.galleryId)
    .collection('photos')
    .where('approved', '==', true)
    .get()

  const photos: GalleryPhoto[] = photosSnap.docs.map(d => ({
    id:         d.id,
    url:        d.data().url        || '',
    thumbUrl:   d.data().thumbUrl   || d.data().url || '',
    uploadedAt: d.data().uploadedAt?.toDate?.()?.toISOString() || '',
  }))

  const gallery: GalleryData = {
    id:         params.galleryId,
    eventTitle: data.eventTitle  || '',
    venueName:  data.venueName   || '',
    eventId:    data.eventId     || '',
    photoCount: data.photoCount  || photos.length,
    status:     data.status      || 'live',
    createdAt:  data.createdAt?.toDate?.()?.toISOString() || '',
    photos,
  }

  return <GalleryClient gallery={gallery}/>
}
