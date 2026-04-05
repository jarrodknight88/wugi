import { adminDb } from "@/lib/firebase-admin"
import { notFound } from "next/navigation"
import Link from "next/link"
import ClaimForm from "./ClaimForm"

export const dynamic = "force-dynamic"

async function getTransfer(token: string) {
  const snap = await adminDb
    .collection("transfers")
    .where("token", "==", token)
    .limit(1)
    .get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  const data = doc.data()
  return {
    id:         doc.id,
    status:     data.status,
    eventTitle: data.eventTitle ?? "",
    venueName:  data.venueName ?? "",
    eventDate:  data.eventDate ?? "",
    fromEmail:  data.fromEmail ?? "",
    expiresAt:  data.expiresAt?.toDate?.()?.toISOString() ?? null,
  }
}

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const transfer = await getTransfer(token)

  if (!transfer) notFound()

  const expired  = transfer.expiresAt ? new Date(transfer.expiresAt) < new Date() : false
  const claimed  = transfer.status === "claimed"
  const cancelled = transfer.status === "cancelled"

  return (
    <main className="min-h-screen bg-[#f5f3ef] dark:bg-[#111111] flex items-center justify-center px-4 transition-colors">
      <div className="max-w-md w-full space-y-6">

        <div className="text-center">
          <Link href="/" className="text-[#2a7a5a] font-bold text-2xl tracking-tight">WUGI</Link>
          <h1 className="text-xl font-bold text-[#111111] dark:text-white mt-4">Ticket Transfer</h1>
          <p className="text-sm text-neutral-500 dark:text-[#888] mt-1">Someone sent you a ticket</p>
        </div>

        <div className="bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#2a2a2a] rounded-2xl p-6 shadow-sm dark:shadow-none">
          {expired ? (
            <div className="text-center space-y-3">
              <span className="text-4xl">⏰</span>
              <p className="font-semibold text-[#111111] dark:text-white">Transfer expired</p>
              <p className="text-sm text-neutral-500 dark:text-[#888]">This transfer link has expired. Ask the sender to send a new one.</p>
            </div>
          ) : claimed ? (
            <div className="text-center space-y-3">
              <span className="text-4xl">✅</span>
              <p className="font-semibold text-[#111111] dark:text-white">Already claimed</p>
              <p className="text-sm text-neutral-500 dark:text-[#888]">This ticket has already been claimed.</p>
            </div>
          ) : cancelled ? (
            <div className="text-center space-y-3">
              <span className="text-4xl">❌</span>
              <p className="font-semibold text-[#111111] dark:text-white">Transfer cancelled</p>
              <p className="text-sm text-neutral-500 dark:text-[#888]">The sender cancelled this transfer.</p>
            </div>
          ) : (
            <ClaimForm
              token={token}
              eventTitle={transfer.eventTitle}
              venueName={transfer.venueName}
              eventDate={transfer.eventDate}
              fromEmail={transfer.fromEmail}
            />
          )}
        </div>

      </div>
    </main>
  )
}
