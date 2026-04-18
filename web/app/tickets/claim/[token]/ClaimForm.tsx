"use client"

import { useState, useEffect, useRef } from "react"
import { initializeApp, getApps } from "firebase/app"
import { getFirestore, doc, onSnapshot } from "firebase/firestore"
import QRCode from "qrcode"

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

function getFirebaseDb() {
  if (!getApps().length) initializeApp(firebaseConfig)
  return getFirestore()
}

function hexToRgbString(hex: string): string {
  const h = hex.replace("#", "")
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `${r}, ${g}, ${b}`
}

interface Props {
  token:          string
  eventTitle:     string
  venueName:      string
  eventDate:      string
  eventTime:      string
  fromName:       string
  fromEmail:      string
  passColor:      string | null
  ticketTypeName: string
  passId:         string | null
}

export default function ClaimForm({
  token, eventTitle, venueName, eventDate, eventTime,
  fromName, fromEmail, passColor: initialColor, ticketTypeName, passId,
}: Props) {
  const [name,       setName]       = useState("")
  const [email,      setEmail]      = useState("")
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState("")
  const [accepted,   setAccepted]   = useState(false)
  const [claimedPassId, setClaimedPassId] = useState<string | null>(passId)
  const [passColor,  setPassColor]  = useState(initialColor || "#2a7a5a")
  const [balanceDue, setBalanceDue] = useState(0)
  const [qrDataUrl,  setQrDataUrl]  = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Live Firestore listener — color + balance update in real time
  useEffect(() => {
    const pid = claimedPassId || passId
    if (!pid || !accepted) return
    const db  = getFirebaseDb()
    const ref = doc(db, "passes", pid)
    const unsub = onSnapshot(ref, snap => {
      if (!snap.exists()) return
      const data = snap.data()
      if (data.passColor)  setPassColor(data.passColor)
      if (data.balanceDue !== undefined) setBalanceDue(data.balanceDue ?? 0)
    })
    return unsub
  }, [claimedPassId, passId, accepted])

  // Generate QR after accepted
  useEffect(() => {
    if (!accepted || !claimedPassId) return
    QRCode.toDataURL(claimedPassId, { width: 200, margin: 2, color: { dark: "#111111", light: "#ffffff" } })
      .then(url => setQrDataUrl(url))
      .catch(() => {})
  }, [accepted, claimedPassId])

  // Try Universal Link deep open first; if user is on iOS with Wugi installed, 
  // the OS will intercept and open the app. If not, we stay on web.
  function tryDeepLink() {
    const appUrl = `wugi://tickets/claim/${token}`
    window.location.href = appUrl
    // Fallback: stay on page — if app isn't installed nothing happens
  }

  async function handleAccept() {
    if (!email.trim()) { setError("Email is required to accept the ticket"); return }
    setLoading(true); setError("")
    try {
      const res  = await fetch("https://us-central1-wugi-prod.cloudfunctions.net/claimTransfer", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token, claimerName: name.trim() || email.trim(), claimerEmail: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Claim failed")
      setClaimedPassId(data.passId || data.orderId || claimedPassId)
      setBalanceDue(data.balanceDue ?? 0)
      setAccepted(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  const bgRgb     = hexToRgbString(passColor)
  const walletUrl = claimedPassId ? `https://wugi.us/api/wallet/${claimedPassId}` : null

  // ── Accepted state — show pass card + QR ───────────────────────────
  if (accepted) {
    return (
      <div className="space-y-4">
        {/* Pass card with live color */}
        <div
          className="rounded-2xl overflow-hidden shadow-2xl"
          style={{ background: `linear-gradient(135deg, rgb(${bgRgb}) 0%, rgba(${bgRgb}, 0.7) 100%)` }}
        >
          {/* Card header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <span className="text-white font-black text-xl tracking-tight">wugi</span>
            <span className="bg-black/30 text-white text-xs font-bold px-3 py-1 rounded-full tracking-widest">
              {ticketTypeName?.toUpperCase() || "TICKET"}
            </span>
          </div>

          {/* Event info */}
          <div className="px-5 pb-4">
            <h2 className="text-white font-black text-2xl leading-tight">{eventTitle}</h2>
            <p className="text-white/80 text-sm mt-1">{venueName}</p>
            <p className="text-white/70 text-sm">{eventDate}{eventTime ? ` · ${eventTime}` : ""}</p>
          </div>

          {/* Balance due banner */}
          {balanceDue > 0 && (
            <div className="mx-5 mb-4 bg-black/30 border border-yellow-400/50 rounded-xl p-3">
              <p className="text-yellow-400 text-sm font-bold">
                ⚠️ ${(balanceDue / 100).toFixed(2)} balance due — host must pay before entry
              </p>
            </div>
          )}

          {/* QR code */}
          <div className="flex justify-center pb-6">
            {qrDataUrl ? (
              <div className="bg-white rounded-2xl p-4 shadow-inner">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="QR code" width={180} height={180} />
              </div>
            ) : (
              <div className="bg-white/20 rounded-2xl w-[180px] h-[180px] flex items-center justify-center">
                <span className="text-white/50 text-sm">Loading QR…</span>
              </div>
            )}
          </div>

          {/* Bottom strip */}
          <div className="bg-black/30 px-5 py-3 flex items-center justify-between">
            <p className="text-white/70 text-xs font-mono">
              {claimedPassId?.slice(-12).toUpperCase() || ""}
            </p>
            <span className="text-white/70 text-xs">✓ ACCEPTED</span>
          </div>
        </div>

        {/* Actions */}
        {walletUrl && (
          <a href={walletUrl}
            className="flex items-center justify-center gap-2 w-full bg-black text-white font-semibold py-3.5 rounded-xl text-sm hover:bg-neutral-900 transition-colors">
            Add to Apple Wallet
          </a>
        )}

        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-5 text-center space-y-3">
          <p className="text-[#888] text-xs">View all your passes in the Wugi app</p>
          <a href="https://apps.apple.com/app/wugi/id6760943066"
            className="block w-full bg-[#2a7a5a] hover:bg-[#3a9a72] text-white font-semibold py-3 rounded-xl text-sm transition-colors">
            Download Wugi
          </a>
          <button onClick={tryDeepLink}
            className="block w-full text-[#2a7a5a] text-sm hover:underline">
            Already have Wugi? Open in app →
          </button>
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    )
  }

  // ── Pre-accept state — pass preview + accept CTA ──────────────────
  return (
    <div className="space-y-4">
      {/* Pass preview card */}
      <div
        className="rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: `linear-gradient(135deg, rgb(${bgRgb}) 0%, rgba(${bgRgb}, 0.7) 100%)` }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <span className="text-white font-black text-xl tracking-tight">wugi</span>
          <span className="bg-black/30 text-white text-xs font-bold px-3 py-1 rounded-full tracking-widest">
            {ticketTypeName?.toUpperCase() || "TICKET"}
          </span>
        </div>
        <div className="px-5 pb-6">
          <h2 className="text-white font-black text-2xl leading-tight">{eventTitle}</h2>
          <p className="text-white/80 text-sm mt-1">{venueName}</p>
          <p className="text-white/70 text-sm">{eventDate}{eventTime ? ` · ${eventTime}` : ""}</p>
          <p className="text-white/50 text-xs mt-3">
            From {fromName || fromEmail}
          </p>
        </div>
        {/* Blurred QR placeholder */}
        <div className="flex justify-center pb-6">
          <div className="bg-white/20 rounded-2xl w-[140px] h-[140px] flex items-center justify-center backdrop-blur-sm">
            <span className="text-4xl">🎟️</span>
          </div>
        </div>
      </div>

      {/* "Open in app" hint for iOS */}
      <button onClick={tryDeepLink}
        className="w-full text-[#2a7a5a] text-sm font-semibold py-2 hover:underline">
        Have Wugi installed? Open in app →
      </button>

      {/* Accept form */}
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-5 space-y-4">
        <h3 className="text-white font-bold text-base">Accept this ticket</h3>
        <p className="text-[#888] text-sm leading-relaxed">
          Enter your info to claim this ticket. Once accepted, your QR code will appear.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-1.5">
              Your Name (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#2a7a5a] rounded-xl px-4 py-3 text-sm text-white placeholder-[#555] outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-1.5">
              Your Email *
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#2a7a5a] rounded-xl px-4 py-3 text-sm text-white placeholder-[#555] outline-none transition-colors"
            />
          </div>
        </div>

        {error && (
          <p className="text-red-400 text-sm bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          onClick={handleAccept}
          disabled={loading}
          className="w-full bg-[#2a7a5a] hover:bg-[#3a9a72] disabled:opacity-50 text-white font-bold py-4 rounded-xl text-base transition-colors"
        >
          {loading ? "Accepting…" : "✓ Accept Ticket"}
        </button>

        <p className="text-xs text-center text-[#555]">
          By accepting you agree to Wugi&apos;s no-refund policy.
          The original holder will lose access to this ticket.
        </p>
      </div>

      <div className="text-center">
        <a href="https://apps.apple.com/app/wugi/id6760943066"
          className="text-[#2a7a5a] text-sm hover:underline">
          Download Wugi to manage your passes →
        </a>
      </div>
    </div>
  )
}
