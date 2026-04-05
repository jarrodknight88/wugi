"use client"

import { useState } from "react"
import Link from "next/link"

interface Props {
  token: string
  eventTitle: string
  venueName: string
  eventDate: string
  fromEmail: string
}

export default function ClaimForm({ token, eventTitle, venueName, eventDate, fromEmail }: Props) {
  const [name, setName]       = useState("")
  const [email, setEmail]     = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState("")
  const [passUrl, setPassUrl] = useState<string | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)

  async function handleClaim() {
    if (!email.trim()) { setError("Email is required"); return }
    setLoading(true)
    setError("")
    try {
      const res = await fetch("https://us-central1-wugi-prod.cloudfunctions.net/claimTransfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, claimerName: name.trim() || email.trim(), claimerEmail: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Claim failed")
      setPassUrl(data.passUrl)
      setOrderId(data.orderId)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  if (passUrl) {
    return (
      <div className="space-y-4 text-center">
        <span className="text-5xl block">🎟️</span>
        <h2 className="text-xl font-bold text-[#111111] dark:text-white">Ticket claimed!</h2>
        <p className="text-sm text-neutral-500 dark:text-[#888]">Your pass for <span className="font-semibold text-[#111111] dark:text-white">{eventTitle}</span> is ready.</p>
        <a href={passUrl} className="flex items-center justify-center gap-2 w-full bg-black text-white font-semibold py-3.5 rounded-xl text-sm hover:bg-neutral-800 transition-colors">
          Add to Apple Wallet
        </a>
        {orderId && (
          <Link href={`/tickets/${orderId}`} className="block text-sm text-[#2a7a5a] hover:underline">
            View pass details →
          </Link>
        )}
        <div className="border-t border-neutral-200 dark:border-[#2a2a2a] pt-4 mt-2">
          <p className="text-xs text-neutral-500 dark:text-[#888] mb-3">Get the full Wugi experience</p>
          <a href="https://apps.apple.com/app/wugi/id829564750" className="block w-full border border-[#2a7a5a] text-[#2a7a5a] font-semibold py-3 rounded-xl text-sm hover:bg-[#2a7a5a]/5 transition-colors">
            Download Wugi App
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-[#2a7a5a]/10 dark:bg-[#2a7a5a]/20 rounded-xl p-4 text-sm text-[#111111] dark:text-white">
        <p className="font-semibold">{eventTitle}</p>
        <p className="text-neutral-500 dark:text-[#888]">{venueName} · {eventDate}</p>
        <p className="text-xs text-neutral-400 dark:text-[#666] mt-1">Transferred from {fromEmail}</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-neutral-500 dark:text-[#888] uppercase tracking-wide mb-1.5">Your Name (optional)</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Jarrod Knight"
            className="w-full bg-white dark:bg-[#222] border border-neutral-200 dark:border-[#2a2a2a] rounded-xl px-4 py-3 text-sm text-[#111111] dark:text-white placeholder-neutral-400 dark:placeholder-[#666] focus:outline-none focus:border-[#2a7a5a]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-neutral-500 dark:text-[#888] uppercase tracking-wide mb-1.5">Your Email *</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@email.com"
            className="w-full bg-white dark:bg-[#222] border border-neutral-200 dark:border-[#2a2a2a] rounded-xl px-4 py-3 text-sm text-[#111111] dark:text-white placeholder-neutral-400 dark:placeholder-[#666] focus:outline-none focus:border-[#2a7a5a]"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">{error}</p>}

      <button
        onClick={handleClaim}
        disabled={loading}
        className="w-full bg-[#2a7a5a] hover:bg-[#3a9a72] disabled:opacity-60 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors"
      >
        {loading ? "Claiming..." : "Claim My Ticket"}
      </button>

      <p className="text-xs text-center text-neutral-400 dark:text-[#666]">
        By claiming you agree to Wugi&apos;s no-refund policy. The original ticket holder will lose access.
      </p>
    </div>
  )
}
