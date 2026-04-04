"use client"

import { useState } from "react"

interface TicketType {
  id: string
  name: string
  price: number
  description: string
  capacity: number
  available: number
  sortOrder: number
}

interface Props {
  eventId: string
  ticketTypes: TicketType[]
  eventTitle: string
}

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

export default function TicketSection({ eventId, ticketTypes, eventTitle }: Props) {
  const [selected, setSelected] = useState<string>(ticketTypes[0]?.id ?? "")
  const [quantity, setQuantity] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const selectedTicket = ticketTypes.find(t => t.id === selected)
  const subtotal = selectedTicket ? selectedTicket.price * quantity : 0
  const fee = Math.min(Math.max(Math.round(subtotal * 0.12), 199), 10000)
  const total = subtotal + fee

  async function handleCheckout() {
    if (!selectedTicket) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          ticketTypeId: selected,
          quantity,
          eventTitle,
          ticketName: selectedTicket.name,
          unitPrice: selectedTicket.price,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Checkout failed")
      window.location.href = data.url
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">

      {/* Ticket type selector */}
      <div className="space-y-2">
        {ticketTypes.map((ticket) => {
          const isSelected = selected === ticket.id
          const soldOut = ticket.available === 0
          return (
            <button
              key={ticket.id}
              disabled={soldOut}
              onClick={() => { setSelected(ticket.id); setQuantity(1); }}
              className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                soldOut
                  ? "opacity-40 cursor-not-allowed border-neutral-200 dark:border-[#2a2a2a]"
                  : isSelected
                  ? "border-[#2a7a5a] bg-[#2a7a5a]/5 dark:bg-[#2a7a5a]/10"
                  : "border-neutral-200 dark:border-[#2a2a2a] hover:border-[#2a7a5a]/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? "border-[#2a7a5a]" : "border-neutral-300 dark:border-[#444]"}`}>
                    {isSelected && <div className="w-2 h-2 rounded-full bg-[#2a7a5a]" />}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-[#111111] dark:text-white">{ticket.name}</p>
                    <p className="text-xs text-neutral-500 dark:text-[#888] mt-0.5">{ticket.description}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <p className="font-bold text-[#111111] dark:text-white">{formatPrice(ticket.price)}</p>
                  {soldOut ? (
                    <p className="text-xs text-red-500">Sold out</p>
                  ) : (
                    <p className="text-xs text-neutral-400 dark:text-[#666]">{ticket.available} left</p>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Quantity */}
      {selectedTicket && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-600 dark:text-[#aaa]">Quantity</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setQuantity(q => Math.max(1, q - 1))} className="w-8 h-8 rounded-full border border-neutral-200 dark:border-[#2a2a2a] flex items-center justify-center text-lg hover:border-[#2a7a5a] transition-colors">−</button>
            <span className="w-6 text-center font-semibold text-[#111111] dark:text-white">{quantity}</span>
            <button onClick={() => setQuantity(q => Math.min(selectedTicket.available, q + 1))} className="w-8 h-8 rounded-full border border-neutral-200 dark:border-[#2a2a2a] flex items-center justify-center text-lg hover:border-[#2a7a5a] transition-colors">+</button>
          </div>
        </div>
      )}

      {/* Price breakdown */}
      {selectedTicket && (
        <div className="border-t border-neutral-200 dark:border-[#2a2a2a] pt-3 space-y-1.5">
          <div className="flex justify-between text-sm text-neutral-500 dark:text-[#888]">
            <span>{formatPrice(selectedTicket.price)} × {quantity}</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm text-neutral-500 dark:text-[#888]">
            <span>Service fee</span>
            <span>{formatPrice(fee)}</span>
          </div>
          <div className="flex justify-between font-bold text-[#111111] dark:text-white pt-1 border-t border-neutral-200 dark:border-[#2a2a2a]">
            <span>Total</span>
            <span>{formatPrice(total)}</span>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">{error}</p>}

      <button
        onClick={handleCheckout}
        disabled={loading || !selectedTicket}
        className="w-full bg-[#2a7a5a] hover:bg-[#3a9a72] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors text-sm"
      >
        {loading ? "Processing..." : `Buy Tickets — ${formatPrice(total)}`}
      </button>

      <p className="text-xs text-center text-neutral-400 dark:text-[#666]">
        Secure checkout · No refunds · Powered by Wugi
      </p>
    </div>
  )
}
