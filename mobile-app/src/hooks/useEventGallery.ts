// ─────────────────────────────────────────────────────────────────────
// Wugi — useEventGallery
// Real-time listener for event gallery photos from Wugi Lens uploads
// ─────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import firestore from '@react-native-firebase/firestore'
import type { GalleryData, GalleryPhoto } from '../types'

export function useEventGallery(eventId: string | null): {
  gallery: GalleryData | null
  loading: boolean
  photoCount: number
} {
  const [gallery,    setGallery]    = useState<GalleryData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [photoCount, setPhotoCount] = useState(0)

  useEffect(() => {
    if (!eventId) { setLoading(false); return }

    // Listen for gallery doc
    const galleryUnsub = firestore()
      .collection('eventGalleries')
      .where('eventId', '==', eventId)
      .where('status', '==', 'live')
      .limit(1)
      .onSnapshot(snap => {
        if (snap.empty) { setLoading(false); return }

        const doc   = snap.docs[0]
        const data  = doc.data()
        const count = data.photoCount || 0
        setPhotoCount(count)

        const photosUnsub = firestore()
          .collection('eventGalleries').doc(doc.id)
          .collection('photos')
          .where('approved', '==', true)
          .limit(30)
          .onSnapshot(photoSnap => {
            // Use actual doc count as the source of truth
            setPhotoCount(photoSnap.size)
            const photos: GalleryPhoto[] = photoSnap.docs
              .map(d => ({
                id:          d.id,
                uri:         d.data().url || d.data().thumbUrl || '',
                height:      d.data().height || 300,
                _uploadedAt: d.data().uploadedAt?.toMillis?.() || 0,
              }))
              .sort((a, b) => b._uploadedAt - a._uploadedAt)
              .map(({ _uploadedAt, ...rest }) => rest as GalleryPhoto)

            setGallery({
              id:         doc.id,
              title:      data.eventTitle || 'Gallery',
              venue:      data.venueName  || '',
              date:       data.createdAt?.toDate?.()?.toLocaleDateString() || '',
              coverImage: photos[0]?.uri || '',
              photos,
            })
            setLoading(false)
          }, () => setLoading(false))

        return () => photosUnsub()
      }, () => setLoading(false))

    return () => galleryUnsub()
  }, [eventId])

  return { gallery, loading, photoCount }
}
