import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { adminDb } from "@/lib/firebase-admin"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-04-10" })

export async function POST(req: NextRequest) {
  try {
    const { orderId, balanceDue, stripeCustomerId } = await req.json()
    if (!orderId || !balanceDue) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Create a Stripe Checkout Session for the balance amount
    const session = await stripe.checkout.sessions.create({
      mode:        "payment",
      ui_mode:     "embedded",
      return_url:  `${process.env.NEXT_PUBLIC_APP_URL}/pay/${orderId}?session_id={CHECKOUT_SESSION_ID}`,
      customer:    stripeCustomerId || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency:     "usd",
          unit_amount:  balanceDue,
          product_data: {
            name:        "Table Balance Payment",
            description: `Remaining balance for order ${orderId.slice(-8).toUpperCase()}`,
          },
        },
      }],
      metadata:    { orderId, type: "balance_payment" },
      payment_intent_data: {
        metadata: { orderId, type: "balance_payment" },
      },
    })

    return NextResponse.json({ clientSecret: session.client_secret })
  } catch (err: unknown) {
    console.error("Balance payment error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    )
  }
}
