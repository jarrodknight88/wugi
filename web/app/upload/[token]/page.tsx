// ─────────────────────────────────────────────────────────────────────
// Wugi — /upload/[token]
// Public, no-login drag-and-drop bulk upload page (issue #255). The link
// is minted by staff from the dashboard event page (Bronze upload link
// panel) and resolves here via the Admin SDK — invalid/revoked/expired
// tokens 404 rather than exposing which reason.
// ─────────────────────────────────────────────────────────────────────
import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase-admin'
import UploadClient from './UploadClient'

export const dynamic = 'force-dynamic'

export default async function UploadPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const doc = await adminDb.collection('webUploadTokens').doc(token).get()
  if (!doc.exists) notFound()

  const data = doc.data()!
  if (data.active === false) notFound()
  const expiresAt = data.expiresAt?.toDate?.() as Date | undefined
  if (expiresAt && expiresAt.getTime() < Date.now()) notFound()

  return (
    <UploadClient
      token={token}
      eventTitle={data.eventTitle || 'your event'}
      venueName={data.venueName || ''}
      galleryId={data.galleryId || ''}
    />
  )
}
