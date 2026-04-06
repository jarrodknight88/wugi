// ─────────────────────────────────────────────────────────────────────
// Wugi — /gallery/[galleryId]
// Public photo gallery page — shareable link from Wugi Lens
// ─────────────────────────────────────────────────────────────────────
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase-admin'
import GalleryClient from './GalleryClient'
import type { GalleryData, GalleryPhoto } from './types'

export const dynamic = 'force-dynamic'
export const revalidate = 60 // refresh every 60s for live galleries

// ── Metadata ──────────────────────────────────────────────────────────
export async function generateMetadata(
  { params }: { params: Promise<{ galleryId: string }> }
): Promise<Metadata> {
  try {
    const { galleryId } = await params
    const doc = await adminDb.collection('eventGalleries').doc(galleryId).get()
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
  { params }: { params: Promise<{ galleryId: string }> }
) {
  const { galleryId } = await params
  const doc = await adminDb.collection('eventGalleries').doc(galleryId).get()
  if (!doc.exists) notFound()

  const data = doc.data()!

  const photosSnap = await adminDb
    .collection('eventGalleries').doc(galleryId)
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
