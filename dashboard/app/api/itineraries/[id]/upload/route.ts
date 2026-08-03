import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { getAdminStorage, STORAGE_BUCKET } from "@/lib/firebase-admin"
import { requireItineraryWrite } from "@/lib/itineraryWriteAuth"
import { logAuditServer } from "@/lib/serverAuditLog"

export const dynamic = "force-dynamic"

const MAX_BYTES = 60 * 1024 * 1024
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
}

function downloadUrl(objectPath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`
}

// POST /api/itineraries/[id]/upload — direct staff upload for the
// itinerary hero image, same contract as series/[id]/upload/route.ts and
// events/[eventId]/upload/route.ts: lands at
// published-media/uploads/itineraries/{id}/{uuid}.{ext} with a download
// token already attached. `id` is client-pre-allocated for a brand-new
// itinerary (mirrors series/page.tsx's pendingId — no Firestore doc needs to
// exist yet since itineraries aren't venue/event scoped, so unlike those two
// routes there's no doc lookup here). Images only — this is a single hero
// image, not a gallery.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireItineraryWrite(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 })

  const ext = ALLOWED_TYPES[file.type]
  if (!ext) return NextResponse.json({ error: "Only JPEG/PNG/WEBP/GIF images are allowed" }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be 60MB or under" }, { status: 400 })

  const objectPath = `published-media/uploads/itineraries/${id}/${randomUUID()}.${ext}`
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
    action: "uploaded_itinerary_media",
    targetId: id,
    targetName: id,
  })

  return NextResponse.json({
    url: downloadUrl(objectPath, token),
    type: "image",
    rightsStatus: "owner_upload",
  })
}
