import { adminDb } from "@/lib/firebase-admin"
import { notFound } from "next/navigation"
import BalancePayForm from "./BalancePayForm"

export const dynamic = "force-dynamic"

async function getOrderBalance(orderId: string) {
  try {
    const orderDoc = await adminDb.collection("orders").doc(orderId).get()
    if (!orderDoc.exists) return null
    const data = orderDoc.data()!
    if (!data.balanceDue || data.balanceDue <= 0) return null

    // Get event + venue details for display
    const eventDoc = data.eventId
      ? await adminDb.collection("events").doc(data.eventId).get()
      : null
    const event = eventDoc?.data()

    return {
      orderId,
      balanceDue:    data.balanceDue as number,
      depositPaid:   data.depositPaid ?? 0,
      eventTitle:    event?.title    || data.eventTitle    || "",
      venueName:     event?.venueName || data.venueName    || "",
      eventDate:     event?.date      || data.eventDate    || "",
      eventTime:     event?.time      || data.eventTime    || "",
      ticketTypeName: data.items?.[0]?.ticketTypeName      || "",
      quantity:       data.items?.reduce((s: number, i: any) => s + i.quantity, 0) ?? 1,
      buyerName:      data.buyerName  || "",
      stripeCustomerId: data.stripeCustomerId || null,
    }
  } catch { return null }
}

export default async function BalancePayPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params
  const order = await getOrderBalance(orderId)
  if (!order) notFound()

  return (
    <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-6 py-12">
        <div className="text-center">
          <span className="text-[#2a7a5a] font-black text-3xl tracking-tight">wugi</span>
          <p className="text-[#888] text-sm mt-2">Balance Payment</p>
        </div>

        {/* Event summary card */}
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-5 space-y-2">
          <p className="text-[#888] text-xs font-semibold uppercase tracking-wide">Event</p>
          <p className="text-white font-bold text-lg">{order.eventTitle}</p>
          <p className="text-[#888] text-sm">{order.venueName}{order.eventDate ? ` · ${order.eventDate}` : ""}{order.eventTime ? ` · ${order.eventTime}` : ""}</p>
          <div className="border-t border-[#2a2a2a] pt-3 mt-2 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-[#888]">Ticket type</span>
              <span className="text-white">{order.ticketTypeName || "Table Package"}</span>
            </div>
            {order.depositPaid > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[#888]">Deposit paid</span>
                <span className="text-[#2a7a5a]">${(order.depositPaid / 100).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold">
              <span className="text-[#888]">Balance due</span>
              <span className="text-yellow-400">${(order.balanceDue / 100).toFixed(2)}</span>
            </div>
          </div>
        </div>

        <BalancePayForm
          orderId={orderId}
          balanceDue={order.balanceDue}
          stripeCustomerId={order.stripeCustomerId}
          buyerName={order.buyerName}
          eventTitle={order.eventTitle}
        />

        <p className="text-center text-xs text-[#555]">
          Secured by Stripe · Payment info never stored by Wugi
        </p>
      </div>
    </main>
  )
}
