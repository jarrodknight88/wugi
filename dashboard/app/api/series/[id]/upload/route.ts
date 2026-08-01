import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { getAdminDb, getAdminStorage, STORAGE_BUCKET } from "@/lib/firebase-admin"
import { requireVenueWrite } from "@/lib/venueWriteAuth"
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

// POST /api/series/[id]/upload — direct staff upload for the series Media
// Manager (issue #171 Feature 3b), replacing/absorbing the old single
// cover-image drag-drop (client-direct-to-Storage, image-only, no
// server-side content-type check). Writes to
// published-media/uploads/{seriesId}/{uuid}.{ext} with a
// firebaseStorageDownloadTokens token already attached — "born materialized"
// like publishMedia.ts's copy destination, but this content never passed
// through intel-media/** staging (it didn't come from a scrape), so there's
// no copy step. rightsStatus is 'owner_upload': staff supplied this
// directly, so there's no rights-verification question the way a scraped
// asset has.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const seriesSnap = await getAdminDb().collection("eventSeries").doc(id).get()
  const seriesVenueId: string = seriesSnap.exists ? seriesSnap.data()?.venueId || "" : ""
  // A brand-new series (not yet saved) has no eventSeries doc yet — the
  // client pre-allocates its Firestore id and passes the chosen venue along
  // so upload still works before the first Save. See series/page.tsx
  // openCreate()'s pendingId.
  const queryVenueId = req.nextUrl.searchParams.get("venueId") || ""
  const venueId = seriesVenueId || queryVenueId
  if (!venueId) return NextResponse.json({ error: "No venue selected for this series" }, { status: 400 })

  const auth = await requireVenueWrite(req, venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 })

  const ext = ALLOWED_TYPES[file.type]
  if (!ext) return NextResponse.json({ error: "Only JPEG/PNG/WEBP/GIF images or MP4 video are allowed" }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be 60MB or under" }, { status: 400 })

  const objectPath = `published-media/uploads/${id}/${randomUUID()}.${ext}`
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
    action: "uploaded_series_media",
    targetId: id,
    targetName: (seriesSnap.exists ? seriesSnap.data()?.name : "") || id,
  })

  return NextResponse.json({
    url: downloadUrl(objectPath, token),
    type: file.type.startsWith("video/") ? "video" : "image",
    rightsStatus: "owner_upload",
  })
}
