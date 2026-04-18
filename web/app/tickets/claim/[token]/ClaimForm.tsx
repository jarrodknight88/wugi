"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

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

function hexToRgbString(hex: string): string {
  const h = (hex || "2a7a5a").replace("#", "")
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `${r}, ${g}, ${b}`
}

export default function ClaimForm({
  token, eventTitle, venueName, eventDate, eventTime,
  fromName, fromEmail, passColor: initialColor, ticketTypeName,
}: Props) {
  const router = useRouter()
  const [name,    setName]    = useState("")
  const [email,   setEmail]   = useState("")
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState("")

  const bgRgb = hexToRgbString(initialColor || "#2a7a5a")

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
      // Redirect to permanent pass view page — works forever, not just this session
      const pid = data.passId || data.orderId
      router.replace(`/tickets/${pid}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong")
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Pass preview card — colored background, blurred QR */}
      <div className="rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: `linear-gradient(135deg, rgb(${bgRgb}) 0%, rgba(${bgRgb}, 0.7) 100%)` }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <span className="text-white font-black text-xl tracking-tight">wugi</span>
          <span className="bg-black/30 text-white text-xs font-bold px-3 py-1 rounded-full tracking-widest">
            {(ticketTypeName || "TICKET").toUpperCase()}
          </span>
        </div>
        <div className="px-5 pb-6">
          <h2 className="text-white font-black text-2xl leading-tight">{eventTitle}</h2>
          <p className="text-white/80 text-sm mt-1">{venueName}</p>
          <p className="text-white/70 text-sm">{eventDate}{eventTime ? ` · ${eventTime}` : ""}</p>
          <p className="text-white/50 text-xs mt-3">From {fromName || fromEmail}</p>
        </div>
        <div className="flex justify-center pb-6">
          <div className="bg-white/20 rounded-2xl w-[140px] h-[140px] flex items-center justify-center backdrop-blur-sm">
            <span className="text-4xl">🎟️</span>
          </div>
        </div>
      </div>

      {/* Open in app — Universal Link */}
      <button onClick={() => { window.location.href = `wugi://tickets/claim/${token}` }}
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
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Your name"
              className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#2a7a5a] rounded-xl px-4 py-3 text-sm text-white placeholder-[#555] outline-none transition-colors"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#888] uppercase tracking-wide mb-1.5">
              Your Email *
            </label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#2a7a5a] rounded-xl px-4 py-3 text-sm text-white placeholder-[#555] outline-none transition-colors"/>
          </div>
        </div>
        {error && (
          <p className="text-red-400 text-sm bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">{error}</p>
        )}
        <button onClick={handleAccept} disabled={loading}
          className="w-full bg-[#2a7a5a] hover:bg-[#3a9a72] disabled:opacity-50 text-white font-bold py-4 rounded-xl text-base transition-colors">
          {loading ? "Accepting…" : "✓ Accept Ticket"}
        </button>
        <p className="text-xs text-center text-[#555]">
          By accepting you agree to Wugi&apos;s no-refund policy.
          The original holder will lose access to this ticket.
        </p>
      </div>

      <div className="text-center">
        <a href="https://apps.apple.com/app/wugi/id6760943066" className="text-[#2a7a5a] text-sm hover:underline">
          Download Wugi to manage your passes →
        </a>
      </div>
    </div>
  )
}
