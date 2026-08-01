import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"
import { cleanDraftTitle, cleanDraftAbout } from "@/lib/draftEventText"

export const dynamic = "force-dynamic"

const MODEL = "claude-haiku-4-5-20251001"

// Formats recognized well enough to canonicalize a generated title's word
// order — see applyFormatFirstOrdering below. (#163)
export const KNOWN_FORMATS = [
  "Dinner Party",
  "Day Party",
  "Brunch",
  "Pool Party",
  "Game Night",
  "Trivia Night",
  "Karaoke",
  "Comedy Show",
  "Open Mic",
  "Paint & Sip",
  "Silent Party",
  "Bottomless Brunch",
] as const

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Strip a redundant venue mention from a generated title — the venue is
// always shown on the card itself, so "... at {venue}" / "... @ {venue}" or
// a leading "{venue} presents ..." just repeats it (#163). Tolerates the
// venue's short name (its first word, e.g. "Bamboo" for "Bamboo Atlanta") as
// well as its full name, matching on either.
export function stripVenueFromTitle(title: string, venueName: string): string {
  let result = title.trim()
  const trimmedVenue = venueName.trim()
  if (!trimmedVenue) return result

  const shortName = trimmedVenue.split(/\s+/)[0]
  const candidates = Array.from(new Set([trimmedVenue, shortName].filter(Boolean)))

  for (const name of candidates) {
    const escaped = escapeRegExp(name)
    result = result.replace(new RegExp(`\\s+(?:at|@)\\s+${escaped}\\s*$`, "i"), "")
    result = result.replace(new RegExp(`^${escaped}\\s+presents\\s+`, "i"), "")
  }

  return result.trim()
}

// Longest-first so a suffix match prefers "Bottomless Brunch" over the
// shorter "Brunch" it contains.
const FORMATS_BY_LENGTH_DESC = [...KNOWN_FORMATS].sort((a, b) => b.length - a.length)

// Rewrite "{Theme} {Format}" to "{Format}: {Theme}" for a known event format
// — "Old Kanye Dinner Party" -> "Dinner Party: Old Kanye" (#163). Deliberately
// conservative: a title that IS just a format (no theme prefix), or where the
// format also appears inside the theme portion, is left untouched — a wrong
// rewrite is worse than a missed one.
export function applyFormatFirstOrdering(title: string): string {
  const trimmed = title.trim()
  for (const format of FORMATS_BY_LENGTH_DESC) {
    const escaped = escapeRegExp(format)
    const match = trimmed.match(new RegExp(`^(.+?)\\s+(${escaped})$`, "i"))
    if (!match) continue
    const theme = match[1].trim()
    if (!theme || new RegExp(`\\b${escaped}\\b`, "i").test(theme)) continue
    return `${format}: ${theme}`
  }
  return trimmed
}

// The one post-process applied to EVERY generated title, AI or fallback —
// deterministic string transforms so the rules hold even when the model is
// unavailable, rather than relying on prompt compliance alone (#163).
export function postProcessGeneratedTitle(rawTitle: string, venueName: string): string {
  return applyFormatFirstOrdering(stripVenueFromTitle(rawTitle, venueName))
}

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
//
// An optional draftId (draft mode only) stores the raw generated title/about
// on draftEvents/{draftId} as generatedTitle/generatedAbout — the baseline
// the publish route compares Jarrod's final edit against to build the
// aiFeedback dataset (#163 part 3). Best-effort: a write failure here must
// never break generation itself.
export async function POST(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: "AI generation is not configured" }, { status: 404 })

  const body = await req.json().catch(() => null)
  const mode = body?.mode === "series" ? "series" : "draft"
  const venueName = typeof body?.venueName === "string" ? body.venueName : ""
  const draftId = typeof body?.draftId === "string" ? body.draftId : ""

  async function respond(result: { title: string; about: string; usedFallback?: boolean }) {
    if (mode === "draft" && draftId) {
      try {
        await getAdminDb().collection("draftEvents").doc(draftId).update({
          generatedTitle: result.title,
          generatedAbout: result.about,
          updatedAt: FieldValue.serverTimestamp(),
        })
      } catch {
        // Feedback dataset is best-effort — never break generation over it.
      }
    }
    return NextResponse.json(result)
  }

  let fallback: { title: string; about: string }
  let prompt: string

  if (mode === "series") {
    const day = typeof body?.day === "string" ? body.day : ""
    fallback = {
      title: postProcessGeneratedTitle(
        day ? `${day} Nights at ${venueName || "the venue"}` : venueName ? `${venueName} Series` : "Weekly Series",
        venueName
      ),
      about: `A recurring${day ? ` ${day.toLowerCase()}` : ""} night at ${venueName || "the venue"}.`,
    }
    prompt = [
      "You write short, punchy nightlife event listings for an Atlanta nightlife app.",
      "This is copy for the GENERIC weekly identity of a recurring series — not a one-off special event.",
      `Venue: ${venueName || "unknown"}`,
      `Recurring night: ${day || "unknown"}`,
      "Write a clean, generic series title (no emoji, no hashtags, under 80 characters) and a 1-3 sentence 'about' blurb describing the typical weekly vibe, in an upbeat nightlife voice (no emoji, no hashtags, no mention of any specific guest, artist, or one-off theme — this copy must still make sense for next week and every week after).",
      "Never include the venue name in the title — it's already shown elsewhere on the card.",
      "If the title would otherwise end with a known event format (e.g. 'Trivia Night', 'Dinner Party', 'Karaoke'), lead with the format instead: '{Format}: {Theme}', not '{Theme} {Format}'.",
      'Respond with ONLY a JSON object: {"title":"...","about":"..."}',
    ].join("\n")
  } else {
    const caption = typeof body?.caption === "string" ? body.caption : ""
    const dateISO = typeof body?.dateISO === "string" ? body.dateISO : ""

    fallback = { title: postProcessGeneratedTitle(cleanDraftTitle(caption, "Untitled event"), venueName), about: cleanDraftAbout(caption) }
    if (!caption.trim()) return respond(fallback)

    prompt = [
      "You write short, punchy nightlife event listings for an Atlanta nightlife app.",
      `Venue: ${venueName || "unknown"}`,
      `Date: ${dateISO || "unknown"}`,
      "Instagram caption (source material — may contain hashtags, emoji, and promo boilerplate to ignore):",
      caption.slice(0, 2000),
      "",
      "Write a clean event title (no emoji, no hashtags, under 80 characters) and a 1-3 sentence 'about' blurb in an upbeat nightlife voice (no emoji, no hashtags).",
      "Never include the venue name in the title — it's already shown elsewhere on the card.",
      "If the title would otherwise end with a known event format (e.g. 'Trivia Night', 'Dinner Party', 'Karaoke'), lead with the format instead: '{Format}: {Theme}', not '{Theme} {Format}'.",
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

    if (!res.ok) return respond({ ...fallback, usedFallback: true })

    const data = await res.json()
    const text: string = data?.content?.[0]?.text || ""
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return respond({ ...fallback, usedFallback: true })

    const parsed = JSON.parse(jsonMatch[0])
    const rawTitle = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim().slice(0, 120) : fallback.title
    const title = postProcessGeneratedTitle(rawTitle, venueName)
    const about = typeof parsed.about === "string" && parsed.about.trim() ? parsed.about.trim() : fallback.about
    return respond({ title, about })
  } catch {
    return respond({ ...fallback, usedFallback: true })
  }
}
