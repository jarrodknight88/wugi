import { NextRequest, NextResponse } from "next/server"
import { getAdminDb } from "@/lib/firebase-admin"
import { requireVenueIntelStaff } from "@/lib/venueIntelAuth"

export const dynamic = "force-dynamic"

export type VenueIntelPost = {
  id: string
  sourceAccount: string
  // The IG profile a targeted scrape was actually pointed at (see
  // functions/src/bridge/apifyWebhook.ts's parseSeedAccountFromInputUrl) —
  // empty for the scheduled seed-list scrape, where it's redundant with
  // sourceAccount. Handle filter (venue-intel page) falls back to
  // sourceAccount when this is empty.
  seedAccount: string
  postUrl: string
  caption: string
  postedAt: string | null
  likesCount: number
  commentsCount: number
  mediaUrls: string[]
  // SafeSearch moderation (issue #170) — worst-of across this post's
  // mediaAssets/{id} doc's assets (flagged > unscanned > clear), or null
  // when there's no mediaAssets doc yet (e.g. a text-only post, or media
  // persistence hasn't landed for it). Only flagged/unscanned render a
  // badge client-side.
  moderationStatus: "clear" | "flagged" | "unscanned" | null
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

function toPost(doc: FirebaseFirestore.QueryDocumentSnapshot, moderationById: Map<string, VenueIntelPost["moderationStatus"]>): VenueIntelPost {
  const data = doc.data()
  return {
    id: doc.id,
    sourceAccount: data.sourceAccount || "",
    seedAccount: data.seedAccount || "",
    postUrl: data.postUrl || "",
    caption: data.caption || "",
    postedAt: data.postedAt?.toDate?.().toISOString() ?? null,
    likesCount: typeof data.likesCount === "number" ? data.likesCount : 0,
    commentsCount: typeof data.commentsCount === "number" ? data.commentsCount : 0,
    mediaUrls: Array.isArray(data.mediaUrls) ? data.mediaUrls : [],
    moderationStatus: moderationById.get(doc.id) ?? null,
  }
}

// mediaAssets/{id} is keyed by the SAME id as its venueIntel doc (see
// persistNewIntelMedia in functions/src/bridge/apifyWebhook.ts) — worst-of
// across its `assets` array: any flagged asset flags the whole post; else
// any non-clear (unscanned, or missing moderationStatus — pre-#170 docs)
// marks it unscanned; else clear. A post with no mediaAssets doc at all (no
// media, or media persistence hasn't run for it yet) maps to null — no
// badge to show.
function aggregateModerationStatus(data: FirebaseFirestore.DocumentData | undefined): VenueIntelPost["moderationStatus"] {
  const assets = Array.isArray(data?.assets) ? data!.assets : []
  if (assets.length === 0) return null
  const statuses = assets.map((a: unknown) => (a as { moderationStatus?: unknown })?.moderationStatus)
  if (statuses.some((s: unknown) => s === "flagged")) return "flagged"
  if (statuses.some((s: unknown) => s !== "clear")) return "unscanned"
  return "clear"
}

// GET /api/venue-intel — pending_review posts grouped by sourceAccount
// (groups sorted by post count desc, posts within a group by postedAt
// desc), the needs_classification bucket grouped by classificationReason
// then sourceAccount, plus counts for the header.
export async function GET(req: NextRequest) {
  const auth = await requireVenueIntelStaff(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getAdminDb()
  const collection = db.collection("venueIntel")

  const [pendingSnap, approvedCount, dismissedCount, needsAttentionSnap] = await Promise.all([
    collection.where("status", "==", "pending_review").get(),
    collection.where("status", "==", "approved").count().get(),
    collection.where("status", "==", "dismissed").count().get(),
    collection.where("status", "==", "needs_classification").get(),
  ])

  // Chunked (same 300-ref-per-call caution as functions/src/bridge/
  // apifyWebhook.ts's WRITE_BATCH_SIZE) — the review queue can grow
  // unbounded while unattended, and getAll's single-request size isn't
  // meant for thousands of refs at once.
  const moderationById = new Map<string, VenueIntelPost["moderationStatus"]>()
  const idsNeedingModeration = [...pendingSnap.docs, ...needsAttentionSnap.docs].map((d) => d.id)
  const MODERATION_LOOKUP_CHUNK = 300
  for (let i = 0; i < idsNeedingModeration.length; i += MODERATION_LOOKUP_CHUNK) {
    const chunk = idsNeedingModeration.slice(i, i + MODERATION_LOOKUP_CHUNK)
    const mediaAssetSnaps = await db.getAll(...chunk.map((id) => db.collection("mediaAssets").doc(id)))
    for (const snap of mediaAssetSnaps) {
      moderationById.set(snap.id, aggregateModerationStatus(snap.exists ? snap.data() : undefined))
    }
  }

  const posts: VenueIntelPost[] = pendingSnap.docs.map((d) => toPost(d, moderationById))

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
    ...toPost(d, moderationById),
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
