import { NextRequest, NextResponse } from "next/server"
import { adminDb } from "@/lib/firebase-admin"
import { requireStaff, UnauthorizedError } from "@/lib/venueIntelAuth"
import { VENUE_INTEL_SEED_ACCOUNTS_SET } from "@/lib/venueIntelSeedAccounts"

export type VenueIntelPost = {
  id: string
  sourceAccount: string
  postUrl: string
  caption: string
  postedAt: number | null
  likesCount: number
  commentsCount: number
  mediaUrls: string[]
}

export type DiscoveredAccount = {
  handle: string
  count: number
  sampleCaption: string
}

const VENUE_INTEL = "venueIntel"

export async function GET(req: NextRequest) {
  try {
    await requireStaff(req)
  } catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  const col = adminDb.collection(VENUE_INTEL)

  const [pendingSnap, approvedCount, dismissedCount, allSnap, accountsSnap] = await Promise.all([
    col.where("status", "==", "pending_review").get(),
    col.where("status", "==", "approved").count().get(),
    col.where("status", "==", "dismissed").count().get(),
    col.select("sourceAccount", "caption").get(),
    adminDb.collection("venueIntelAccounts").get(),
  ])

  const pending: VenueIntelPost[] = pendingSnap.docs.map(d => {
    const data = d.data()
    return {
      id: d.id,
      sourceAccount: data.sourceAccount || "",
      postUrl: data.postUrl || "",
      caption: data.caption || "",
      postedAt: data.postedAt?.toMillis?.() ?? null,
      likesCount: typeof data.likesCount === "number" ? data.likesCount : 0,
      commentsCount: typeof data.commentsCount === "number" ? data.commentsCount : 0,
      mediaUrls: Array.isArray(data.mediaUrls) ? data.mediaUrls : [],
    }
  })

  const byAccount = new Map<string, { count: number; sampleCaption: string }>()
  allSnap.docs.forEach(d => {
    const data = d.data()
    const handle = typeof data.sourceAccount === "string" ? data.sourceAccount.trim() : ""
    if (!handle) return
    const existing = byAccount.get(handle)
    if (existing) existing.count += 1
    else byAccount.set(handle, { count: 1, sampleCaption: data.caption || "" })
  })

  const discovered: DiscoveredAccount[] = Array.from(byAccount.entries())
    .filter(([handle]) => !VENUE_INTEL_SEED_ACCOUNTS_SET.has(handle.toLowerCase()))
    .map(([handle, v]) => ({ handle, count: v.count, sampleCaption: v.sampleCaption }))
    .sort((a, b) => b.count - a.count)

  const accountDecisions: Record<string, string> = {}
  accountsSnap.docs.forEach(d => {
    const status = d.data()?.status
    if (typeof status === "string") accountDecisions[d.id] = status
  })

  return NextResponse.json({
    pending,
    counts: {
      pending: pending.length,
      approved: approvedCount.data().count,
      dismissed: dismissedCount.data().count,
    },
    discovered,
    accountDecisions,
  })
}
