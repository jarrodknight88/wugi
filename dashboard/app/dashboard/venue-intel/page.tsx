"use client"
import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { auth } from "@/lib/firebase"
import { useAuthContext } from "@/context/AuthContext"
import DashboardLayout from "@/components/DashboardLayout"

// Scoped tighter than the general dashboard ACL — this surface reviews
// scraped IG content before it can influence venues/.
const STAFF_ROLES = new Set(["super_admin", "moderator"])

type VenueIntelPost = {
  id: string
  sourceAccount: string
  postUrl: string
  caption: string
  postedAt: number | null
  likesCount: number
  commentsCount: number
  mediaUrls: string[]
}

type DiscoveredAccount = {
  handle: string
  count: number
  sampleCaption: string
}

type Counts = { pending: number; approved: number; dismissed: number }

const CARD = { background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

async function authedFetch(path: string, init?: RequestInit) {
  const token = await auth.currentUser?.getIdToken()
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`)
  return json
}

function groupByAccount(posts: VenueIntelPost[]): { account: string; posts: VenueIntelPost[] }[] {
  const groups = new Map<string, VenueIntelPost[]>()
  posts.forEach(p => {
    const key = p.sourceAccount || "(unknown)"
    const list = groups.get(key)
    if (list) list.push(p)
    else groups.set(key, [p])
  })
  return Array.from(groups.entries())
    .map(([account, list]) => ({
      account,
      posts: [...list].sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0)),
    }))
    .sort((a, b) => b.posts.length - a.posts.length)
}

function Thumb({ url }: { url?: string }) {
  const [broken, setBroken] = useState(false)
  if (!url || broken) {
    return (
      <div style={{ width: 64, height: 64, borderRadius: 8, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 10, textAlign: "center" as const, flexShrink: 0 }}>
        No image
      </div>
    )
  }
  return <img src={url} onError={() => setBroken(true)} alt="" style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover" as const, flexShrink: 0 }} />
}

function Caption({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > 140
  const shown = expanded || !isLong ? text : text.slice(0, 140) + "…"
  return (
    <div style={{ fontSize: 13, color: "#374151", maxWidth: 420 }}>
      {shown ? shown : <span style={{ color: "#9ca3af" }}>No caption</span>}
      {isLong && (
        <button onClick={() => setExpanded(e => !e)} style={{ marginLeft: 6, background: "none", border: "none", color: "#2a7a5a", fontSize: 12, cursor: "pointer", fontWeight: 600, padding: 0 }}>
          {expanded ? "less" : "more"}
        </button>
      )}
    </div>
  )
}

function formatDate(ms: number | null) {
  if (!ms) return "—"
  return new Date(ms).toLocaleString()
}

export default function VenueIntelPage() {
  const router = useRouter()
  const { user, hasUserDocument, role, loading } = useAuthContext()
  const isStaff = !!role && STAFF_ROLES.has(role)

  const [posts, setPosts] = useState<VenueIntelPost[]>([])
  const [counts, setCounts] = useState<Counts>({ pending: 0, approved: 0, dismissed: 0 })
  const [discovered, setDiscovered] = useState<DiscoveredAccount[]>([])
  const [accountDecisions, setAccountDecisions] = useState<Record<string, string>>({})
  const [loadingData, setLoadingData] = useState(true)
  const [error, setError] = useState("")
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
    if (hasUserDocument && !isStaff) router.replace("/unauthorized")
  }, [loading, user, hasUserDocument, isStaff, router])

  const load = useCallback(async () => {
    setLoadingData(true)
    setError("")
    try {
      const data = await authedFetch("/api/venue-intel")
      setPosts(data.pending || [])
      setCounts(data.counts || { pending: 0, approved: 0, dismissed: 0 })
      setDiscovered(data.discovered || [])
      setAccountDecisions(data.accountDecisions || {})
    } catch (e) {
      setError(errMessage(e, "Failed to load venue intel"))
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => { if (user && isStaff) load() }, [user, isStaff, load])

  function withBusy<T>(ids: string[], fn: () => Promise<T>) {
    setBusyIds(prev => new Set([...prev, ...ids]))
    return fn().finally(() => {
      setBusyIds(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.delete(id))
        return next
      })
    })
  }

  async function review(ids: string[], action: "approve" | "dismiss") {
    setError("")
    try {
      await withBusy(ids, () => authedFetch("/api/venue-intel/review", { method: "POST", body: JSON.stringify({ ids, action }) }))
      const idSet = new Set(ids)
      setPosts(prev => prev.filter(p => !idSet.has(p.id)))
      setCounts(prev => ({
        ...prev,
        pending: prev.pending - ids.length,
        approved: prev.approved + (action === "approve" ? ids.length : 0),
        dismissed: prev.dismissed + (action === "dismiss" ? ids.length : 0),
      }))
    } catch (e) {
      setError(errMessage(e, "Action failed"))
    }
  }

  async function decideAccount(handle: string, action: "approve" | "reject") {
    setError("")
    try {
      await withBusy([handle], () => authedFetch("/api/venue-intel/accounts", { method: "POST", body: JSON.stringify({ handle, action }) }))
      setAccountDecisions(prev => ({ ...prev, [handle]: action === "approve" ? "approved" : "rejected" }))
    } catch (e) {
      setError(errMessage(e, "Action failed"))
    }
  }

  if (loading || !user || !isStaff) return null

  const groups = groupByAccount(posts)

  return (
    <DashboardLayout>
      <div className="dash-page">
        <div className="dash-header">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Venue Intel</h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>Scraped Instagram posts staged for review before they inform venues.</p>
          </div>
        </div>

        {error && <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>{error}</div>}

        <div className="dash-stat-grid">
          <div style={{ ...CARD, padding: 16 }}>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>PENDING</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#a16207" }}>{counts.pending}</div>
          </div>
          <div style={{ ...CARD, padding: 16 }}>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>APPROVED</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#15803d" }}>{counts.approved}</div>
          </div>
          <div style={{ ...CARD, padding: 16 }}>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>DISMISSED</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#6b7280" }}>{counts.dismissed}</div>
          </div>
        </div>

        {loadingData ? (
          <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading...</div>
        ) : groups.length === 0 ? (
          <div style={{ ...CARD, padding: 40, textAlign: "center", color: "#9ca3af", marginBottom: 28 }}>Nothing pending review.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 28 }}>
            {groups.map(group => {
              const ids = group.posts.map(p => p.id)
              const groupBusy = ids.some(id => busyIds.has(id))
              return (
                <div key={group.account} style={CARD}>
                  <div style={{ padding: "14px 18px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" as const, gap: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>@{group.account} <span style={{ fontWeight: 400, color: "#6b7280", fontSize: 13 }}>({group.posts.length} pending)</span></div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button disabled={groupBusy} onClick={() => review(ids, "approve")} style={{ padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "#dcfce7", color: "#15803d", border: "none", cursor: "pointer", opacity: groupBusy ? 0.6 : 1 }}>Approve all</button>
                      <button disabled={groupBusy} onClick={() => review(ids, "dismiss")} style={{ padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "#fee2e2", color: "#b91c1c", border: "none", cursor: "pointer", opacity: groupBusy ? 0.6 : 1 }}>Dismiss all</button>
                    </div>
                  </div>
                  <div>
                    {group.posts.map((p, i) => {
                      const busy = busyIds.has(p.id)
                      return (
                        <div key={p.id} style={{ padding: "14px 18px", display: "flex", gap: 14, alignItems: "flex-start", borderBottom: i < group.posts.length - 1 ? "1px solid #f3f4f6" : "none", flexWrap: "wrap" as const }}>
                          <Thumb url={p.mediaUrls[0]} />
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <Caption text={p.caption} />
                            <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 12, color: "#6b7280", flexWrap: "wrap" as const }}>
                              <span>♥ {p.likesCount}</span>
                              <span>💬 {p.commentsCount}</span>
                              <span>{formatDate(p.postedAt)}</span>
                              {p.postUrl && <a href={p.postUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#2a7a5a", fontWeight: 600 }}>View post ↗</a>}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                            <button disabled={busy} onClick={() => review([p.id], "approve")} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, background: "#dcfce7", border: "none", cursor: "pointer", color: "#15803d", fontWeight: 600, opacity: busy ? 0.6 : 1 }}>Approve</button>
                            <button disabled={busy} onClick={() => review([p.id], "dismiss")} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, background: "#fee2e2", border: "none", cursor: "pointer", color: "#b91c1c", fontWeight: 600, opacity: busy ? 0.6 : 1 }}>Dismiss</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111827", margin: 0 }}>Discovered accounts</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>Source accounts appearing in venueIntel that are not in the current Apify seed list.</p>
        </div>

        {loadingData ? (
          <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading...</div>
        ) : discovered.length === 0 ? (
          <div style={{ ...CARD, padding: 40, textAlign: "center", color: "#9ca3af" }}>No new accounts discovered.</div>
        ) : (
          <div className="dash-table-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 600 }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  {["Account", "Posts", "Sample caption", "Decision", "Actions"].map(h => (
                    <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 13 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {discovered.map((a, i) => {
                  const decision = accountDecisions[a.handle]
                  const busy = busyIds.has(a.handle)
                  return (
                    <tr key={a.handle} style={{ borderBottom: i < discovered.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                      <td style={{ padding: "12px 16px", fontWeight: 600, color: "#111827" }}>@{a.handle}</td>
                      <td style={{ padding: "12px 16px", color: "#6b7280" }}>{a.count}</td>
                      <td style={{ padding: "12px 16px", color: "#6b7280", maxWidth: 360 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>{a.sampleCaption || "—"}</div>
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        {decision ? (
                          <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: decision === "approved" ? "#dcfce7" : "#fee2e2", color: decision === "approved" ? "#15803d" : "#b91c1c" }}>{decision}</span>
                        ) : (
                          <span style={{ color: "#9ca3af", fontSize: 12 }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button disabled={busy} onClick={() => decideAccount(a.handle, "approve")} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, background: "#dcfce7", border: "none", cursor: "pointer", color: "#15803d", fontWeight: 600, opacity: busy ? 0.6 : 1 }}>Approve candidate</button>
                          <button disabled={busy} onClick={() => decideAccount(a.handle, "reject")} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, background: "#fee2e2", border: "none", cursor: "pointer", color: "#b91c1c", fontWeight: 600, opacity: busy ? 0.6 : 1 }}>Reject candidate</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
