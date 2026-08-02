import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { getAdminStorage, STORAGE_BUCKET } from "@/lib/firebase-admin"
import { requireEventWrite, loadEventVenueId } from "@/lib/eventWriteAuth"
import { logAuditServer } from "@/lib/serverAuditLog"

export const dynamic = "force-dynamic"

const MAX_BYTES = 60 * 1024 * 1024
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
}

function downloadUrl(objectPath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`
}

// POST /api/events/[eventId]/upload — direct staff upload for the event
// Media tab (issue #187), same contract as series/[id]/upload/route.ts:
// lands at published-media/uploads/events/{eventId}/{uuid}.{ext} with a
// download token already attached ("born materialized" — this content never
// passed through intel-media/** staging, so there's no copy step).
// rightsStatus is 'owner_upload': staff supplied this directly, so there's
// no rights-verification question the way a scraped asset has.
export async function POST(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const event = await loadEventVenueId(eventId)
  if (!event.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const auth = await requireEventWrite(req, eventId, event.venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 })

  const ext = ALLOWED_TYPES[file.type]
  if (!ext) return NextResponse.json({ error: "Only JPEG/PNG/WEBP/GIF images or MP4 video are allowed" }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be 60MB or under" }, { status: 400 })

  const objectPath = `published-media/uploads/events/${eventId}/${randomUUID()}.${ext}`
  const token = randomUUID()
  const buffer = Buffer.from(await file.arrayBuffer())

  const bucket = getAdminStorage().bucket(STORAGE_BUCKET)
  await bucket.file(objectPath).save(buffer, {
    contentType: file.type,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  })

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: "uploaded_event_media",
    targetId: eventId,
    targetName: event.title || eventId,
  })

  return NextResponse.json({
    url: downloadUrl(objectPath, token),
    type: file.type.startsWith("video/") ? "video" : "image",
    rightsStatus: "owner_upload",
  })
}
