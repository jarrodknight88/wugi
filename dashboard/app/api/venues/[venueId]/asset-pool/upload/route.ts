import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { FieldValue } from "firebase-admin/firestore"
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
const ALLOWED_TAGS = ["interior", "crowd", "bar", "exterior", "performance"]

function downloadUrl(objectPath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`
}

// POST /api/venues/[venueId]/asset-pool/upload — staff upload straight into
// the evergreen venueAssets pool (issue #269). "Born materialized" like the
// existing venues/[venueId]/upload route: lands directly at
// published-media/uploads/venue-assets/{venueId}/{uuid}.{ext} with a
// download token attached, no intel-media staging/signed-URL step. Every
// upload starts approved:false — an explicit PATCH via
// asset-pool/[assetId] is required before the asset is eligible for
// automatic gallery selection or visible to the consumer app (Firestore
// rules gate reads on approved==true). No separate thumbnail rendition is
// generated (MVP simplification, documented in the PR) — thumbnailUrl
// mirrors url for both images and video; a resize/poster-frame pipeline can
// be added later without changing the schema.
export async function POST(req: NextRequest, { params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params
  const auth = await requireVenueWrite(req, venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getAdminDb()
  const venueSnap = await db.collection("venues").doc(venueId).get()
  if (!venueSnap.exists) return NextResponse.json({ error: "Venue not found" }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 })

  const ext = ALLOWED_TYPES[file.type]
  if (!ext) return NextResponse.json({ error: "Only JPEG/PNG/WEBP/GIF images or MP4 video are allowed" }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be 60MB or under" }, { status: 400 })

  const rawTags = form?.get("tags")
  const tags = typeof rawTags === "string"
    ? rawTags.split(",").map((t) => t.trim()).filter((t) => ALLOWED_TAGS.includes(t))
    : []

  const sourceUrlRaw = form?.get("sourceUrl")
  const sourceUrl = typeof sourceUrlRaw === "string" && sourceUrlRaw.trim() ? sourceUrlRaw.trim() : null

  const objectPath = `published-media/uploads/venue-assets/${venueId}/${randomUUID()}.${ext}`
  const token = randomUUID()
  const buffer = Buffer.from(await file.arrayBuffer())
  const type = file.type.startsWith("video/") ? "video" : "image"

  const bucket = getAdminStorage().bucket(STORAGE_BUCKET)
  await bucket.file(objectPath).save(buffer, {
    contentType: file.type,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  })

  const url = downloadUrl(objectPath, token)
  const now = FieldValue.serverTimestamp()
  const docRef = await db.collection("venueAssets").add({
    venueId,
    type,
    storagePath: objectPath,
    thumbnailPath: objectPath,
    url,
    thumbnailUrl: url,
    approved: false,
    tags,
    sourceUrl,
    approvedBy: null,
    // lastUsedAt must be set at creation, never left absent — the gallery
    // selection query orders by it, and Firestore orderBy silently excludes
    // docs missing the field (see AGENTS.md's Firestore foot-gun section).
    lastUsedAt: now,
    createdAt: now,
  })

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: "uploaded_venue_asset",
    targetId: venueId,
    targetName: venueSnap.data()?.name || venueId,
  })

  return NextResponse.json({ id: docRef.id, url, type })
}
