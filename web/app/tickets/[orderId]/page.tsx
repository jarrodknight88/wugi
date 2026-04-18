import { adminDb } from "@/lib/firebase-admin"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import PassView from "./PassView"

export const dynamic = "force-dynamic"

async function getPass(passId: string) {
  try {
    // First try passes collection (primary)
    const passDoc = await adminDb.collection("passes").doc(passId).get()
    if (passDoc.exists) {
      const d = passDoc.data()!
      return {
        passId:        passDoc.id,
        orderId:       d.orderId        || passDoc.id,
        eventTitle:    d.eventTitle     || "",
        venueName:     d.venueName      || "",
        eventDate:     d.eventDate      || "",
        eventTime:     d.eventTime      || "",
        ticketTypeName: d.ticketTypeName || "Ticket",
        holderName:    d.holderName     || "",
        passColor:     d.passColor      || null,
        colorLabel:    d.colorLabel     || null,
        balanceDue:    d.balanceDue     ?? 0,
        depositPaid:   d.depositPaid    ?? 0,
        passUrl:       d.appleWalletPassUrl || d.passUrl || null,
        status:        d.scanStatus     || "valid",
        source:        d.source         || null,
        transferredFromName: d.transferredFromName || null,
      }
    }
    // Fallback: try orders collection (legacy)
    const orderDoc = await adminDb.collection("orders").doc(passId).get()
    if (orderDoc.exists) {
      const d = orderDoc.data()!
      return {
        passId,
        orderId:       passId,
        eventTitle:    d.eventTitle  || d.eventName || "",
        venueName:     d.venueName   || "",
        eventDate:     d.eventDate   || "",
        eventTime:     d.eventTime   || "",
        ticketTypeName: d.items?.[0]?.ticketTypeName || "Ticket",
        holderName:    d.buyerName   || "",
        passColor:     d.passColor   || null,
        colorLabel:    d.colorLabel  || null,
        balanceDue:    d.balanceDue  ?? 0,
        depositPaid:   d.depositPaid ?? 0,
        passUrl:       d.passUrl     || null,
        status:        "valid",
        source:        d.source      || null,
        transferredFromName: null,
      }
    }
    return null
  } catch { return null }
}

export async function generateMetadata({ params }: { params: Promise<{ passId: string }> }): Promise<Metadata> {
  const { passId } = await params
  const pass = await getPass(passId)
  if (!pass) return { title: "Ticket | Wugi" }
  return {
    title: `${pass.eventTitle} | Wugi`,
    description: `${pass.ticketTypeName} · ${pass.venueName} · ${pass.eventDate}`,
    openGraph: {
      title: `${pass.eventTitle} | Wugi`,
      description: `${pass.ticketTypeName} at ${pass.venueName}`,
      images: [{ url: "https://wugi.us/og-default.svg", width: 1200, height: 630 }],
    },
  }
}

export default async function PassPage({ params }: { params: Promise<{ passId: string }> }) {
  const { passId } = await params
  const pass = await getPass(passId)
  if (!pass) notFound()
  return <PassView pass={pass} />
}
