import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 30

const CHECKOUT_FUNCTION_URL =
  "https://us-central1-wugi-prod.cloudfunctions.net/createCheckoutSession"

export async function POST(req: NextRequest) {
  try {
    const { eventId, ticketTypeId, quantity, eventTitle, ticketName, unitPrice } =
      await req.json()

    if (!eventId || !ticketTypeId || !quantity || !unitPrice) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const origin = req.headers.get("origin") ?? "https://wugi.us"

    const res = await fetch(CHECKOUT_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId,
        ticketTypeId,
        quantity,
        successUrl: `${origin}/events/success?event=${encodeURIComponent(eventTitle)}&eventId=${encodeURIComponent(eventId)}&ticketType=${encodeURIComponent(ticketName)}&qty=${quantity}&total=${unitPrice * quantity}`,
        cancelUrl: `${origin}/events/${eventId}`,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? "Checkout failed" }, { status: 500 })
    }

    return NextResponse.json({ url: data.url })
  } catch (e: unknown) {
    console.error("Checkout proxy error:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Checkout failed" },
      { status: 500 }
    )
  }
}
