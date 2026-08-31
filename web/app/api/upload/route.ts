import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { adminDb, adminStorage, STORAGE_BUCKET } from "@/lib/firebase-admin"

export const dynamic = "force-dynamic"

const MAX_BYTES = 30 * 1024 * 1024
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
}

// POST /api/upload — public, no-Firebase-Auth endpoint behind the token-gated
// drag-and-drop page at /upload/[token] (issue #255). Deliberately dumb:
// checks the token is live, stashes the original bytes under
// web-uploads/{token}/{uuid}.{ext}, and returns immediately — all the real
// work (renditions, EXIF-based capturedAt, writing the eventGalleries photo
// doc) happens off the request path in the ingestWebUpload Storage-trigger
// Cloud Function, so a photographer bulk-dropping 100+ photos isn't stuck
// waiting on sharp for each one.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const token = form?.get("token")
  const file = form?.get("file")

  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Missing upload token" }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 })
  }

  const tokenSnap = await adminDb.collection("webUploadTokens").doc(token).get()
  if (!tokenSnap.exists) return NextResponse.json({ error: "Upload link not found" }, { status: 404 })
  const tokenData = tokenSnap.data()!
  if (tokenData.active === false) return NextResponse.json({ error: "This upload link has been revoked" }, { status: 403 })
  const expiresAt = tokenData.expiresAt?.toDate?.() as Date | undefined
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "This upload link has expired" }, { status: 403 })
  }

  const ext = ALLOWED_TYPES[file.type]
  if (!ext) return NextResponse.json({ error: "Only JPEG, PNG, WEBP, or HEIC/HEIF photos are allowed" }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be 30MB or under" }, { status: 400 })

  const objectPath = `web-uploads/${token}/${randomUUID()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const bucket = adminStorage.bucket(STORAGE_BUCKET)
  await bucket.file(objectPath).save(buffer, { contentType: file.type })

  return NextResponse.json({ ok: true }, { status: 202 })
}
