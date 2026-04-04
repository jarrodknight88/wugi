import Link from "next/link"

export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#f5f3ef] dark:bg-[#111111] flex items-center justify-center px-4 transition-colors">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-[#2a7a5a]">404</h1>
        <p className="text-neutral-500 dark:text-[#888]">This venue doesn&apos;t exist or has moved.</p>
        <Link href="/" className="inline-block mt-4 px-6 py-3 bg-[#2a7a5a] rounded-xl text-sm font-semibold text-white hover:bg-[#3a9a72] transition-colors">
          Back to Wugi
        </Link>
      </div>
    </main>
  )
}
