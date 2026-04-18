import { adminDb } from "@/lib/firebase-admin"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import ClaimForm from "./ClaimForm"

export const dynamic = "force-dynamic"

async function getTransfer(token: string) {
  const snap = await adminDb
    .collection("transfers")
    .where("token", "==", token)
    .limit(1)
    .get()
  if (snap.empty) return null
  const doc  = snap.docs[0]
  const data = doc.data()

  // Also fetch the pass for color + ticket details
  let passColor: string | null = null
  let ticketTypeName: string   = ""
  let passId: string | null    = null

  if (data.passId) {
    try {
      const passDoc = await adminDb.collection("passes").doc(data.passId).get()
      if (passDoc.exists) {
        passColor      = passDoc.data()?.passColor || null
        ticketTypeName = passDoc.data()?.ticketTypeName || ""
        passId         = passDoc.id
      }
    } catch {}
  }

  return {
    id:            doc.id,
    token,
    status:        data.status,
    eventTitle:    data.eventTitle  ?? "",
    venueName:     data.venueName   ?? "",
    eventDate:     data.eventDate   ?? "",
    eventTime:     data.eventTime   ?? "",
    fromName:      data.fromName    ?? "",
    fromEmail:     data.fromEmail   ?? "",
    passColor,
    ticketTypeName,
    passId,
    expiresAt: data.expiresAt?.toDate?.()?.toISOString() ?? null,
  }
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const transfer  = await getTransfer(token)
  if (!transfer) return { title: "Ticket Transfer | Wugi" }
  return {
    title: `${transfer.fromName || "Someone"} sent you a ticket to ${transfer.eventTitle} | Wugi`,
    description: `${transfer.eventTitle} at ${transfer.venueName} · ${transfer.eventDate}`,
    openGraph: {
      title:       `You've got a ticket to ${transfer.eventTitle}!`,
      description: `${transfer.venueName} · ${transfer.eventDate}. Tap to accept.`,
      images:      [{ url: "https://wugi.us/og-default.svg", width: 1200, height: 630 }],
    },
  }
}

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token }  = await params
  const transfer   = await getTransfer(token)
  if (!transfer) notFound()

  const expired   = transfer.expiresAt ? new Date(transfer.expiresAt) < new Date() : false
  const claimed   = transfer.status === "claimed"
  const cancelled = transfer.status === "cancelled"

  return (
    <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-6 py-12">
        <div className="text-center">
          <span className="text-[#2a7a5a] font-black text-3xl tracking-tight">wugi</span>
          <p className="text-[#888] text-sm mt-2">You've received a ticket</p>
        </div>

        {expired ? (
          <StatusCard icon="⏰" title="Transfer expired" body="This transfer link has expired. Ask the sender to send a new one." />
        ) : claimed ? (
          <StatusCard icon="✅" title="Already claimed" body="This ticket has already been claimed." />
        ) : cancelled ? (
          <StatusCard icon="❌" title="Transfer cancelled" body="The sender cancelled this transfer." />
        ) : (
          <ClaimForm
            token={token}
            eventTitle={transfer.eventTitle}
            venueName={transfer.venueName}
            eventDate={transfer.eventDate}
            eventTime={transfer.eventTime}
            fromName={transfer.fromName}
            fromEmail={transfer.fromEmail}
            passColor={transfer.passColor}
            ticketTypeName={transfer.ticketTypeName}
            passId={transfer.passId}
          />
        )}
      </div>
    </main>
  )
}

function StatusCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-8 text-center space-y-3">
      <span className="text-5xl block">{icon}</span>
      <p className="font-bold text-white text-lg">{title}</p>
      <p className="text-[#888] text-sm">{body}</p>
    </div>
  )
}
