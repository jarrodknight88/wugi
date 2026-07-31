import { NextRequest, NextResponse } from "next/server"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { cleanDraftTitle, cleanDraftAbout } from "@/lib/draftEventText"

export const dynamic = "force-dynamic"

const MODEL = "claude-haiku-4-5-20251001"

// POST /api/draft-events/generate — AI title/about generation. Server route
// only; the key is read lazily inside the handler (never module scope — same
// reasoning as lib/firebase-admin.ts's ensureApp) and never sent to the
// client. The dashboard UI only shows the "AI Generate" button when
// GET /api/draft-events reports aiAvailable:true, but this route re-checks
// independently since it's the actual gate.
//
// Two modes, sharing the model call + JSON-parse plumbing below:
//   - default ("draft"): title/about grounded in this draft's own Instagram
//     caption (existing behavior).
//   - "series": GENERIC weekly-series copy grounded in venue + night-of-week
//     only — no caption input, used for a new series' own identity when
//     publishing a special edition (the series must not inherit the
//     special's one-off theme). Has its own fallback since the caption-
//     derived heuristic (cleanDraftTitle/cleanDraftAbout) has nothing to
//     work with here.
export async function POST(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: "AI generation is not configured" }, { status: 404 })

  const body = await req.json().catch(() => null)
  const mode = body?.mode === "series" ? "series" : "draft"
  const venueName = typeof body?.venueName === "string" ? body.venueName : ""

  let fallback: { title: string; about: string }
  let prompt: string

  if (mode === "series") {
    const day = typeof body?.day === "string" ? body.day : ""
    fallback = {
      title: day ? `${day} Nights at ${venueName || "the venue"}` : (venueName ? `${venueName} Series` : "Weekly Series"),
      about: `A recurring${day ? ` ${day.toLowerCase()}` : ""} night at ${venueName || "the venue"}.`,
    }
    prompt = [
      "You write short, punchy nightlife event listings for an Atlanta nightlife app.",
      "This is copy for the GENERIC weekly identity of a recurring series — not a one-off special event.",
      `Venue: ${venueName || "unknown"}`,
      `Recurring night: ${day || "unknown"}`,
      "Write a clean, generic series title (no emoji, no hashtags, under 80 characters) and a 1-3 sentence 'about' blurb describing the typical weekly vibe, in an upbeat nightlife voice (no emoji, no hashtags, no mention of any specific guest, artist, or one-off theme — this copy must still make sense for next week and every week after).",
      'Respond with ONLY a JSON object: {"title":"...","about":"..."}',
    ].join("\n")
  } else {
    const caption = typeof body?.caption === "string" ? body.caption : ""
    const dateISO = typeof body?.dateISO === "string" ? body.dateISO : ""

    fallback = { title: cleanDraftTitle(caption, "Untitled event"), about: cleanDraftAbout(caption) }
    if (!caption.trim()) return NextResponse.json(fallback)

    prompt = [
      "You write short, punchy nightlife event listings for an Atlanta nightlife app.",
      `Venue: ${venueName || "unknown"}`,
      `Date: ${dateISO || "unknown"}`,
      "Instagram caption (source material — may contain hashtags, emoji, and promo boilerplate to ignore):",
      caption.slice(0, 2000),
      "",
      "Write a clean event title (no emoji, no hashtags, under 80 characters) and a 1-3 sentence 'about' blurb in an upbeat nightlife voice (no emoji, no hashtags).",
      'Respond with ONLY a JSON object: {"title":"...","about":"..."}',
    ].join("\n")
  }

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
    const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim().slice(0, 120) : fallback.title
    const about = typeof parsed.about === "string" && parsed.about.trim() ? parsed.about.trim() : fallback.about
    return NextResponse.json({ title, about })
  } catch {
    return NextResponse.json({ ...fallback, usedFallback: true })
  }
}
