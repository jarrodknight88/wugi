import { NextRequest, NextResponse } from "next/server"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"

export const dynamic = "force-dynamic"

export type VenueIntelPost = {
  id: string
  sourceAccount: string
  postUrl: string
  caption: string
  postedAt: string | null
  likesCount: number
  commentsCount: number
  mediaUrls: string[]
}

export type VenueIntelGroup = {
  sourceAccount: string
  posts: VenueIntelPost[]
}

// GET /api/venue-intel — pending_review posts grouped by sourceAccount
// (groups sorted by post count desc, posts within a group by postedAt
// desc), plus pending/approved/dismissed counts for the header.
export async function GET(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const collection = getAdminDb().collection("venueIntel")

  const [pendingSnap, approvedCount, dismissedCount] = await Promise.all([
    collection.where("status", "==", "pending_review").get(),
    collection.where("status", "==", "approved").count().get(),
    collection.where("status", "==", "dismissed").count().get(),
  ])

  const posts: VenueIntelPost[] = pendingSnap.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      sourceAccount: data.sourceAccount || "",
      postUrl: data.postUrl || "",
      caption: data.caption || "",
      postedAt: data.postedAt?.toDate?.().toISOString() ?? null,
      likesCount: typeof data.likesCount === "number" ? data.likesCount : 0,
      commentsCount: typeof data.commentsCount === "number" ? data.commentsCount : 0,
      mediaUrls: Array.isArray(data.mediaUrls) ? data.mediaUrls : [],
    }
  })

  const bySourceAccount = new Map<string, VenueIntelPost[]>()
  for (const post of posts) {
    const arr = bySourceAccount.get(post.sourceAccount) ?? []
    arr.push(post)
    bySourceAccount.set(post.sourceAccount, arr)
  }

  const groups: VenueIntelGroup[] = Array.from(bySourceAccount.entries())
    .map(([sourceAccount, groupPosts]) => ({
      sourceAccount,
      posts: groupPosts.sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "")),
    }))
    .sort((a, b) => b.posts.length - a.posts.length)

  return NextResponse.json({
    groups,
    counts: {
      pending: posts.length,
      approved: approvedCount.data().count,
      dismissed: dismissedCount.data().count,
    },
  })
}
