import { NextRequest, NextResponse } from "next/server"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueWrite } from "@/lib/venueWriteAuth"

export const dynamic = "force-dynamic"

const MODEL = "claude-haiku-4-5-20251001"
const SOURCE_CAP = 6
const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

// POST /api/venues/[venueId]/generate — AI "about" generation for the venue
// edit surface's Info tab. Same model/JSON-parse plumbing as
// draft-events/generate/route.ts, pointed at whatever signal exists for this
// venue instead of a single draft's caption:
//   - venues/{venueId}/intel — 'recap' entries appended by
//     onVenueIntelApproved.ts's night_observation branch (functions/src/
//     intel/onVenueIntelApproved.ts), each carrying a caption.
//   - draftEvents where venueId == this venue — captions from posts routing
//     has already matched to this venue. Raw venueIntel posts don't carry a
//     venueId themselves, so this (and the intel subcollection above) is how
//     matched captions actually reach this route.
//   - nightObservations where venueId == this venue — no caption, but its
//     dayOfWeek tally surfaces recurring-night cadence for the prompt.
// Falls back to name/category when none of that exists yet.
export async function POST(req: NextRequest, { params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params
  const auth = await requireVenueWrite(req, venueId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: "AI generation is not configured" }, { status: 404 })

  const db = getAdminDb()
  const venueSnap = await db.collection("venues").doc(venueId).get()
  if (!venueSnap.exists) return NextResponse.json({ error: "Venue not found" }, { status: 404 })
  const venue = venueSnap.data()!
  const venueName: string = venue.name || ""
  const category: string = venue.category || ""

  const [intelSnap, draftSnap, obsSnap] = await Promise.all([
    db.collection("venues").doc(venueId).collection("intel").where("type", "==", "recap").orderBy("at", "desc").limit(SOURCE_CAP).get(),
    db.collection("draftEvents").where("venueId", "==", venueId).orderBy("createdAt", "desc").limit(SOURCE_CAP).get(),
    db.collection("nightObservations").where("venueId", "==", venueId).orderBy("date", "desc").limit(SOURCE_CAP).get(),
  ])

  const captions: string[] = []
  for (const d of intelSnap.docs) {
    const c = d.data()?.caption
    if (typeof c === "string" && c.trim()) captions.push(c.trim())
  }
  for (const d of draftSnap.docs) {
    const c = d.data()?.caption
    if (typeof c === "string" && c.trim()) captions.push(c.trim())
  }

  const dayCounts = new Map<number, number>()
  for (const d of obsSnap.docs) {
    const dow = d.data()?.dayOfWeek
    if (typeof dow === "number") dayCounts.set(dow, (dayCounts.get(dow) || 0) + 1)
  }
  const recurringNights = [...dayCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([dow]) => DOW_NAMES[dow])
    .filter(Boolean)

  const fallback = {
    about: category ? `${venueName} is a ${category.toLowerCase()} spot in Atlanta.` : `${venueName} is a go-to Atlanta nightlife spot.`,
  }
  if (!captions.length && !recurringNights.length && !category) return NextResponse.json(fallback)

  const prompt = [
    "You write short, upbeat 'about' blurbs for Atlanta nightlife venue profiles (no emoji, no hashtags).",
    `Venue: ${venueName || "unknown"}`,
    category ? `Category: ${category}` : "",
    recurringNights.length ? `Known recurring nights: ${recurringNights.join(", ")}` : "",
    captions.length
      ? ["Recent Instagram captions about this venue (source material — ignore hashtags, emoji, and promo boilerplate):", ...captions.map((c) => c.slice(0, 500))].join("\n")
      : "",
    "",
    "Write a 2-4 sentence venue 'about' blurb in an upbeat nightlife voice that captures the overall vibe — not a single one-off event.",
    'Respond with ONLY a JSON object: {"about":"..."}',
  ]
    .filter(Boolean)
    .join("\n")

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
        max_tokens: 300,
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
