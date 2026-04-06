// ─────────────────────────────────────────────────────────────────────
// Wugi — /gallery/[galleryId]
// Public photo gallery page — shareable link from Wugi Lens
// ─────────────────────────────────────────────────────────────────────
import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase-admin'
import GalleryClient from './GalleryClient'
import type { GalleryData, GalleryPhoto } from './types'

export const dynamic = 'force-dynamic'

export default async function GalleryPage({
  params,
}: {
  params: Promise<{ galleryId: string }>
}) {
  const { galleryId } = await params

  const doc = await adminDb.collection('eventGalleries').doc(galleryId).get()
  if (!doc.exists) notFound()

  const data = doc.data()!

  const photosSnap = await adminDb
    .collection('eventGalleries')
    .doc(galleryId)
    .collection('photos')
    .where('approved', '==', true)
    .get()

  const photos: GalleryPhoto[] = photosSnap.docs.map(d => ({
    id:         d.id,
    url:        d.data().url       || '',
    thumbUrl:   d.data().thumbUrl  || d.data().url || '',
    uploadedAt: d.data().uploadedAt?.toDate?.()?.toISOString() || '',
  }))

  const gallery: GalleryData = {
    id:           galleryId,
    eventTitle:   data.eventTitle  || '',
    venueName:    data.venueName   || '',
    eventId:      data.eventId     || '',
    photoCount:   data.photoCount  || photos.length,
    status:       data.status      || 'live',
    createdAt:    data.createdAt?.toDate?.()?.toISOString() || '',
    photos,
  }

  return <GalleryClient gallery={gallery} />
}
