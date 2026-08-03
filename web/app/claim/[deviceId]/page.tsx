// ─────────────────────────────────────────────────────────────────────
// Wugi — /claim/[deviceId]  (Lens Phase 1)
// Public claim page for a hardware capture device: every photo the device
// published in the last 12 hours, mobile-first grid. Guests scan a QR at
// the venue that points here and find themselves from tonight's shots.
//
// Reads via the Admin SDK (rules bypassed) but only ever exposes
// status == 'published' photos — pending/rejected never leave the server.
// ─────────────────────────────────────────────────────────────────────
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import ClaimClient from './ClaimClient'
import type { ClaimData, ClaimPhoto } from './types'

export const dynamic = 'force-dynamic'

const WINDOW_HOURS = 12
const MAX_PHOTOS   = 300

export async function generateMetadata({
  params,
}: {
  params: Promise<{ deviceId: string }>
}): Promise<Metadata> {
  const { deviceId } = await params
  const doc = await adminDb.collection('devices').doc(deviceId).get().catch(() => null)
  const title = doc?.exists
    ? `${doc.data()?.assignment?.eventTitle || 'Tonight'} — your photos on Wugi`
    : 'Your photos on Wugi'
  return { title, description: 'Find and claim your photos from tonight, shot by Wugi Lens.' }
}

function toClaimPhoto(id: string, data: FirebaseFirestore.DocumentData): ClaimPhoto {
  return {
    id,
    url:        data.url      || '',
    thumbUrl:   data.thumbUrl || data.url || '',
    capturedAt: data.capturedAt?.toDate?.()?.toISOString() || '',
  }
}

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ deviceId: string }>
}) {
  const { deviceId } = await params

  const deviceSnap = await adminDb.collection('devices').doc(deviceId).get()
  if (!deviceSnap.exists) notFound()
  const device = deviceSnap.data()!

  const cutoff = Timestamp.fromMillis(Date.now() - WINDOW_HOURS * 60 * 60 * 1000)
  let photos: ClaimPhoto[] = []

  try {
    // Primary: collection-group query across every gallery this device has
    // fed (covers a mid-window reassignment). Requires the photos
    // COLLECTION_GROUP index (deviceId, status, capturedAt DESC) from
    // firebase/firestore.indexes.json.
    const snap = await adminDb
      .collectionGroup('photos')
      .where('deviceId', '==', deviceId)
      .where('status', '==', 'published')
      .where('capturedAt', '>=', cutoff)
      .orderBy('capturedAt', 'desc')
      .limit(MAX_PHOTOS)
      .get()
    photos = snap.docs.map(d => toClaimPhoto(d.id, d.data()))
  } catch {
    // Fallback (composite index not deployed yet): the device's currently
    // assigned gallery only — equality-only query, no composite index needed.
    const galleryId = device.assignment?.galleryId
    if (galleryId) {
      const snap = await adminDb
        .collection('eventGalleries').doc(galleryId)
        .collection('photos')
        .where('deviceId', '==', deviceId)
        .where('status', '==', 'published')
        .limit(MAX_PHOTOS)
        .get()
      photos = snap.docs
        .map(d => toClaimPhoto(d.id, d.data()))
        .filter(p => p.capturedAt && new Date(p.capturedAt).getTime() >= cutoff.toMillis())
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    }
  }

  const claim: ClaimData = {
    deviceId,
    eventTitle: device.assignment?.eventTitle || 'Tonight at Wugi',
    venueName:  device.assignment?.venueName  || '',
    photos,
  }

  return <ClaimClient claim={claim} windowHours={WINDOW_HOURS} />
}
