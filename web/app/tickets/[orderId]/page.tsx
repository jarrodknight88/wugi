import { adminDb } from "@/lib/firebase-admin"
import { notFound } from "next/navigation"
import Link from "next/link"

export const dynamic = "force-dynamic"

async function getOrGeneratePass(orderId: string) {
  // Check if pass already exists in Firestore
  try {
    const doc = await adminDb.collection("orders").doc(orderId).get()
    if (doc.exists && doc.data()?.passUrl) {
      return { passUrl: doc.data()?.passUrl, order: doc.data() }
    }
  } catch { /* order may not exist */ }

  // Try to generate pass on demand using order data
  // For now return null — pass generation happens post-checkout
  return null
}

export default async function TicketReclaimPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  const result = await getOrGeneratePass(orderId)

  return (
    <main className="min-h-screen bg-[#f5f3ef] dark:bg-[#111111] flex items-center justify-center px-4 transition-colors">
      <div className="max-w-md w-full space-y-6">

        {/* Header */}
        <div className="text-center space-y-2">
          <Link href="/" className="text-[#2a7a5a] font-bold text-2xl tracking-tight">WUGI</Link>
          <h1 className="text-xl font-bold text-[#111111] dark:text-white mt-4">Your Ticket</h1>
          <p className="text-sm text-neutral-500 dark:text-[#888]">Order #{orderId}</p>
        </div>

        {result?.passUrl ? (
          /* Pass available */
          <div className="bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#2a2a2a] rounded-2xl p-6 space-y-4 text-center shadow-sm">
            <span className="text-5xl">🎟️</span>
            <div>
              <p className="font-semibold text-[#111111] dark:text-white">{result.order?.eventTitle}</p>
              <p className="text-sm text-neutral-500 dark:text-[#888]">{result.order?.venueName}</p>
            </div>

            {/* Add to Wallet */}
            <a
              href={result.passUrl}
              className="flex items-center justify-center gap-2 w-full bg-black text-white font-semibold py-3.5 rounded-xl text-sm hover:bg-neutral-800 transition-colors"
            >
              Add to Apple Wallet
            </a>

            {/* Direct download */}
            <a
              href={result.passUrl}
              download
              className="block text-sm text-[#2a7a5a] hover:underline"
            >
              Download pass file (.pkpass)
            </a>
          </div>
        ) : (
          /* No pass found */
          <div className="bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#2a2a2a] rounded-2xl p-6 space-y-4 text-center shadow-sm">
            <span className="text-5xl">🔍</span>
            <div>
              <p className="font-semibold text-[#111111] dark:text-white">Pass not found</p>
              <p className="text-sm text-neutral-500 dark:text-[#888] mt-1">
                If you purchased a ticket, check your email for the confirmation and pass link.
              </p>
            </div>
            <a
              href="mailto:jarrod@wugi.us?subject=Lost Ticket&body=Order ID: orderId"
              className="block w-full border border-[#2a7a5a] text-[#2a7a5a] font-semibold py-3 rounded-xl text-sm hover:bg-[#2a7a5a]/5 transition-colors"
            >
              Contact Support
            </a>
          </div>
        )}

        <p className="text-center text-xs text-neutral-400 dark:text-[#666]">
          Need help? Email <a href="mailto:jarrod@wugi.us" className="text-[#2a7a5a]">jarrod@wugi.us</a>
        </p>
      </div>
    </main>
  )
}
