import { notFound } from "next/navigation"
import { adminDb } from "@/lib/firebase-admin"
import Link from "next/link"

interface Venue {
  id: string
  name: string
  category: string
  address: string
  phone?: string
  website?: string
  instagram?: string
  about: string
  attributes: string[]
  vibes: string[]
  hours?: Record<string, string>
  logoUrl?: string
  media?: string[]
  neighborhood?: string
  rating?: number
  priceLevel?: number
  market: string
  slug: string
}

async function getVenue(market: string, slug: string): Promise<Venue | null> {
  const snap = await adminDb
    .collection("venues")
    .where("slug", "==", slug)
    .where("market", "==", market)
    .limit(1)
    .get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return { id: doc.id, ...doc.data() } as Venue
}

const VIBE_COLORS: Record<string, string> = {
  "Boujee":      "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700/50",
  "High Energy": "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700/50",
  "Divey":       "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-700/50",
  "Late Night":  "bg-blue-100  text-blue-800  border-blue-200  dark:bg-blue-900/40  dark:text-blue-300  dark:border-blue-700/50",
  "Rooftop":     "bg-sky-100   text-sky-800   border-sky-200   dark:bg-sky-900/40   dark:text-sky-300   dark:border-sky-700/50",
  "Speakeasy":   "bg-rose-100  text-rose-800  border-rose-200  dark:bg-rose-900/40  dark:text-rose-300  dark:border-rose-700/50",
}

function PriceLevel({ level }: { level?: number }) {
  if (!level) return null
  return (
    <span className="text-sm text-neutral-500 dark:text-[#888]">
      {"$".repeat(level)}<span className="opacity-30">{"$".repeat(4 - level)}</span>
    </span>
  )
}

function StarRating({ rating }: { rating?: number }) {
  if (!rating) return null
  return (
    <div className="flex items-center gap-1">
      <span className="text-[#2a7a5a] font-semibold">{rating.toFixed(1)}</span>
      <div className="flex">
        {[1, 2, 3, 4, 5].map((s) => (
          <svg key={s} className={`w-3.5 h-3.5 ${s <= Math.round(rating) ? "text-[#2a7a5a]" : "text-neutral-300 dark:text-[#333]"}`} fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        ))}
      </div>
    </div>
  )
}

export async function generateMetadata({ params }: { params: Promise<{ market: string; slug: string }> }) {
  const { market, slug } = await params
  const venue = await getVenue(market, slug)
  if (!venue) return { title: "Venue Not Found | Wugi" }
  return {
    title: `${venue.name} | Wugi`,
    description: venue.about?.slice(0, 160),
  }
}

export default async function VenuePage({ params }: { params: Promise<{ market: string; slug: string }> }) {
  const { market, slug } = await params
  const venue = await getVenue(market, slug)
  if (!venue) notFound()

  const heroImage = venue.media?.[0]
  const galleryImages = venue.media?.slice(1, 5) ?? []

  return (
    <main className="min-h-screen bg-[#f5f3ef] dark:bg-[#111111] transition-colors">

      {/* ── Nav ───────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-[#f5f3ef]/90 dark:bg-[#111111]/90 backdrop-blur-md border-b border-neutral-200 dark:border-[#2a2a2a]">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="text-[#2a7a5a] font-bold text-xl tracking-tight">WUGI</Link>
          <Link href={`/${market}`} className="text-sm text-neutral-500 dark:text-[#888] hover:text-[#111111] dark:hover:text-white transition-colors">
            ← Atlanta
          </Link>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────── */}
      <div className="relative w-full h-64 sm:h-80 md:h-96 bg-neutral-200 dark:bg-[#1a1a1a] overflow-hidden">
        {heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroImage} alt={venue.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#2a7a5a]/20 to-neutral-200 dark:to-[#111111]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#f5f3ef] dark:from-[#111111] via-transparent to-transparent" />
        {venue.logoUrl && (
          <div className="absolute bottom-4 left-4 w-16 h-16 rounded-xl overflow-hidden border border-neutral-200 dark:border-[#2a2a2a] bg-white dark:bg-[#1a1a1a]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={venue.logoUrl} alt={`${venue.name} logo`} className="w-full h-full object-cover" />
          </div>
        )}
      </div>

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Left: main info */}
        <div className="lg:col-span-2 space-y-6">

          {/* Title */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-3xl sm:text-4xl font-bold text-[#111111] dark:text-white">{venue.name}</h1>
              <div className="flex items-center gap-2">
                <StarRating rating={venue.rating} />
                <PriceLevel level={venue.priceLevel} />
              </div>
            </div>
            <p className="text-neutral-500 dark:text-[#888] text-sm">{venue.category}</p>
            {venue.neighborhood && (
              <p className="text-[#2a7a5a] text-sm font-medium">{venue.neighborhood}</p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {venue.vibes?.map((vibe) => (
                <span key={vibe} className={`px-3 py-1 rounded-full text-xs font-medium border ${VIBE_COLORS[vibe] ?? "bg-neutral-100 text-neutral-700 border-neutral-200 dark:bg-[#1a1a1a] dark:text-[#aaa] dark:border-[#2a2a2a]"}`}>
                  {vibe}
                </span>
              ))}
            </div>
          </div>

          {/* About */}
          {venue.about && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-[#111111] dark:text-white">About</h2>
              <p className="text-neutral-600 dark:text-[#aaa] leading-relaxed">{venue.about}</p>
            </div>
          )}

          {/* Attributes */}
          {venue.attributes?.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-[#111111] dark:text-white">Features</h2>
              <div className="flex flex-wrap gap-2">
                {venue.attributes.map((attr) => (
                  <span key={attr} className="px-3 py-1.5 bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#2a2a2a] rounded-lg text-sm text-neutral-700 dark:text-[#ccc]">
                    {attr}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Gallery */}
          {galleryImages.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-[#111111] dark:text-white">Photos</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {galleryImages.map((img, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-neutral-200 dark:bg-[#1a1a1a]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img} alt={`${venue.name} photo ${i + 2}`} className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hours */}
          {venue.hours && Object.keys(venue.hours).length > 0 && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-[#111111] dark:text-white">Hours</h2>
              <div className="bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#2a2a2a] rounded-xl p-4 space-y-2">
                {Object.entries(venue.hours).map(([day, hours]) => (
                  <div key={day} className="flex justify-between text-sm">
                    <span className="text-neutral-500 dark:text-[#888] capitalize">{day}</span>
                    <span className="text-neutral-800 dark:text-[#ccc]">{hours}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: info card */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#2a2a2a] rounded-2xl p-5 space-y-4 lg:sticky lg:top-20 shadow-sm dark:shadow-none">

            <h2 className="font-semibold text-lg text-[#111111] dark:text-white">Info</h2>

            {venue.address && (
              <div className="flex gap-3">
                <span className="text-[#2a7a5a] mt-0.5">📍</span>
                <div>
                  <p className="text-sm text-neutral-700 dark:text-[#ccc]">{venue.address}</p>
                  <a href={`https://maps.google.com/?q=${encodeURIComponent(venue.address)}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#2a7a5a] hover:underline mt-1 inline-block">
                    Get directions
                  </a>
                </div>
              </div>
            )}

            {venue.phone && (
              <div className="flex gap-3 items-center">
                <span className="text-[#2a7a5a]">📞</span>
                <a href={`tel:${venue.phone}`} className="text-sm text-neutral-700 dark:text-[#ccc] hover:text-[#111111] dark:hover:text-white transition-colors">
                  {venue.phone}
                </a>
              </div>
            )}

            {venue.website && (
              <div className="flex gap-3 items-center">
                <span className="text-[#2a7a5a]">🌐</span>
                <a href={venue.website} target="_blank" rel="noopener noreferrer" className="text-sm text-neutral-700 dark:text-[#ccc] hover:text-[#111111] dark:hover:text-white transition-colors truncate">
                  {venue.website.replace(/^https?:\/\//, "")}
                </a>
              </div>
            )}

            {venue.instagram && (
              <div className="flex gap-3 items-center">
                <span className="text-[#2a7a5a]">📸</span>
                <a href={`https://instagram.com/${venue.instagram.replace("@", "")}`} target="_blank" rel="noopener noreferrer" className="text-sm text-neutral-700 dark:text-[#ccc] hover:text-[#111111] dark:hover:text-white transition-colors">
                  {venue.instagram}
                </a>
              </div>
            )}

            <div className="pt-2 border-t border-neutral-200 dark:border-[#2a2a2a]">
              <p className="text-xs text-neutral-500 dark:text-[#888] mb-3">Get the full experience</p>
              <a href="https://apps.apple.com/app/wugi/id829564750" className="block w-full bg-[#2a7a5a] hover:bg-[#3a9a72] text-white text-sm font-semibold text-center py-3 rounded-xl transition-colors">
                Download Wugi App
              </a>
            </div>
          </div>
        </div>

      </div>
    </main>
  )
}
