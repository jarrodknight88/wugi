import { NextRequest, NextResponse } from "next/server"
import { requireVenueWrite } from "@/lib/venueAuth"
import { getAdminDb } from "@/lib/firebase-admin"
import { cleanDraftAbout } from "@/lib/draftEventText"

export const dynamic = "force-dynamic"

const MODEL = "claude-haiku-4-5-20251001"
const SOURCE_CHAR_CAP = 2000

async function safeQuery(q: FirebaseFirestore.Query): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  try {
    const snap = await q.get()
    return snap.docs
  } catch {
    // Most likely a missing composite index or an empty/never-written
    // collection for this venue — either way, this is best-effort context
    // gathering, never worth failing the whole generate request over.
    return []
  }
}

function venueFallbackAbout(name: string, category: string): string {
  const kind = category.trim() || "nightlife spot"
  return name ? `${name} is a ${kind} on Atlanta's nightlife scene.` : "Add a description for this venue."
}

// GET /api/venues/[venueId]/generate — same list-level aiAvailable flag
// convention as GET /api/draft-events: the dashboard only renders the "✨
// Generate" button when this reports true. POST re-checks independently.
export async function GET(req: NextRequest, { params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params
  const auth = await requireVenueWrite(req, venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  return NextResponse.json({ aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY) })
}

// POST /api/venues/[venueId]/generate — same mechanics as
// /api/draft-events/generate (Anthropic call, JSON-out-of-text parse,
// always a non-AI fallback), pointed at a venue's "about" field instead of
// an event's title+about. Unlike the events route, the caller has no
// source material to hand us — this pulls it server-side from the three
// caption sources the task specified: this venue's `intel` subcollection
// recaps (written by functions/src/intel/onVenueIntelApproved.ts on
// night_observation routing), draftEvents captions matched to this venue
// (the "matched venueIntel captions" — venueIntel posts don't carry
// venueId themselves, draftEvents does once routing resolves one), and
// nightObservations (day-of-week cadence only, no caption text). Falls
// back to venue name/category when none of that exists yet.
export async function POST(req: NextRequest, { params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params
  const auth = await requireVenueWrite(req, venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: "AI generation is not configured" }, { status: 404 })

  const db = getAdminDb()
  const venueSnap = await db.collection("venues").doc(venueId).get()
  if (!venueSnap.exists) return NextResponse.json({ error: "Venue not found" }, { status: 404 })
  const venueData = venueSnap.data()!
  const venueName: string = venueData.name || ""
  const category: string = venueData.category || ""

  const [recapDocs, draftDocs, obsDocs] = await Promise.all([
    safeQuery(db.collection("venues").doc(venueId).collection("intel").where("type", "==", "recap").orderBy("at", "desc").limit(8)),
    safeQuery(db.collection("draftEvents").where("venueId", "==", venueId).orderBy("createdAt", "desc").limit(8)),
    safeQuery(db.collection("nightObservations").where("venueId", "==", venueId).orderBy("date", "desc").limit(20)),
  ])

  const recapCaptions = recapDocs.map((d) => d.data().caption).filter((c): c is string => typeof c === "string" && c.trim().length > 0)
  const draftCaptions = draftDocs.map((d) => d.data().caption).filter((c): c is string => typeof c === "string" && c.trim().length > 0)
  const combinedCaptions = Array.from(new Set([...recapCaptions, ...draftCaptions].map((c) => c.trim()))).slice(0, 6)
  const sourceMaterial = combinedCaptions.join("\n---\n").slice(0, SOURCE_CHAR_CAP)

  const dowCounts = new Map<string, number>()
  for (const d of obsDocs) {
    const dow = d.data().dayOfWeek
    if (typeof dow === "string" && dow) dowCounts.set(dow, (dowCounts.get(dow) || 0) + 1)
  }
  const nightSummary = dowCounts.size
    ? `Observed activity by day: ${Array.from(dowCounts.entries()).sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d} (${c})`).join(", ")}`
    : ""

  const fallback = { about: combinedCaptions.length ? cleanDraftAbout(combinedCaptions[0]) : venueFallbackAbout(venueName, category) }
  if (!sourceMaterial.trim() && !nightSummary) return NextResponse.json(fallback)

  const promptLines = [
    "You write short, upbeat 'about' blurbs for Atlanta nightlife venue listings — a nightlife-editor voice consistent with our event copy (no emoji, no hashtags).",
    `Venue: ${venueName || "unknown"}`,
    `Type: ${category || "unknown"}`,
  ]
  if (sourceMaterial) {
    promptLines.push(
      "Source material (Instagram captions and recap notes — may contain hashtags, emoji, and promo boilerplate to ignore):",
      sourceMaterial
    )
  }
  if (nightSummary) promptLines.push(nightSummary)
  promptLines.push(
    "Write a 2-4 sentence 'about' blurb describing the vibe and what guests can expect (no emoji, no hashtags).",
    'Respond with ONLY a JSON object: {"about":"..."}'
  )
  const prompt = promptLines.join("\n")

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    })

    if (!res.ok) return NextResponse.json({ ...fallback, usedFallback: true })

    const data = await res.json()
    const text: string = data?.content?.[0]?.text || ""
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ ...fallback, usedFallback: true })

    const parsed = JSON.parse(jsonMatch[0])
    const about = typeof parsed.about === "string" && parsed.about.trim() ? parsed.about.trim() : fallback.about
    return NextResponse.json({ about })
  } catch {
    return NextResponse.json({ ...fallback, usedFallback: true })
  }
}
