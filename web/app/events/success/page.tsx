import Link from "next/link"

interface Props {
  searchParams: Promise<{ event?: string; orderId?: string; passUrl?: string }>
}

export default async function SuccessPage({ searchParams }: Props) {
  const { event, orderId, passUrl } = await searchParams

  return (
    <main className="min-h-screen bg-[#f5f3ef] dark:bg-[#111111] flex items-center justify-center px-4 transition-colors">
      <div className="max-w-md w-full text-center space-y-6">

        <div className="w-20 h-20 bg-[#2a7a5a]/10 dark:bg-[#2a7a5a]/20 rounded-full flex items-center justify-center mx-auto">
          <span className="text-4xl">🎟️</span>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-[#111111] dark:text-white">You&apos;re in!</h1>
          {event && (
            <p className="text-neutral-600 dark:text-[#aaa]">
              Your tickets for <span className="font-semibold text-[#111111] dark:text-white">{event}</span> are confirmed.
            </p>
          )}
          <p className="text-sm text-neutral-500 dark:text-[#888]">Check your email for your ticket confirmation.</p>
        </div>

        <div className="flex flex-col gap-3">
          {/* Add to Apple Wallet */}
          {passUrl && (
            <a
              href={passUrl}
              className="flex items-center justify-center gap-2 w-full bg-black text-white font-semibold py-3.5 rounded-xl text-sm hover:bg-neutral-800 transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
              </svg>
              Add to Apple Wallet
            </a>
          )}

          {/* Reclaim link */}
          {orderId && (
            <a
              href={`/tickets/${orderId}`}
              className="text-sm text-[#2a7a5a] hover:underline"
            >
              View or re-download your pass →
            </a>
          )}

          <Link
            href="/"
            className="px-6 py-3 bg-[#2a7a5a] hover:bg-[#3a9a72] text-white font-semibold rounded-xl text-sm transition-colors"
          >
            Discover More Events
          </Link>

          <a
            href="https://apps.apple.com/app/wugi/id829564750"
            className="px-6 py-3 border border-neutral-200 dark:border-[#2a2a2a] text-neutral-700 dark:text-[#ccc] font-semibold rounded-xl text-sm hover:bg-neutral-50 dark:hover:bg-[#1a1a1a] transition-colors"
          >
            Download Wugi App
          </a>
        </div>
      </div>
    </main>
  )
}
