import { notFound } from "next/navigation"
import { adminDb } from "@/lib/firebase-admin"
import Link from "next/link"
import TicketSection from "./TicketSection"

interface TicketType {
  id: string
  name: string
  price: number
  description: string
  capacity: number
  available: number
  sortOrder: number
}

interface Event {
  id: string
  title: string
  slug: string
  venueId: string
  venueName: string
  date: string
  time: string
  age?: string
  about: string
  tags: string[]
  vibes: string[]
  media: { type: string; uri: string }[]
  status: string
  market: string
}

async function getEvent(slug: string): Promise<Event | null> {
  try {
    const snap = await adminDb
      .collection("events")
      .where("slug", "==", slug)
      .where("status", "==", "approved")
      .limit(1)
      .get()
    if (snap.empty) return null
    const doc = snap.docs[0]
    const data = doc.data()
    return {
      id: doc.id,
      title: data.title ?? "",
      slug: data.slug ?? "",
      venueId: data.venueId ?? "",
      venueName: data.venueName ?? data.venue ?? "",
      date: data.date ?? "",
      time: data.time ?? "",
      age: data.age ?? null,
      about: data.about ?? "",
      tags: data.tags ?? [],
      vibes: data.vibes ?? [],
      media: (data.media ?? []).map((m: { type: string; uri: string }) => ({ type: m.type, uri: m.uri })),
      status: data.status ?? "",
      market: data.market ?? "atlanta",
    } as Event
  } catch (e) {
    console.error("getEvent error:", e)
    throw e
  }
}

async function getTicketTypes(eventId: string): Promise<TicketType[]> {
  try {
    const snap = await adminDb
      .collection("events")
      .doc(eventId)
      .collection("ticketTypes")
      .orderBy("sortOrder")
      .get()
    return snap.docs.map(d => {
      const data = d.data()
      return {
        id: d.id,
        name: data.name ?? "",
        price: data.price ?? 0,
        description: data.description ?? "",
        capacity: data.capacity ?? 0,
        available: data.available ?? 0,
        sortOrder: data.sortOrder ?? 0,
      } as TicketType
    })
  } catch (e) {
    console.error("getTicketTypes error:", e)
    return []
  }
}

async function getVenueSlug(venueId: string): Promise<string | null> {
  try {
    const doc = await adminDb.collection("venues").doc(venueId).get()
    return doc.exists ? (doc.data()?.slug ?? null) : null
  } catch (e) {
    console.error("getVenueSlug error:", e)
    return null
  }
}

const VIBE_COLORS: Record<string, string> = {
  "Boujee":      "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700/50",
  "High Energy": "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700/50",
  "Divey":       "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-700/50",
  "Late Night":  "bg-blue-100  text-blue-800  border-blue-200  dark:bg-blue-900/40  dark:text-blue-300  dark:border-blue-700/50",
  "Rooftop":     "bg-sky-100   text-sky-800   border-sky-200   dark:bg-sky-900/40   dark:text-sky-300   dark:border-sky-700/50",
  "Speakeasy":   "bg-rose-100  text-rose-800  border-rose-200  dark:bg-rose-900/40  dark:text-rose-300  dark:border-rose-700/50",
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const event = await getEvent(slug)
  if (!event) return { title: "Event Not Found | Wugi" }
  return {
    title: `${event.title} | Wugi`,
    description: event.about?.slice(0, 160),
  }
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const event = await getEvent(slug)
  if (!event) notFound()

  const [ticketTypes, venueSlug] = await Promise.all([
    getTicketTypes(event.id),
    getVenueSlug(event.venueId),
  ])

  const heroImage = event.media?.[0]?.uri
  const galleryImages = event.media?.slice(1).map(m => m.uri) ?? []
  const venueUrl = venueSlug ? `/atlanta/${venueSlug}` : null

  return (
    <main className="min-h-screen bg-[#f5f3ef] dark:bg-[#111111] transition-colors">

      {/* ── Nav ───────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-[#f5f3ef]/90 dark:bg-[#111111]/90 backdrop-blur-md border-b border-neutral-200 dark:border-[#2a2a2a]">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="text-[#2a7a5a] font-bold text-xl tracking-tight">WUGI</Link>
          <Link href="/" className="text-sm text-neutral-500 dark:text-[#888] hover:text-[#111111] dark:hover:text-white transition-colors">
            ← Events
          </Link>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────── */}
      <div className="relative w-full h-64 sm:h-80 md:h-[420px] bg-neutral-200 dark:bg-[#1a1a1a] overflow-hidden">
        {heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroImage} alt={event.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#2a7a5a]/30 to-neutral-300 dark:to-[#111111]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#f5f3ef] dark:from-[#111111] via-transparent to-transparent" />

        {/* Date badge */}
        <div className="absolute top-4 left-4 bg-[#2a7a5a] text-white text-xs font-bold px-3 py-1.5 rounded-full">
          {event.date}
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Left: event info */}
        <div className="lg:col-span-2 space-y-6">

          {/* Title block */}
          <div className="space-y-3">
            <h1 className="text-3xl sm:text-4xl font-bold text-[#111111] dark:text-white">{event.title}</h1>

            {/* Meta row */}
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-neutral-600 dark:text-[#aaa]">
                <span>📅</span> {event.date}
              </div>
              <div className="flex items-center gap-1.5 text-neutral-600 dark:text-[#aaa]">
                <span>🕐</span> {event.time}
              </div>
              {event.age && (
                <div className="flex items-center gap-1.5 text-neutral-600 dark:text-[#aaa]">
                  <span>🔞</span> {event.age}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span>📍</span>
                {venueUrl ? (
                  <Link href={venueUrl} className="text-[#2a7a5a] hover:underline font-medium">
                    {event.venueName}
                  </Link>
                ) : (
                  <span className="text-neutral-600 dark:text-[#aaa]">{event.venueName}</span>
                )}
              </div>
            </div>

            {/* Vibes */}
            <div className="flex flex-wrap gap-2">
              {event.vibes?.map((vibe) => (
                <span key={vibe} className={`px-3 py-1 rounded-full text-xs font-medium border ${VIBE_COLORS[vibe] ?? "bg-neutral-100 text-neutral-700 border-neutral-200 dark:bg-[#1a1a1a] dark:text-[#aaa] dark:border-[#2a2a2a]"}`}>
                  {vibe}
                </span>
              ))}
              {event.tags?.map((tag) => (
                <span key={tag} className="px-3 py-1 rounded-full text-xs font-medium border bg-neutral-100 text-neutral-600 border-neutral-200 dark:bg-[#1a1a1a] dark:text-[#888] dark:border-[#2a2a2a]">
                  #{tag}
                </span>
              ))}
            </div>
          </div>

          {/* About */}
          {event.about && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-[#111111] dark:text-white">About this event</h2>
              <p className="text-neutral-600 dark:text-[#aaa] leading-relaxed">{event.about}</p>
            </div>
          )}

          {/* Gallery */}
          {galleryImages.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-[#111111] dark:text-white">Photos</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {galleryImages.map((img, i) => (
                  <div key={i} className="relative aspect-video rounded-xl overflow-hidden bg-neutral-200 dark:bg-[#1a1a1a]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img} alt={`${event.title} photo ${i + 2}`} className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: ticket section */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#2a2a2a] rounded-2xl p-5 lg:sticky lg:top-20 shadow-sm dark:shadow-none">
            <h2 className="font-semibold text-lg text-[#111111] dark:text-white mb-4">Get Tickets</h2>
            {ticketTypes.length > 0 ? (
              <TicketSection eventId={event.id} ticketTypes={ticketTypes} eventTitle={event.title} />
            ) : (
              <div className="text-center py-6">
                <p className="text-neutral-500 dark:text-[#888] text-sm">Tickets not yet available.</p>
                <p className="text-neutral-400 dark:text-[#666] text-xs mt-1">Check back soon.</p>
              </div>
            )}
          </div>

          {/* Share */}
          <div className="bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#2a2a2a] rounded-2xl p-5 shadow-sm dark:shadow-none">
            <h2 className="font-semibold text-sm text-[#111111] dark:text-white mb-3">Share this event</h2>
            <div className="flex gap-2">
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`${event.title} — get tickets on Wugi`)}&url=${encodeURIComponent(`https://wugi.us/events/${event.slug}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-center py-2 rounded-lg border border-neutral-200 dark:border-[#2a2a2a] text-sm text-neutral-600 dark:text-[#888] hover:bg-neutral-50 dark:hover:bg-[#222] transition-colors"
              >
                𝕏 Share
              </a>
              <a
                href={`https://www.instagram.com/`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-center py-2 rounded-lg border border-neutral-200 dark:border-[#2a2a2a] text-sm text-neutral-600 dark:text-[#888] hover:bg-neutral-50 dark:hover:bg-[#222] transition-colors"
              >
                📸 Story
              </a>
            </div>
          </div>
        </div>

      </div>
    </main>
  )
}
