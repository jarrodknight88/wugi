"use client"
import { useEffect, useRef, useState } from "react"

export type LightboxOption = {
  url: string
  thumbUrl?: string
  type?: "image" | "video"
}

export type LightboxResolved = { src: string; type?: "image" | "video" }

type LightboxProps = {
  options: LightboxOption[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  // Omitted: `option.url` is used directly as the media src — the original
  // PR #150 behavior for DraftEventsPanel's signed/direct URLs.
  // Provided: the Lightbox fetches (and caches per session) the full-size
  // media through it instead of using `option.url` as a src — e.g.
  // venue-intel's authenticated proxy, where <img src> can't carry the
  // Authorization header. Resolved blob URLs are revoked when the Lightbox
  // unmounts (on close).
  resolveSrc?: (option: LightboxOption) => Promise<LightboxResolved>
}

const navBtn = { position: "absolute" as const, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: "50%", width: 44, height: 44, fontSize: 22, cursor: "pointer" }

// Plain fixed-position overlay — no new packages. Prev/next stay scoped to
// whichever section's options it was opened from. Shared by DraftEventsPanel
// (direct signed URLs) and venue-intel's Needs Attention rows (authenticated
// proxy → blob URLs via resolveSrc, see the prop doc above).
export default function Lightbox({ options, index, onIndexChange, onClose, resolveSrc }: LightboxProps) {
  const [resolved, setResolved] = useState<Map<string, LightboxResolved>>(new Map())
  const [loadError, setLoadError] = useState<string | null>(null)
  const requestedRef = useRef<Set<string>>(new Set())
  const blobUrlsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowLeft") onIndexChange((index - 1 + options.length) % options.length)
      else if (e.key === "ArrowRight") onIndexChange((index + 1) % options.length)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [index, options.length, onClose, onIndexChange])

  const opt = options[index]

  useEffect(() => {
    if (!resolveSrc || !opt) return
    setLoadError(null)
    if (requestedRef.current.has(opt.url)) return
    requestedRef.current.add(opt.url)
    let cancelled = false
    resolveSrc(opt)
      .then((r) => {
        if (cancelled) return
        if (r.src.startsWith("blob:")) blobUrlsRef.current.add(r.src)
        setResolved((prev) => new Map(prev).set(opt.url, r))
      })
      .catch(() => {
        if (cancelled) return
        requestedRef.current.delete(opt.url)
        setLoadError("Failed to load media")
      })
    return () => { cancelled = true }
  }, [opt, resolveSrc])

  // Revoke every blob URL this session ever created once the Lightbox
  // unmounts — not per-option, so navigating back and forth doesn't refetch
  // already-resolved media.
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [])

  if (!opt) return null

  const cached = resolved.get(opt.url)
  const src = resolveSrc ? cached?.src : opt.url
  const type = cached?.type ?? opt.type
  const loading = !!resolveSrc && !cached && !loadError

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }} onClick={onClose}>
      <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 20, right: 24, background: "none", border: "none", color: "#fff", fontSize: 30, cursor: "pointer" }}>×</button>
      {options.length > 1 && (
        <button onClick={(e) => { e.stopPropagation(); onIndexChange((index - 1 + options.length) % options.length) }} style={{ ...navBtn, left: 20 }} aria-label="Previous">‹</button>
      )}
      {loadError ? (
        <p style={{ color: "#fca5a5", fontSize: 14 }}>{loadError}</p>
      ) : loading ? (
        <p style={{ color: "#fff", fontSize: 13 }}>Loading…</p>
      ) : type === "video" ? (
        // key forces a fresh <video> element per asset — otherwise the
        // browser can keep playing the previous URL's buffered frame while
        // the new src loads.
        <video
          key={src}
          src={src}
          poster={opt.thumbUrl}
          controls
          autoPlay
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: "88vw", maxHeight: "82vh", borderRadius: 8 }}
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element -- signed/external/blob URLs */
        <img src={src} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "88vw", maxHeight: "82vh", objectFit: "contain", borderRadius: 8 }} />
      )}
      {options.length > 1 && (
        <button onClick={(e) => { e.stopPropagation(); onIndexChange((index + 1) % options.length) }} style={{ ...navBtn, right: 20 }} aria-label="Next">›</button>
      )}
      <div style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", color: "#fff", fontSize: 13 }}>{index + 1} / {options.length}</div>
    </div>
  )
}
