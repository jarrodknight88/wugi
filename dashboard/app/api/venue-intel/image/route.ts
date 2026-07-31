import { NextRequest, NextResponse } from "next/server"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"

export const dynamic = "force-dynamic"

// Instagram/Facebook CDN hosts only. Checked against the parsed hostname
// (never the raw string) so a URL like https://evil.com/cdninstagram.com
// or https://notcdninstagram.com can't slip through.
const ALLOWED_HOSTS = ["cdninstagram.com", "fbcdn.net"]

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))
}

// GET /api/venue-intel/image?src=<encoded IG/FB CDN url> — server-side
// proxy for venue-intel thumbnails. Instagram's CDN blocks cross-site
// hotlinking via referrer checks, so the review page can't load
// venueIntel.mediaUrls directly; this fetches them with no client
// referrer and streams the bytes back.
export async function GET(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const src = req.nextUrl.searchParams.get("src")
  if (!src) return NextResponse.json({ error: "src is required" }, { status: 400 })

  let target: URL
  try {
    target = new URL(src)
  } catch {
    return NextResponse.json({ error: "src is not a valid URL" }, { status: 400 })
  }

  if (target.protocol !== "https:" || !isAllowedHost(target.hostname)) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 400 })
  }

  let upstream: Response
  try {
    // Node's fetch never sends a Referer header on outbound requests, so
    // this alone clears IG's cross-site hotlink check.
    upstream = await fetch(target)
  } catch {
    return NextResponse.json({ error: "Upstream fetch failed" }, { status: 404 })
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Upstream fetch failed" }, { status: 404 })
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  })
}
