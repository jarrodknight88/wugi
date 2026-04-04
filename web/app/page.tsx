import { adminDb } from "@/lib/firebase-admin"
import Link from "next/link"
import HomeClient from "./components/HomeClient"

export const dynamic = "force-dynamic"

async function getFeaturedVenues() {
  const snap = await adminDb
    .collection("venues")
    .where("status", "==", "approved")
    .where("isFeatured", "==", true)
    .limit(8)
    .get()
  return snap.docs.map(d => {
    const data = d.data()
    return {
      id: d.id,
      name: data.name ?? "",
      slug: data.slug ?? "",
      category: data.category ?? "",
      vibes: data.vibes ?? [],
      neighborhood: data.neighborhood ?? null,
      media: data.media ?? [],
      logoUrl: data.logoUrl ?? null,
      rating: data.rating ?? null,
    }
  })
}

async function getFeaturedEvents() {
  const snap = await adminDb
    .collection("events")
    .where("status", "==", "approved")
    .where("isFeatured", "==", true)
    .limit(6)
    .get()
  return snap.docs.map(d => {
    const data = d.data()
    return {
      id: d.id,
      title: data.title ?? "",
      slug: data.slug ?? "",
      venueName: data.venueName ?? data.venue ?? "",
      date: data.date ?? "",
      time: data.time ?? "",
      vibes: data.vibes ?? [],
      media: (data.media ?? []).map((m: { type: string; uri: string }) => ({ type: m.type, uri: m.uri })),
    }
  })
}

export default async function HomePage() {
  const [venues, events] = await Promise.all([
    getFeaturedVenues(),
    getFeaturedEvents(),
  ])

  return (
    <main className="min-h-screen bg-[#f5f3ef] dark:bg-[#111111] transition-colors">

      {/* ── Nav ───────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-[#f5f3ef]/90 dark:bg-[#111111]/90 backdrop-blur-md border-b border-neutral-200 dark:border-[#2a2a2a]">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="text-[#2a7a5a] font-bold text-xl tracking-tight">WUGI</Link>
          <div className="flex items-center gap-4">
            <span className="text-xs text-neutral-500 dark:text-[#888] hidden sm:block">Atlanta</span>
            <a
              href="https://apps.apple.com/app/wugi/id829564750"
              className="bg-[#2a7a5a] hover:bg-[#3a9a72] text-white text-xs font-semibold px-4 py-2 rounded-full transition-colors"
            >
              Get the App
            </a>
          </div>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────── */}
      <div className="bg-[#f5f3ef] dark:bg-[#111111] border-b border-neutral-200 dark:border-[#2a2a2a]">
        <div className="max-w-6xl mx-auto px-4 py-10 sm:py-16">
          <div className="max-w-2xl">
            <h1 className="text-4xl sm:text-5xl font-bold text-[#111111] dark:text-white leading-tight">
              What U Gettin Into<span className="text-[#2a7a5a]">?</span>
            </h1>
            <p className="mt-3 text-lg text-neutral-500 dark:text-[#888]">
              Discover Atlanta&apos;s best venues, events, and nightlife — all in one place.
            </p>
          </div>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        <HomeClient venues={venues} events={events} />
      </div>

      {/* ── Footer ────────────────────────────────────────────── */}
      <footer className="border-t border-neutral-200 dark:border-[#2a2a2a] mt-16">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-neutral-500 dark:text-[#888]">© 2026 Wugi Media LLC · Atlanta, GA</p>
          <div className="flex gap-6 text-sm text-neutral-500 dark:text-[#888]">
            <a href="https://instagram.com/wugiapp" target="_blank" rel="noopener noreferrer" className="hover:text-[#2a7a5a] transition-colors">Instagram</a>
            <a href="mailto:jarrod@wugi.us" className="hover:text-[#2a7a5a] transition-colors">Contact</a>
          </div>
        </div>
      </footer>

    </main>
  )
}
