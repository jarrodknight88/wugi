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

export type VenueIntelNeedsAttentionPost = VenueIntelPost & { classificationReason: string }

export type VenueIntelReasonGroup = {
  reason: string
  count: number
  accountGroups: { sourceAccount: string; posts: VenueIntelNeedsAttentionPost[] }[]
}

function toPost(doc: FirebaseFirestore.QueryDocumentSnapshot): VenueIntelPost {
  const data = doc.data()
  return {
    id: doc.id,
    sourceAccount: data.sourceAccount || "",
    postUrl: data.postUrl || "",
    caption: data.caption || "",
    postedAt: data.postedAt?.toDate?.().toISOString() ?? null,
    likesCount: typeof data.likesCount === "number" ? data.likesCount : 0,
    commentsCount: typeof data.commentsCount === "number" ? data.commentsCount : 0,
    mediaUrls: Array.isArray(data.mediaUrls) ? data.mediaUrls : [],
  }
}

// GET /api/venue-intel — pending_review posts grouped by sourceAccount
// (groups sorted by post count desc, posts within a group by postedAt
// desc), the needs_classification bucket grouped by classificationReason
// then sourceAccount, plus counts for the header.
export async function GET(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const collection = getAdminDb().collection("venueIntel")

  const [pendingSnap, approvedCount, dismissedCount, needsAttentionSnap] = await Promise.all([
    collection.where("status", "==", "pending_review").get(),
    collection.where("status", "==", "approved").count().get(),
    collection.where("status", "==", "dismissed").count().get(),
    collection.where("status", "==", "needs_classification").get(),
  ])

  const posts: VenueIntelPost[] = pendingSnap.docs.map(toPost)

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

  const naPosts: VenueIntelNeedsAttentionPost[] = needsAttentionSnap.docs.map((d) => ({
    ...toPost(d),
    classificationReason: d.data().classificationReason || "unknown",
  }))

  const byReason = new Map<string, Map<string, VenueIntelNeedsAttentionPost[]>>()
  for (const post of naPosts) {
    const accountMap = byReason.get(post.classificationReason) ?? new Map<string, VenueIntelNeedsAttentionPost[]>()
    const arr = accountMap.get(post.sourceAccount) ?? []
    arr.push(post)
    accountMap.set(post.sourceAccount, arr)
    byReason.set(post.classificationReason, accountMap)
  }

  const needsAttention: VenueIntelReasonGroup[] = Array.from(byReason.entries())
    .map(([reason, accountMap]) => {
      const accountGroups = Array.from(accountMap.entries())
        .map(([sourceAccount, groupPosts]) => ({
          sourceAccount,
          posts: groupPosts.sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "")),
        }))
        .sort((a, b) => b.posts.length - a.posts.length)
      return {
        reason,
        count: accountGroups.reduce((sum, g) => sum + g.posts.length, 0),
        accountGroups,
      }
    })
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({
    groups,
    needsAttention,
    counts: {
      pending: posts.length,
      approved: approvedCount.data().count,
      dismissed: dismissedCount.data().count,
      needsAttention: naPosts.length,
    },
  })
}
