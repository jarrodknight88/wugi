import { NextRequest, NextResponse } from "next/server"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { cleanDraftTitle } from "@/lib/draftEventText"

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
}

// GET /api/draft-events — draftEvents filtered by status ('draft', the
// default, or 'published' for the Edit Media tab), sorted by date (soonest
// first). draftEvents is server-only (firestore.rules: allow read, write: if
// false) — same lazy-admin pattern as /api/venue-intel.
export async function GET(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const status = new URL(req.url).searchParams.get("status") === "published" ? "published" : "draft"
  const snap = await getAdminDb().collection("draftEvents").where("status", "==", status).get()

  const drafts: DraftEventListItem[] = snap.docs.map((d) => {
    const data = d.data()
    const dateISO: string | null = data.date?.toDate?.()?.toISOString().slice(0, 10) ?? null
    const caption: string = data.caption || ""
    const title: string = data.title || ""
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
      publishedEventId: data.publishedEventId || null,
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
