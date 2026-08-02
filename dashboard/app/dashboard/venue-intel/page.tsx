"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuthContext } from "@/context/AuthContext"
import { auth } from "@/lib/firebase"
import { useIsMobile } from "@/hooks/useIsMobile"
import type { VenueIntelGroup, VenueIntelNeedsAttentionPost, VenueIntelPost, VenueIntelReasonGroup } from "@/app/api/venue-intel/route"
import type { DiscoveredAccount, AccountType } from "@/app/api/venue-intel-accounts/route"
import { authedFetch, errorMessage } from "@/lib/authedFetch"
import VenuePicker from "@/components/VenuePicker"
import Lightbox, { type LightboxOption, type LightboxResolved } from "@/components/Lightbox"
import DraftEventsPanel from "./DraftEventsPanel"
import NewVenueModal from "./NewVenueModal"

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  venue: "Venue",
  promoter: "Promoter",
  photographer: "Photographer",
  dj_artist: "DJ / Artist",
  staff: "Staff",
  influencer: "Influencer",
}

const CAPTION_TRUNCATE = 140
const PLACEHOLDER_THUMB =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%23f3f4f6'/%3E%3Ctext x='48' y='52' font-size='11' text-anchor='middle' fill='%239ca3af' font-family='sans-serif'%3Eno image%3C/text%3E%3C/svg%3E"

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

// <img src> can't carry the Authorization header the proxy requires, so
// fetch media through it client-side and render the blob via an object URL.
// Shared by the thumbnail hook below and the Lightbox's resolveSrc.
async function fetchProxiedBlob(mediaUrl: string): Promise<Blob> {
  const token = await auth.currentUser?.getIdToken()
  const res = await fetch(`/api/venue-intel/image?src=${encodeURIComponent(mediaUrl)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`proxy fetch failed (${res.status})`)
  return res.blob()
}

// The returned setter lets callers fall back to the placeholder on onError
// (bad/undecodable image data).
function useProxyThumbnail(mediaUrl: string | undefined): [string, (thumb: string) => void] {
  const [thumb, setThumb] = useState(PLACEHOLDER_THUMB)

  useEffect(() => {
    if (!mediaUrl) {
      setThumb(PLACEHOLDER_THUMB)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false

    async function loadThumb() {
      try {
        const blob = await fetchProxiedBlob(mediaUrl as string)
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

  return [thumb, setThumb]
}

// resolveSrc for the shared Lightbox — full-size media loads through the
// same authenticated proxy as the thumbnail. mediaUrls has no per-URL type
// info (a single-post video's mediaUrls is [posterImage, videoUrl] — see
// extractMediaUrls in functions/src/bridge/apifyWebhook.ts), so type is
// inferred from the proxied response's Content-Type, same signal the
// backend itself uses to tell image from video on ingest.
async function resolveVenueIntelMedia(option: LightboxOption): Promise<LightboxResolved> {
  const blob = await fetchProxiedBlob(option.url)
  return { src: URL.createObjectURL(blob), type: blob.type.startsWith("video/") ? "video" : "image" }
}

// SafeSearch moderation (issue #170) — small corner badge on the thumbnail,
// only for flagged/unscanned (a 'clear' or null result shows nothing, same
// convention as the badge maps in DraftEventsPanel.tsx / VenueMediaPanel.tsx).
const MODERATION_DOT: Record<string, { bg: string; label: string; title: string }> = {
  flagged: { bg: "#dc2626", label: "⚠", title: "Flagged by automated moderation — review before approving" },
  unscanned: { bg: "#6b7280", label: "?", title: "Not yet scanned by automated moderation" },
}

function ModerationBadge({ status }: { status: "clear" | "flagged" | "unscanned" | null | undefined }) {
  if (!status || status === "clear") return null
  const cfg = MODERATION_DOT[status]
  return (
    <span
      title={cfg.title}
      style={{
        position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, padding: "0 3px", borderRadius: 8,
        background: cfg.bg, color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center",
        justifyContent: "center", border: "2px solid #fff",
      }}
    >
      {cfg.label}
    </span>
  )
}

// onOpen is only passed by NeedsAttentionRow — the plain review queue
// (PostRow) renders this unclickable, same as before. ThumbBox is the bare
// (non-<td>) content, shared by the table's ThumbCell and the mobile cards.
function ThumbBox({ mediaUrl, moderationStatus, onOpen, size = 64 }: { mediaUrl: string | undefined; moderationStatus?: "clear" | "flagged" | "unscanned" | null; onOpen?: () => void; size?: number }) {
  const [thumb, setThumb] = useProxyThumbnail(mediaUrl)
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- external, volatile IG CDN URLs
    <img
      src={thumb}
      alt=""
      width={size}
      height={size}
      onError={() => setThumb(PLACEHOLDER_THUMB)}
      style={{ width: size, height: size, objectFit: "cover", borderRadius: 8, background: "#f3f4f6", display: "block" }}
    />
  )
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label="Expand media" style={{ padding: 0, border: "none", background: "none", cursor: "zoom-in", display: "block" }}>
          {img}
        </button>
      ) : img}
      <ModerationBadge status={moderationStatus} />
    </div>
  )
}

function ThumbCell({ mediaUrl, moderationStatus, onOpen }: { mediaUrl: string | undefined; moderationStatus?: "clear" | "flagged" | "unscanned" | null; onOpen?: () => void }) {
  return (
    <td style={{ padding: "12px 16px", width: 72 }}>
      <ThumbBox mediaUrl={mediaUrl} moderationStatus={moderationStatus} onOpen={onOpen} />
    </td>
  )
}

function IGProfileLink({ handle }: { handle: string }) {
  return (
    <a
      href={`https://www.instagram.com/${handle}/`}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "#111827", fontWeight: 600 }}
    >
      @{handle || "unknown"}
    </a>
  )
}

function ReasonBadge({ reason }: { reason: string }) {
  const label = reason.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  return (
    <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: "#ede9fe", color: "#6d28d9", whiteSpace: "nowrap" }}>
      {label}
    </span>
  )
}

// Approve/Dismiss button cluster — shared by the table row (compact) and the
// mobile card (full-width, ≥44px touch targets). One set of button handlers,
// two layouts.
function ApproveDismissActions({ busy, onApprove, onDismiss, full }: {
  busy: "approved" | "dismissed" | null
  onApprove: () => void
  onDismiss: () => void
  full?: boolean
}) {
  const btn: React.CSSProperties = full
    ? { flex: 1, padding: "12px 0", borderRadius: 8, fontSize: 14, minHeight: 44, border: "none", cursor: "pointer", fontWeight: 600 }
    : { padding: "5px 10px", borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer", fontWeight: 600 }
  return (
    <div style={{ display: "flex", gap: full ? 8 : 6, width: full ? "100%" : undefined }}>
      <button onClick={onApprove} disabled={busy !== null} style={{ ...btn, background: "#dcfce7", color: "#15803d", opacity: busy !== null ? 0.6 : 1 }}>
        {busy === "approved" ? "…" : "Approve"}
      </button>
      <button onClick={onDismiss} disabled={busy !== null} style={{ ...btn, background: "#fee2e2", color: "#b91c1c", opacity: busy !== null ? 0.6 : 1 }}>
        {busy === "dismissed" ? "…" : "Dismiss"}
      </button>
    </div>
  )
}

function PostRow({ post, onDecide, isMobile }: { post: VenueIntelPost; onDecide: (id: string, status: "approved" | "dismissed") => void; isMobile?: boolean }) {
  const [busy, setBusy] = useState<"approved" | "dismissed" | null>(null)
  const mediaUrl = post.mediaUrls[0]

  async function decide(status: "approved" | "dismissed") {
    setBusy(status)
    try {
      await onDecide(post.id, status)
    } finally {
      setBusy(null)
    }
  }

  const actions = <ApproveDismissActions busy={busy} onApprove={() => decide("approved")} onDismiss={() => decide("dismissed")} full={isMobile} />

  if (isMobile) {
    return (
      <div style={{ background: "#fff", border: "1px solid #f3f4f6", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <ThumbBox mediaUrl={mediaUrl} moderationStatus={post.moderationStatus} size={72} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <CaptionCell caption={post.caption} />
            <span style={{ fontSize: 12, color: "#6b7280" }}>♥ {post.likesCount.toLocaleString()} · 💬 {post.commentsCount.toLocaleString()}</span>
            <span style={{ fontSize: 12, color: "#6b7280" }}>{formatDate(post.postedAt)}</span>
            {post.postUrl && (
              <a href={post.postUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2a7a5a", fontWeight: 600 }}>
                View post ↗
              </a>
            )}
          </div>
        </div>
        {actions}
      </div>
    )
  }

  return (
    <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
      <ThumbCell mediaUrl={mediaUrl} moderationStatus={post.moderationStatus} />
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
        {actions}
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
  const isMobile = useIsMobile()

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
      {isMobile ? (
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {group.posts.map((post) => (
            <PostRow key={post.id} post={post} onDecide={onDecide} isMobile />
          ))}
        </div>
      ) : (
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
      )}
    </div>
  )
}

// Retry/Dismiss button cluster — shared by the table row (compact) and the
// mobile card (full-width, ≥44px touch targets).
function RetryDismissActions({ busy, onRetry, onDismiss, full }: {
  busy: "dismiss" | "retry" | "assign" | null
  onRetry: () => void
  onDismiss: () => void
  full?: boolean
}) {
  const btn: React.CSSProperties = full
    ? { flex: 1, padding: "12px 0", borderRadius: 8, fontSize: 14, minHeight: 44, border: "none", cursor: "pointer", fontWeight: 600 }
    : { padding: "5px 10px", borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer", fontWeight: 600 }
  return (
    <div style={{ display: "flex", gap: full ? 8 : 6, width: full ? "100%" : undefined }}>
      <button onClick={onRetry} disabled={busy !== null} style={{ ...btn, background: "#dcfce7", color: "#15803d", opacity: busy !== null ? 0.6 : 1 }}>
        {busy === "retry" ? "…" : "Retry"}
      </button>
      <button onClick={onDismiss} disabled={busy !== null} style={{ ...btn, background: "#fee2e2", color: "#b91c1c", opacity: busy !== null ? 0.6 : 1 }}>
        {busy === "dismiss" ? "…" : "Dismiss"}
      </button>
    </div>
  )
}

// Reason badge + venue-assign picker — shared block, full-width on mobile so
// the SearchSelect dropdown (which fills its container) is finger-usable.
function NeedsAttentionAssign({ post, busy, onAssignVenue, onOpenNewVenue, full }: {
  post: VenueIntelNeedsAttentionPost
  busy: "dismiss" | "retry" | "assign" | null
  onAssignVenue: (venueId: string, venueName: string) => void
  onOpenNewVenue: () => void
  full?: boolean
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start", width: full ? "100%" : undefined }}>
      <ReasonBadge reason={post.classificationReason} />
      <div style={{ display: "flex", gap: 6, alignItems: "center", width: "100%", flexDirection: full ? "column" : "row" }}>
        <div style={{ width: full ? "100%" : 200 }}>
          <VenuePicker venueId="" onChange={onAssignVenue} placeholder="Assign venue…" disabled={busy !== null} />
        </div>
        <button
          onClick={onOpenNewVenue}
          disabled={busy !== null}
          style={{
            padding: full ? "10px 10px" : "8px 10px", borderRadius: 8, fontSize: 12, border: "1px solid #e5e7eb",
            cursor: "pointer", background: "#fff", color: "#374151", fontWeight: 600, whiteSpace: "nowrap",
            opacity: busy !== null ? 0.6 : 1, width: full ? "100%" : undefined, minHeight: full ? 44 : undefined,
          }}
        >
          + New venue
        </button>
      </div>
    </div>
  )
}

function NeedsAttentionRow({
  post,
  onDismiss,
  onRetry,
  onAssignVenue,
  onOpenLightbox,
  onVenueCreated,
  isMobile,
}: {
  post: VenueIntelNeedsAttentionPost
  onDismiss: (id: string) => Promise<void>
  onRetry: (id: string) => Promise<void>
  onAssignVenue: (id: string, venueId: string, venueName: string) => Promise<void>
  onOpenLightbox: (mediaUrls: string[], index: number) => void
  onVenueCreated: (postId: string, venueId: string, venueName: string) => void
  isMobile?: boolean
}) {
  const [busy, setBusy] = useState<"dismiss" | "retry" | "assign" | null>(null)
  const [showNewVenue, setShowNewVenue] = useState(false)
  const mediaUrl = post.mediaUrls[0]

  async function run(action: "dismiss" | "retry") {
    setBusy(action)
    try {
      if (action === "dismiss") await onDismiss(post.id)
      else await onRetry(post.id)
    } finally {
      setBusy(null)
    }
  }

  async function assignVenue(venueId: string, venueName: string) {
    setBusy("assign")
    try {
      await onAssignVenue(post.id, venueId, venueName)
    } finally {
      setBusy(null)
    }
  }

  const newVenueModal = showNewVenue && (
    <NewVenueModal
      post={post}
      onClose={() => setShowNewVenue(false)}
      onCreated={(postId, venueId, venueName) => {
        setShowNewVenue(false)
        onVenueCreated(postId, venueId, venueName)
      }}
    />
  )

  if (isMobile) {
    return (
      <div style={{ background: "#fff", border: "1px solid #f3f4f6", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <ThumbBox mediaUrl={mediaUrl} moderationStatus={post.moderationStatus} onOpen={post.mediaUrls.length > 0 ? () => onOpenLightbox(post.mediaUrls, 0) : undefined} size={72} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <IGProfileLink handle={post.sourceAccount} />
            <CaptionCell caption={post.caption} />
            <span style={{ fontSize: 12, color: "#6b7280" }}>{formatDate(post.postedAt)}</span>
            {post.postUrl && (
              <a href={post.postUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2a7a5a", fontWeight: 600 }}>
                View post ↗
              </a>
            )}
          </div>
        </div>
        <NeedsAttentionAssign post={post} busy={busy} onAssignVenue={assignVenue} onOpenNewVenue={() => setShowNewVenue(true)} full />
        <RetryDismissActions busy={busy} onRetry={() => run("retry")} onDismiss={() => run("dismiss")} full />
        {newVenueModal}
      </div>
    )
  }

  return (
    <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
      <ThumbCell mediaUrl={mediaUrl} moderationStatus={post.moderationStatus} onOpen={post.mediaUrls.length > 0 ? () => onOpenLightbox(post.mediaUrls, 0) : undefined} />
      <td style={{ padding: "12px 16px", maxWidth: 320 }}>
        <CaptionCell caption={post.caption} />
      </td>
      <td style={{ padding: "12px 16px", fontSize: 13, whiteSpace: "nowrap" }}>
        <IGProfileLink handle={post.sourceAccount} />
      </td>
      <td style={{ padding: "12px 16px", minWidth: 220 }}>
        {/* Reason stays visible — it explains WHY the row is stuck. The
            picker sits alongside it, not in place of it; picking a venue
            immediately assigns + retries (see assignVenueAndRetry). */}
        <NeedsAttentionAssign post={post} busy={busy} onAssignVenue={assignVenue} onOpenNewVenue={() => setShowNewVenue(true)} />
        {newVenueModal}
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
        <RetryDismissActions busy={busy} onRetry={() => run("retry")} onDismiss={() => run("dismiss")} />
      </td>
    </tr>
  )
}

function ReasonGroupCard({
  group,
  onDismiss,
  onRetry,
  onBulkRetry,
  onAssignVenue,
  onOpenLightbox,
  onVenueCreated,
}: {
  group: VenueIntelReasonGroup
  onDismiss: (id: string) => Promise<void>
  onRetry: (id: string) => Promise<void>
  onBulkRetry: (reason: string) => Promise<void>
  onAssignVenue: (id: string, venueId: string, venueName: string) => Promise<void>
  onOpenLightbox: (mediaUrls: string[], index: number) => void
  onVenueCreated: (postId: string, venueId: string, venueName: string) => void
}) {
  const [bulkBusy, setBulkBusy] = useState(false)
  const posts = group.accountGroups.flatMap((ag) => ag.posts)
  const isMobile = useIsMobile()

  async function bulkRetry() {
    setBulkBusy(true)
    try {
      await onBulkRetry(group.reason)
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ReasonBadge reason={group.reason} />
          <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: "#f3f4f6", color: "#6b7280" }}>
            {group.count} posts
          </span>
        </div>
        <button
          onClick={bulkRetry}
          disabled={bulkBusy}
          style={{ padding: "6px 12px", borderRadius: 6, fontSize: 12, border: "1px solid #bbf7d0", cursor: "pointer", background: "#f0fdf4", color: "#15803d", fontWeight: 600, opacity: bulkBusy ? 0.6 : 1 }}
        >
          {bulkBusy ? "Retrying…" : "Retry all"}
        </button>
      </div>
      {isMobile ? (
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {posts.map((post) => (
            <NeedsAttentionRow key={post.id} post={post} onDismiss={onDismiss} onRetry={onRetry} onAssignVenue={onAssignVenue} onOpenLightbox={onOpenLightbox} onVenueCreated={onVenueCreated} isMobile />
          ))}
        </div>
      ) : (
        <div className="dash-table-wrap" style={{ border: "none", borderRadius: 0, boxShadow: "none" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                {["", "Caption", "Account", "Reason / Assign venue", "Posted", "Link", "Actions"].map((h) => (
                  <th key={h} style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#9ca3af", fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <NeedsAttentionRow key={post.id} post={post} onDismiss={onDismiss} onRetry={onRetry} onAssignVenue={onAssignVenue} onOpenLightbox={onOpenLightbox} onVenueCreated={onVenueCreated} />
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  const [needsAttention, setNeedsAttention] = useState<VenueIntelReasonGroup[]>([])
  const [counts, setCounts] = useState({ pending: 0, approved: 0, dismissed: 0, needsAttention: 0 })
  const [intelTab, setIntelTab] = useState<"queue" | "needsAttention">("queue")
  const [candidates, setCandidates] = useState<DiscoveredAccount[]>([])
  const [accountTypes, setAccountTypes] = useState<readonly AccountType[]>(["venue", "promoter", "photographer", "dj_artist", "staff", "influencer"])
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState("")
  const [tab, setTab] = useState<"intel" | "drafts">("intel")
  const [lightbox, setLightbox] = useState<{ mediaUrls: string[]; index: number } | null>(null)
  const lightboxOptions: LightboxOption[] = useMemo(
    () => (lightbox ? lightbox.mediaUrls.map((url) => ({ url })) : []),
    [lightbox?.mediaUrls]
  )

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
    if (!isVenueIntelStaff) router.replace("/unauthorized")
  }, [loading, user, isVenueIntelStaff, router])

  const loadQueue = useCallback(async () => {
    const data = await authedFetch("/api/venue-intel")
    setGroups(data.groups)
    setNeedsAttention(data.needsAttention)
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

  function removeNeedsAttentionPostLocally(id: string, status: "approved" | "dismissed") {
    setNeedsAttention((prev) =>
      prev
        .map((g) => ({
          ...g,
          count: g.count - (g.accountGroups.some((ag) => ag.posts.some((p) => p.id === id)) ? 1 : 0),
          accountGroups: g.accountGroups
            .map((ag) => ({ ...ag, posts: ag.posts.filter((p) => p.id !== id) }))
            .filter((ag) => ag.posts.length > 0),
        }))
        .filter((g) => g.accountGroups.length > 0)
    )
    setCounts((c) => ({ ...c, needsAttention: c.needsAttention - 1, [status]: c[status] + 1 }))
  }

  async function dismissNeedsAttentionPost(id: string) {
    try {
      await authedFetch(`/api/venue-intel/${id}`, { method: "PATCH", body: JSON.stringify({ status: "dismissed" }) })
      removeNeedsAttentionPostLocally(id, "dismissed")
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function retryNeedsAttentionPost(id: string) {
    try {
      await authedFetch(`/api/venue-intel/${id}`, { method: "PATCH", body: JSON.stringify({ status: "approved", clearTransform: true }) })
      removeNeedsAttentionPostLocally(id, "approved")
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  // Same retry path as retryNeedsAttentionPost — clearTransform: true still
  // does the re-approve + delete transform.processedAt that makes the live
  // trigger re-fire — just with venueId/venueName staged onto the doc first
  // so the trigger's classifier resolves to this venue instead of failing
  // the same way again (see manualVenueId in eventTransformRouting.ts).
  async function assignVenueAndRetry(id: string, venueId: string, venueName: string) {
    try {
      await authedFetch(`/api/venue-intel/${id}`, { method: "PATCH", body: JSON.stringify({ status: "approved", clearTransform: true, venueId, venueName }) })
      removeNeedsAttentionPostLocally(id, "approved")
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  // The create-venue route already performs the assign + retry Firestore
  // writes server-side (see dashboard/app/api/venue-intel/create-venue/route.ts)
  // — this just drains the row locally, same as assignVenueAndRetry's optimistic update.
  function venueCreatedForPost(id: string) {
    removeNeedsAttentionPostLocally(id, "approved")
  }

  async function bulkRetryReason(reason: string) {
    try {
      const group = needsAttention.find((g) => g.reason === reason)
      const affected = group?.count ?? 0
      await authedFetch("/api/venue-intel/bulk", { method: "POST", body: JSON.stringify({ reason, action: "retry" }) })
      setNeedsAttention((prev) => prev.filter((g) => g.reason !== reason))
      setCounts((c) => ({ ...c, needsAttention: c.needsAttention - affected, approved: c.approved + affected }))
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
      <div className="dash-page">
        <div className="dash-header">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: 0 }}>Venue Intel</h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>Review staged Instagram posts scraped by the Apify pipeline</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid #e5e7eb" }}>
          {([["intel", "Venue Intel"], ["drafts", "Draft Events"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: "10px 18px", border: "none", cursor: "pointer", fontSize: 14,
              fontWeight: tab === key ? 600 : 400, background: "transparent",
              color: tab === key ? "#111827" : "#6b7280",
              borderBottom: tab === key ? "2px solid #111827" : "2px solid transparent", marginBottom: -1,
            }}>{label}</button>
          ))}
        </div>

        {error && (
          <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {tab === "drafts" ? (
          <DraftEventsPanel />
        ) : (
          <>
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          <span style={{ padding: "5px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, background: "#fef3c7", color: "#92400e" }}>{counts.pending} pending</span>
          <span style={{ padding: "5px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, background: "#dcfce7", color: "#15803d" }}>{counts.approved} approved</span>
          <span style={{ padding: "5px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, background: "#f3f4f6", color: "#6b7280" }}>{counts.dismissed} dismissed</span>
          <span style={{ padding: "5px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, background: "#ede9fe", color: "#6d28d9" }}>{counts.needsAttention} needs attention</span>
        </div>
        <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid #e5e7eb" }}>
          {(
            [
              { key: "queue", label: `Review queue (${counts.pending})` },
              { key: "needsAttention", label: `Needs Attention (${counts.needsAttention})` },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setIntelTab(t.key)}
              style={{
                padding: "10px 18px",
                border: "none",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: intelTab === t.key ? 600 : 400,
                background: "transparent",
                color: intelTab === t.key ? "#111827" : "#6b7280",
                borderBottom: intelTab === t.key ? "2px solid #111827" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
            {fetching ? (
              <p style={{ color: "#9ca3af", fontSize: 14 }}>Loading…</p>
            ) : intelTab === "needsAttention" ? (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>Needs Attention</h2>
            <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 12px" }}>
              Posts the transform couldn&apos;t auto-route — approve venue docs or fix source data, then Retry to re-run the trigger.
            </p>
            {needsAttention.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>
                Nothing needs attention. All caught up.
              </div>
            ) : (
              <div>
                {needsAttention.map((g) => (
                  <ReasonGroupCard
                    key={g.reason}
                    group={g}
                    onDismiss={dismissNeedsAttentionPost}
                    onRetry={retryNeedsAttentionPost}
                    onBulkRetry={bulkRetryReason}
                    onAssignVenue={assignVenueAndRetry}
                    onOpenLightbox={(mediaUrls, index) => setLightbox({ mediaUrls, index })}
                    onVenueCreated={venueCreatedForPost}
                  />
                ))}
              </div>
            )}
            {lightbox && (
              <Lightbox
                options={lightboxOptions}
                index={lightbox.index}
                onIndexChange={(i) => setLightbox((lb) => (lb ? { ...lb, index: i } : lb))}
                onClose={() => setLightbox(null)}
                resolveSrc={resolveVenueIntelMedia}
              />
            )}
          </>
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
          </>
        )}
      </div>
  )
}
