import { NextRequest, NextResponse } from "next/server"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { cleanDraftTitle } from "@/lib/draftEventText"
import { signMediaAssets } from "@/lib/mediaSignedUrls"

export const dynamic = "force-dynamic"

export type DraftEventListItem = {
  id: string
  dateISO: string | null
  title: string
  cleanedTitle: string
  venueId: string
  venueName: string
  caption: string
  sourceAccount: string
  postUrl: string
  likesCount: number
  commentsCount: number
  publishedEventId: string | null
  // Only populated for status: 'published' rows — the LIVE events/{id} doc's
  // title/date/time/hero as of publish (can diverge from the draft's
  // pre-publish caption-derived fields above, see issue #153). Null when the
  // event doc is missing so the row can degrade to the draft fields above
  // with a note, instead of crashing.
  liveTitle: string | null
  liveDate: string | null
  liveTime: string | null
  heroUri: string | null
  eventMissing: boolean
}

function isHttpUrl(uri: string): boolean {
  return /^https?:\/\//i.test(uri)
}

// GET /api/draft-events — draftEvents filtered by status ('draft', the
// default, or 'published' for the Edit Media tab), sorted by date (soonest
// first). draftEvents is server-only (firestore.rules: allow read, write: if
// false) — same lazy-admin pattern as /api/venue-intel.
export async function GET(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const status = new URL(req.url).searchParams.get("status") === "published" ? "published" : "draft"
  const db = getAdminDb()
  const snap = await db.collection("draftEvents").where("status", "==", status).get()

  // Published tab: batch-join each row's live events/{publishedEventId} doc
  // so Title/Date/Hero reflect what Jarrod actually saved at publish time,
  // not the draft's stale pre-publish snapshot.
  const eventIds = status === "published"
    ? Array.from(new Set(
        snap.docs
          .map((d) => d.data().publishedEventId)
          .filter((id): id is string => typeof id === "string" && Boolean(id))
      ))
    : []
  const eventDocs = eventIds.length
    ? await db.getAll(...eventIds.map((id) => db.collection("events").doc(id)))
    : []
  const eventById = new Map(eventDocs.filter((d) => d.exists).map((d) => [d.id, d.data()!]))

  // media[0].uri is normally already a full URL (gallery/venue-hero/signed
  // storage URL, per publish/route.ts) — this only signs the rare case of a
  // raw intel-media storage path slipping through.
  const heroStoragePaths = new Set<string>()
  for (const data of eventById.values()) {
    const uri = Array.isArray(data.media) ? data.media[0]?.uri : undefined
    if (typeof uri === "string" && uri && !isHttpUrl(uri)) heroStoragePaths.add(uri)
  }
  const signedByPath = new Map<string, string>()
  if (heroStoragePaths.size) {
    await Promise.all(
      Array.from(heroStoragePaths).map(async (path) => {
        const [signed] = await signMediaAssets([{ path, type: "image" }])
        if (signed?.url) signedByPath.set(path, signed.url)
      })
    )
  }

  const drafts: DraftEventListItem[] = snap.docs.map((d) => {
    const data = d.data()
    const dateISO: string | null = data.date?.toDate?.()?.toISOString().slice(0, 10) ?? null
    const caption: string = data.caption || ""
    const title: string = data.title || ""
    const publishedEventId: string | null = data.publishedEventId || null

    let liveTitle: string | null = null
    let liveDate: string | null = null
    let liveTime: string | null = null
    let heroUri: string | null = null
    let eventMissing = false
    if (status === "published") {
      const eventData = publishedEventId ? eventById.get(publishedEventId) : undefined
      if (eventData) {
        liveTitle = eventData.title || null
        liveDate = eventData.date || null
        liveTime = eventData.time || null
        const rawUri: string | undefined = Array.isArray(eventData.media) ? eventData.media[0]?.uri : undefined
        if (typeof rawUri === "string" && rawUri) {
          heroUri = isHttpUrl(rawUri) ? rawUri : signedByPath.get(rawUri) || null
        }
      } else {
        eventMissing = true
      }
    }

    return {
      id: d.id,
      dateISO,
      title,
      cleanedTitle: cleanDraftTitle(caption, title || "Untitled event"),
      venueId: data.venueId || "",
      venueName: data.venueName || "",
      caption,
      sourceAccount: data.sourceAttribution?.account || "",
      postUrl: data.sourceAttribution?.postUrl || "",
      likesCount: typeof data.likesCount === "number" ? data.likesCount : 0,
      commentsCount: typeof data.commentsCount === "number" ? data.commentsCount : 0,
      publishedEventId,
      liveTitle,
      liveDate,
      liveTime,
      heroUri,
      eventMissing,
    }
  })

  drafts.sort((a, b) => (a.dateISO ?? "9999").localeCompare(b.dateISO ?? "9999"))

  return NextResponse.json({
    drafts,
    // Config flag for the AI Generate button — never expose the key itself.
    // Checked per-request (not module scope) same as getAdminDb()'s lazy init.
    aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
  })
}
