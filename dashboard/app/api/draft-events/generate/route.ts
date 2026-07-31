import { NextRequest, NextResponse } from "next/server"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { cleanDraftTitle, cleanDraftAbout } from "@/lib/draftEventText"

export const dynamic = "force-dynamic"

const MODEL = "claude-haiku-4-5-20251001"

// POST /api/draft-events/generate — AI title/about generation from
// caption+venue+date. Server route only; the key is read lazily inside the
// handler (never module scope — same reasoning as lib/firebase-admin.ts's
// ensureApp) and never sent to the client. The dashboard UI only shows the
// "AI Generate" button when GET /api/draft-events reports aiAvailable:true,
// but this route re-checks independently since it's the actual gate.
export async function POST(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: "AI generation is not configured" }, { status: 404 })

  const body = await req.json().catch(() => null)
  const caption = typeof body?.caption === "string" ? body.caption : ""
  const venueName = typeof body?.venueName === "string" ? body.venueName : ""
  const dateISO = typeof body?.dateISO === "string" ? body.dateISO : ""

  const fallback = { title: cleanDraftTitle(caption, "Untitled event"), about: cleanDraftAbout(caption) }
  if (!caption.trim()) return NextResponse.json(fallback)

  const prompt = [
    "You write short, punchy nightlife event listings for an Atlanta nightlife app.",
    `Venue: ${venueName || "unknown"}`,
    `Date: ${dateISO || "unknown"}`,
    "Instagram caption (source material — may contain hashtags, emoji, and promo boilerplate to ignore):",
    caption.slice(0, 2000),
    "",
    "Write a clean event title (no emoji, no hashtags, under 80 characters) and a 1-3 sentence 'about' blurb in an upbeat nightlife voice (no emoji, no hashtags).",
    'Respond with ONLY a JSON object: {"title":"...","about":"..."}',
  ].join("\n")

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
