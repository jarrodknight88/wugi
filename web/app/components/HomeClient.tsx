"use client"

import { useState } from "react"

const VIBES = ["All", "Boujee", "High Energy", "Rooftop", "Late Night", "Divey"]

const VIBE_STYLES: Record<string, string> = {
  "Boujee":      "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700/50",
  "High Energy": "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700/50",
  "Divey":       "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-700/50",
  "Late Night":  "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700/50",
  "Rooftop":     "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-700/50",
}

interface Venue {
  id: string
  name: string
  slug: string
  category: string
  vibes: string[]
  neighborhood?: string
  media?: string[]
  logoUrl?: string
  rating?: number
}

interface Event {
  id: string
  title: string
  slug: string
  venueName: string
  date: string
  time: string
  vibes: string[]
  media: { type: string; uri: string }[]
}

interface Props {
  venues: Venue[]
  events: Event[]
}

export default function HomeClient({ venues, events }: Props) {
  const [activeVibe, setActiveVibe] = useState("All")

  const filteredVenues = activeVibe === "All"
    ? venues
    : venues.filter(v => v.vibes?.includes(activeVibe))

  const filteredEvents = activeVibe === "All"
    ? events
    : events.filter(e => e.vibes?.includes(activeVibe))

  return (
    <div className="space-y-12">

      {/* ── Vibe filter ───────────────────────────────────────── */}
      <section>
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {VIBES.map(vibe => (
            <button
              key={vibe}
              onClick={() => setActiveVibe(vibe)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                activeVibe === vibe
                  ? "bg-[#2a7a5a] text-white border-[#2a7a5a]"
                  : vibe === "All"
                  ? "bg-white dark:bg-[#1a1a1a] text-neutral-600 dark:text-[#888] border-neutral-200 dark:border-[#2a2a2a] hover:border-[#2a7a5a]"
                  : `border ${VIBE_STYLES[vibe] ?? "bg-neutral-100 text-neutral-700 border-neutral-200 dark:bg-[#1a1a1a] dark:text-[#888] dark:border-[#2a2a2a]"} hover:opacity-80`
              }`}
            >
              {vibe}
            </button>
          ))}
        </div>
      </section>

      {/* ── Tonight's Events ──────────────────────────────────── */}
      {filteredEvents.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-[#111111] dark:text-white mb-4">
            {activeVibe === "All" ? "Tonight & This Weekend" : `${activeVibe} Events`}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredEvents.map(event => {
              const img = event.media?.[0]?.uri
              return (
                <a
                  key={event.id}
                  href={`/events/${event.slug}`}
                  className="group block bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#2a2a2a] rounded-2xl overflow-hidden hover:border-[#2a7a5a]/50 hover:shadow-lg dark:hover:shadow-none transition-all"
                >
                  <div className="relative h-44 bg-neutral-200 dark:bg-[#222] overflow-hidden">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={event.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#2a7a5a]/20 to-neutral-200 dark:to-[#111]" />
                    )}
                    <div className="absolute top-3 left-3 bg-[#2a7a5a] text-white text-xs font-bold px-2.5 py-1 rounded-full">
                      {event.date}
                    </div>
                  </div>
                  <div className="p-4 space-y-1">
                    <h3 className="font-semibold text-[#111111] dark:text-white truncate">{event.title}</h3>
                    <p className="text-sm text-neutral-500 dark:text-[#888]">{event.venueName} · {event.time}</p>
                    <div className="flex gap-1.5 flex-wrap pt-1">
                      {event.vibes?.slice(0, 2).map(v => (
                        <span key={v} className={`text-xs px-2 py-0.5 rounded-full border ${VIBE_STYLES[v] ?? "bg-neutral-100 text-neutral-600 border-neutral-200 dark:bg-[#222] dark:text-[#888] dark:border-[#333]"}`}>{v}</span>
                      ))}
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Featured Venues ───────────────────────────────────── */}
      {filteredVenues.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-[#111111] dark:text-white mb-4">
            {activeVibe === "All" ? "Atlanta Venues" : `${activeVibe} Venues`}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredVenues.map(venue => {
              const img = venue.media?.[0]
              return (
                <a
                  key={venue.id}
                  href={`/atlanta/${venue.slug}`}
                  className="group block bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#2a2a2a] rounded-2xl overflow-hidden hover:border-[#2a7a5a]/50 hover:shadow-lg dark:hover:shadow-none transition-all"
                >
                  <div className="relative h-32 bg-neutral-200 dark:bg-[#222] overflow-hidden">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={venue.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#2a7a5a]/20 to-neutral-200 dark:to-[#111]" />
                    )}
                    {venue.logoUrl && (
                      <div className="absolute bottom-2 left-2 w-8 h-8 rounded-lg overflow-hidden border border-white/20 bg-black/30 backdrop-blur-sm">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={venue.logoUrl} alt="" className="w-full h-full object-cover" />
                      </div>
                    )}
                  </div>
                  <div className="p-3 space-y-1">
                    <h3 className="font-semibold text-sm text-[#111111] dark:text-white truncate">{venue.name}</h3>
                    {venue.neighborhood && (
                      <p className="text-xs text-[#2a7a5a]">{venue.neighborhood}</p>
                    )}
                    <div className="flex gap-1 flex-wrap">
                      {venue.vibes?.slice(0, 2).map(v => (
                        <span key={v} className={`text-xs px-2 py-0.5 rounded-full border ${VIBE_STYLES[v] ?? "bg-neutral-100 text-neutral-600 border-neutral-200 dark:bg-[#222] dark:text-[#888] dark:border-[#333]"}`}>{v}</span>
                      ))}
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        </section>
      )}

      {filteredVenues.length === 0 && filteredEvents.length === 0 && (
        <div className="text-center py-16">
          <p className="text-neutral-500 dark:text-[#888]">No results for <span className="font-semibold">{activeVibe}</span> right now.</p>
          <button onClick={() => setActiveVibe("All")} className="mt-4 text-sm text-[#2a7a5a] hover:underline">Show everything</button>
        </div>
      )}

    </div>
  )
}
