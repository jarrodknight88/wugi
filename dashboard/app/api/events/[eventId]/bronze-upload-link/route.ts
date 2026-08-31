import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { FieldValue, Timestamp } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireEventWrite, loadEventVenueId } from "@/lib/eventWriteAuth"
import { logAuditServer } from "@/lib/serverAuditLog"

export const dynamic = "force-dynamic"

const WEB_BASE_URL = "https://wugi.us"
const TOKEN_TTL_DAYS = 30

type TokenInfo = {
  token: string
  url: string
  galleryId: string
  active: boolean
  createdAt: string | null
  expiresAt: string | null
  lastUploadAt: string | null
  uploadCount: number
}

function toTokenInfo(id: string, data: FirebaseFirestore.DocumentData): TokenInfo {
  return {
    token: id,
    url: `${WEB_BASE_URL}/upload/${id}`,
    galleryId: data.galleryId || "",
    active: data.active !== false,
    createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
    expiresAt: data.expiresAt?.toDate?.()?.toISOString() || null,
    lastUploadAt: data.lastUploadAt?.toDate?.()?.toISOString() || null,
    uploadCount: data.uploadCount || 0,
  }
}

// GET /api/events/[eventId]/bronze-upload-link — current active link, if any.
// Never mutates. (issue #255: no-hardware bulk-upload fallback/insurance —
// "Bronze" tier photographers bring their own gear instead of a Lens device.)
export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const event = await loadEventVenueId(eventId)
  if (!event.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const auth = await requireEventWrite(req, eventId, event.venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getAdminDb()
  const snap = await db.collection("webUploadTokens")
    .where("eventId", "==", eventId)
    .where("active", "==", true)
    .limit(1)
    .get()

  if (snap.empty) return NextResponse.json({ token: null })
  return NextResponse.json({ token: toTokenInfo(snap.docs[0].id, snap.docs[0].data()) })
}

// POST /api/events/[eventId]/bronze-upload-link — mint a fresh link,
// deactivating any previously-active one for this event (one live link at a
// time keeps revocation simple: sharing a new link always kills the old
// one). Reuses the event's existing eventGalleries doc if one already
// exists (e.g. a Lens device already fed this event) so Bronze uploads land
// in the same gallery rather than splitting it; otherwise creates one now,
// since the Storage-trigger ingest function (ingestWebUpload) needs a
// galleryId available the moment the token is minted, not lazily.
export async function POST(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const event = await loadEventVenueId(eventId)
  if (!event.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const auth = await requireEventWrite(req, eventId, event.venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getAdminDb()
  const eventDoc = await db.collection("events").doc(eventId).get()
  const eventData = eventDoc.data() || {}

  const existingActive = await db.collection("webUploadTokens")
    .where("eventId", "==", eventId)
    .where("active", "==", true)
    .get()

  const batch = db.batch()
  existingActive.docs.forEach(d => batch.update(d.ref, { active: false }))

  let galleryId: string
  const gallerySnap = await db.collection("eventGalleries").where("eventId", "==", eventId).limit(1).get()
  if (!gallerySnap.empty) {
    galleryId = gallerySnap.docs[0].id
  } else {
    const galleryRef = db.collection("eventGalleries").doc()
    galleryId = galleryRef.id
    batch.set(galleryRef, {
      eventId,
      eventTitle: event.title || "",
      venueId: event.venueId || null,
      venueName: eventData.venue || "",
      status: "live",
      source: "web-upload",
      photoCount: 0,
      pendingCount: 0,
      publishedCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  const token = randomUUID()
  const tokenRef = db.collection("webUploadTokens").doc(token)
  const now = Timestamp.now()
  const expiresAt = Timestamp.fromMillis(now.toMillis() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
  batch.set(tokenRef, {
    eventId,
    eventTitle: event.title || "",
    venueId: event.venueId || null,
    venueName: eventData.venue || "",
    galleryId,
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: auth.uid,
    expiresAt,
    lastUploadAt: null,
    uploadCount: 0,
  })

  await batch.commit()

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: "minted_bronze_upload_link",
    targetId: eventId,
    targetName: event.title || eventId,
  })

  const tokenSnap = await tokenRef.get()
  return NextResponse.json({ token: toTokenInfo(token, tokenSnap.data()!) })
}

// DELETE /api/events/[eventId]/bronze-upload-link — revoke the active link.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const event = await loadEventVenueId(eventId)
  if (!event.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const auth = await requireEventWrite(req, eventId, event.venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getAdminDb()
  const snap = await db.collection("webUploadTokens")
    .where("eventId", "==", eventId)
    .where("active", "==", true)
    .get()

  const batch = db.batch()
  snap.docs.forEach(d => batch.update(d.ref, { active: false }))
  await batch.commit()

  await logAuditServer({
    adminId: auth.uid,
    adminEmail: auth.email,
    action: "revoked_bronze_upload_link",
    targetId: eventId,
    targetName: event.title || eventId,
  })

  return NextResponse.json({ ok: true })
}
