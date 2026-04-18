"use client"

import { useState } from "react"
import { loadStripe } from "@stripe/stripe-js"
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js"

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

interface Props {
  orderId:           string
  balanceDue:        number
  stripeCustomerId:  string | null
  buyerName:         string
  eventTitle:        string
}

export default function BalancePayForm({ orderId, balanceDue, stripeCustomerId, buyerName, eventTitle }: Props) {
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState("")
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [paid, setPaid] = useState(false)

  async function handleStartPayment() {
    setLoading(true); setError("")
    try {
      const res = await fetch("/api/balance-payment", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId, balanceDue, stripeCustomerId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to start payment")
      setClientSecret(data.clientSecret)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  if (paid) {
    return (
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-8 text-center space-y-4">
        <span className="text-5xl block">✅</span>
        <p className="text-white font-bold text-lg">Balance paid!</p>
        <p className="text-[#888] text-sm">
          All guest passes for {eventTitle} are now unlocked for scanning.
        </p>
        <a href="https://apps.apple.com/app/wugi/id6760943066"
          className="block w-full bg-[#2a7a5a] hover:bg-[#3a9a72] text-white font-semibold py-3 rounded-xl text-sm transition-colors">
          Open in Wugi App
        </a>
      </div>
    )
  }

  if (clientSecret) {
    return (
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl overflow-hidden">
        <EmbeddedCheckoutProvider
          stripe={stripePromise}
          options={{
            clientSecret,
            onComplete: () => setPaid(true),
          }}
        >
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-red-400 text-sm bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* "Open in app" hint */}
      <button
        onClick={() => { window.location.href = `wugi://pay/${orderId}` }}
        className="w-full text-[#2a7a5a] text-sm font-semibold py-2 hover:underline"
      >
        Have Wugi installed? Pay in app with saved cards →
      </button>

      <button
        onClick={handleStartPayment}
        disabled={loading}
        className="w-full bg-[#2a7a5a] hover:bg-[#3a9a72] disabled:opacity-50 text-white font-bold py-4 rounded-xl text-lg transition-colors"
      >
        {loading ? "Loading payment…" : `Pay $${(balanceDue / 100).toFixed(2)}`}
      </button>

      <p className="text-xs text-center text-[#555]">
        Once paid, all guest passes will be unlocked immediately.
      </p>
    </div>
  )
}
