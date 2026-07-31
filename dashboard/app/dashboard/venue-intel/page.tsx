"use client"
import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuthContext } from "@/context/AuthContext"
import DashboardLayout from "@/components/DashboardLayout"
import { auth } from "@/lib/firebase"
import type { VenueIntelGroup, VenueIntelPost } from "@/app/api/venue-intel/route"
import type { DiscoveredAccount, AccountType } from "@/app/api/venue-intel-accounts/route"

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  venue: "Venue",
  promoter: "Promoter",
  photographer: "Photographer",
  dj_artist: "DJ / Artist",
  staff: "Staff",
}

const CAPTION_TRUNCATE = 140
const PLACEHOLDER_THUMB =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%23f3f4f6'/%3E%3Ctext x='48' y='52' font-size='11' text-anchor='middle' fill='%239ca3af' font-family='sans-serif'%3Eno image%3C/text%3E%3C/svg%3E"

async function authedFetch(path: string, init?: RequestInit) {
  const token = await auth.currentUser?.getIdToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || `Request failed (${res.status})`)
  }
  return res.json()
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

function formatDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function CaptionCell({ caption }: { caption: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!caption) return <span style={{ color: "#9ca3af" }}>—</span>
  const isLong = caption.length > CAPTION_TRUNCATE
  const shown = expanded || !isLong ? caption : `${caption.slice(0, CAPTION_TRUNCATE)}…`
  return (
    <span style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
      {shown}{" "}
      {isLong && (
        <button
          onClick={() => setExpanded((e) => !e)}
          style={{ background: "none", border: "none", color: "#2a7a5a", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0 }}
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </span>
  )
}

function PostRow({ post, onDecide }: { post: VenueIntelPost; onDecide: (id: string, status: "approved" | "dismissed") => void }) {
  const [busy, setBusy] = useState<"approved" | "dismissed" | null>(null)
  const [thumb, setThumb] = useState(PLACEHOLDER_THUMB)
  const mediaUrl = post.mediaUrls[0]

  // <img src> can't carry the Authorization header the proxy requires, so
  // fetch the thumbnail through it client-side and render the blob via an
  // object URL. onError below still catches bad/undecodable image data.
  useEffect(() => {
    if (!mediaUrl) {
      setThumb(PLACEHOLDER_THUMB)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false

    async function loadThumb() {
      try {
        const token = await auth.currentUser?.getIdToken()
        const res = await fetch(`/api/venue-intel/image?src=${encodeURIComponent(mediaUrl as string)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`proxy fetch failed (${res.status})`)
        const blob = await res.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setThumb(objectUrl)
      } catch {
        if (!cancelled) setThumb(PLACEHOLDER_THUMB)
      }
    }
    loadThumb()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [mediaUrl])

  async function decide(status: "approved" | "dismissed") {
    setBusy(status)
    try {
      await onDecide(post.id, status)
    } finally {
      setBusy(null)
    }
  }

  return (
    <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
      <td style={{ padding: "12px 16px", width: 72 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- external, volatile IG CDN URLs */}
        <img
          src={thumb}
          alt=""
          width={64}
          height={64}
          onError={() => setThumb(PLACEHOLDER_THUMB)}
          style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, background: "#f3f4f6" }}
        />
      </td>
      <td style={{ padding: "12px 16px", maxWidth: 360 }}>
        <CaptionCell caption={post.caption} />
      </td>
      <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", whiteSpace: "nowrap" }}>
        ♥ {post.likesCount.toLocaleString()} · 💬 {post.commentsCount.toLocaleString()}
      </td>
      <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280", whiteSpace: "nowrap" }}>{formatDate(post.postedAt)}</td>
      <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
        {post.postUrl && (
          <a href={post.postUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2a7a5a", fontWeight: 600 }}>
            View post ↗
          </a>
        )}
      </td>
      <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => decide("approved")}
            disabled={busy !== null}
            style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer", background: "#dcfce7", color: "#15803d", fontWeight: 600, opacity: busy !== null ? 0.6 : 1 }}
          >
            {busy === "approved" ? "…" : "Approve"}
          </button>
          <button
            onClick={() => decide("dismissed")}
            disabled={busy !== null}
            style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer", background: "#fee2e2", color: "#b91c1c", fontWeight: 600, opacity: busy !== null ? 0.6 : 1 }}
          >
            {busy === "dismissed" ? "…" : "Dismiss"}
          </button>
        </div>
      </td>
    </tr>
  )
}

function GroupCard({
  group,
  onDecide,
  onBulk,
}: {
  group: VenueIntelGroup
  onDecide: (id: string, status: "approved" | "dismissed") => void
  onBulk: (sourceAccount: string, status: "approved" | "dismissed") => void
}) {
  const [bulkBusy, setBulkBusy] = useState<"approved" | "dismissed" | null>(null)

  async function bulk(status: "approved" | "dismissed") {
    setBulkBusy(status)
    try {
      await onBulk(group.sourceAccount, status)
    } finally {
      setBulkBusy(null)
    }
  }

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>@{group.sourceAccount || "unknown"}</span>
          <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: "#fef3c7", color: "#92400e" }}>
            {group.posts.length} pending
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => bulk("approved")}
            disabled={bulkBusy !== null}
            style={{ padding: "6px 12px", borderRadius: 6, fontSize: 12, border: "1px solid #bbf7d0", cursor: "pointer", background: "#f0fdf4", color: "#15803d", fontWeight: 600, opacity: bulkBusy !== null ? 0.6 : 1 }}
          >
            {bulkBusy === "approved" ? "Approving…" : "Approve all"}
          </button>
          <button
            onClick={() => bulk("dismissed")}
            disabled={bulkBusy !== null}
            style={{ padding: "6px 12px", borderRadius: 6, fontSize: 12, border: "1px solid #fecaca", cursor: "pointer", background: "#fef2f2", color: "#b91c1c", fontWeight: 600, opacity: bulkBusy !== null ? 0.6 : 1 }}
          >
            {bulkBusy === "dismissed" ? "Dismissing…" : "Dismiss all"}
          </button>
        </div>
      </div>
      <div className="dash-table-wrap" style={{ border: "none", borderRadius: 0, boxShadow: "none" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              {["", "Caption", "Engagement", "Posted", "Link", "Actions"].map((h) => (
                <th key={h} style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#9ca3af", fontSize: 11, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.posts.map((post) => (
              <PostRow key={post.id} post={post} onDecide={onDecide} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CandidateRow({ candidate, accountTypes, onDecide }: { candidate: DiscoveredAccount; accountTypes: readonly AccountType[]; onDecide: (handle: string, status: "approved" | "rejected", accountType?: AccountType) => Promise<void> }) {
  const [accountType, setAccountType] = useState<AccountType>(accountTypes[0])
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null)

  async function decide(status: "approved" | "rejected") {
    setBusy(status)
    try {
      await onDecide(candidate.handle, status, status === "approved" ? accountType : undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
      <td style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14 }}>
        <a
          href={`https://www.instagram.com/${candidate.handle}/`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#111827" }}
        >
          @{candidate.handle}
        </a>
      </td>
      <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{candidate.count}</td>
      <td style={{ padding: "12px 16px", fontSize: 13, color: "#374151", maxWidth: 340 }}>
        {candidate.sampleCaption ? (candidate.sampleCaption.length > 100 ? `${candidate.sampleCaption.slice(0, 100)}…` : candidate.sampleCaption) : <span style={{ color: "#9ca3af" }}>—</span>}
      </td>
      <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select
            value={accountType}
            onChange={(e) => setAccountType(e.target.value as AccountType)}
            disabled={busy !== null}
            style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12 }}
          >
            {accountTypes.map((t) => (
              <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <button
            onClick={() => decide("approved")}
            disabled={busy !== null}
            style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer", background: "#dcfce7", color: "#15803d", fontWeight: 600, opacity: busy !== null ? 0.6 : 1 }}
          >
            {busy === "approved" ? "…" : "Approve"}
          </button>
          <button
            onClick={() => decide("rejected")}
            disabled={busy !== null}
            style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer", background: "#fee2e2", color: "#b91c1c", fontWeight: 600, opacity: busy !== null ? 0.6 : 1 }}
          >
            {busy === "rejected" ? "…" : "Reject"}
          </button>
        </div>
      </td>
    </tr>
  )
}

export default function VenueIntelPage() {
  const router = useRouter()
  const { user, loading, role } = useAuthContext()
  const isVenueIntelStaff = role === "super_admin" || role === "moderator"

  const [groups, setGroups] = useState<VenueIntelGroup[]>([])
  const [counts, setCounts] = useState({ pending: 0, approved: 0, dismissed: 0 })
  const [candidates, setCandidates] = useState<DiscoveredAccount[]>([])
  const [accountTypes, setAccountTypes] = useState<readonly AccountType[]>(["venue", "promoter", "photographer", "dj_artist", "staff"])
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
    if (!isVenueIntelStaff) router.replace("/unauthorized")
  }, [loading, user, isVenueIntelStaff, router])

  const loadQueue = useCallback(async () => {
    const data = await authedFetch("/api/venue-intel")
    setGroups(data.groups)
    setCounts(data.counts)
  }, [])

  const loadCandidates = useCallback(async () => {
    const data = await authedFetch("/api/venue-intel-accounts")
    setCandidates(data.candidates)
    setAccountTypes(data.accountTypes)
  }, [])

  useEffect(() => {
    if (!user || !isVenueIntelStaff) return
    setFetching(true)
    Promise.all([loadQueue(), loadCandidates()])
      .catch((e) => setError(e.message))
      .finally(() => setFetching(false))
  }, [user, isVenueIntelStaff, loadQueue, loadCandidates])

  function removePostLocally(id: string, status: "approved" | "dismissed") {
    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, posts: g.posts.filter((p) => p.id !== id) }))
        .filter((g) => g.posts.length > 0)
    )
    setCounts((c) => ({ ...c, pending: c.pending - 1, [status]: c[status] + 1 }))
  }

  async function decidePost(id: string, status: "approved" | "dismissed") {
    try {
      await authedFetch(`/api/venue-intel/${id}`, { method: "PATCH", body: JSON.stringify({ status }) })
      removePostLocally(id, status)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function bulkDecide(sourceAccount: string, status: "approved" | "dismissed") {
    try {
      const group = groups.find((g) => g.sourceAccount === sourceAccount)
      const affected = group?.posts.length ?? 0
      await authedFetch("/api/venue-intel/bulk", { method: "POST", body: JSON.stringify({ sourceAccount, status }) })
      setGroups((prev) => prev.filter((g) => g.sourceAccount !== sourceAccount))
      setCounts((c) => ({ ...c, pending: c.pending - affected, [status]: c[status] + affected }))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function decideCandidate(handle: string, status: "approved" | "rejected", accountType?: AccountType) {
    try {
      await authedFetch("/api/venue-intel-accounts", { method: "POST", body: JSON.stringify({ handle, status, accountType }) })
      setCandidates((prev) => prev.filter((c) => c.handle !== handle))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  if (loading || !user || !isVenueIntelStaff) return null

  return (
    <DashboardLayout>
      <div className="dash-page">
        <div className="dash-header">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Venue Intel</h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>Review staged Instagram posts scraped by the Apify pipeline</p>
          </div>
        </div>

        {error && (
          <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
          <span style={{ padding: "5px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, background: "#fef3c7", color: "#92400e" }}>{counts.pending} pending</span>
          <span style={{ padding: "5px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, background: "#dcfce7", color: "#15803d" }}>{counts.approved} approved</span>
          <span style={{ padding: "5px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, background: "#f3f4f6", color: "#6b7280" }}>{counts.dismissed} dismissed</span>
        </div>

        {fetching ? (
          <p style={{ color: "#9ca3af", fontSize: 14 }}>Loading…</p>
        ) : (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 12px" }}>Post review queue</h2>
            {groups.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: "40px 16px", textAlign: "center", color: "#9ca3af", marginBottom: 28 }}>
                No pending posts. All caught up.
              </div>
            ) : (
              <div style={{ marginBottom: 28 }}>
                {groups.map((g) => (
                  <GroupCard key={g.sourceAccount} group={g} onDecide={decidePost} onBulk={bulkDecide} />
                ))}
              </div>
            )}

            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>Discovered accounts</h2>
            <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 12px" }}>Instagram accounts scraped that aren&apos;t in the current seed list</p>
            {candidates.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>
                No new candidate accounts.
              </div>
            ) : (
              <div className="dash-table-wrap">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                      {["Account", "Posts", "Sample caption", "Decide"].map((h) => (
                        <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 13 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => (
                      <CandidateRow key={c.handle} candidate={c} accountTypes={accountTypes} onDecide={decideCandidate} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
