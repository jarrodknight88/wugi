// Client-side mirror of functions/src/bridge/runTargetedScrape.ts's
// normalizeInstagramHandle — same IG username charset + @handle/profile-URL
// rules, kept in sync manually (dashboard and functions are separate deploy
// targets, no shared package). Used by ScrapeProfileControl so bad input is
// caught before the authed POST instead of round-tripping to the function.
const IG_USERNAME_REGEX = /^[A-Za-z0-9._]{1,30}$/

function extractHandleFromProfileUrl(value: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) return null
  const [username] = parsed.pathname.split("/").filter(Boolean)
  return username ?? null
}

export function normalizeInstagramHandle(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let candidate: string
  if (/^https?:\/\//i.test(trimmed)) {
    const fromUrl = extractHandleFromProfileUrl(trimmed)
    if (!fromUrl) return null
    candidate = fromUrl
  } else {
    candidate = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed
  }

  return IG_USERNAME_REGEX.test(candidate) ? candidate : null
}

export const TARGET_TYPES = ["venue", "event", "influencer", "other"] as const
export type TargetType = (typeof TARGET_TYPES)[number]
