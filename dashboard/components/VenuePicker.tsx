"use client"
import { useEffect, useState } from "react"
import { authedFetch, errorMessage } from "@/lib/authedFetch"
import SearchSelect from "./SearchSelect"
import type { VenueOption } from "@/app/api/venue-intel/venues/route"

// Module-level cache — venues is ~500 docs and rarely changes mid-session;
// every VenuePicker instance on a page (e.g. one per Needs Attention row)
// shares a single fetch instead of one request each.
let cachedVenues: VenueOption[] | null = null
let cachedVenuesPromise: Promise<VenueOption[]> | null = null

function loadVenues(): Promise<VenueOption[]> {
  if (cachedVenues) return Promise.resolve(cachedVenues)
  if (!cachedVenuesPromise) {
    cachedVenuesPromise = authedFetch("/api/venue-intel/venues")
      .then((res) => {
        cachedVenues = res.venues
        return res.venues as VenueOption[]
      })
      .catch((e) => {
        cachedVenuesPromise = null // allow a retry on next mount
        throw e
      })
  }
  return cachedVenuesPromise
}

// Shared by the Needs Attention picker (venue-intel page), the draft
// editor's venue field (DraftEventsPanel), and ScrapeProfileControl's
// prefill — searchable dropdown over the venues collection, built on the
// existing SearchSelect. Emits {venueId, venueName, instagram} on pick —
// instagram is optional-to-consume, so existing two-arg callers are unaffected.
export default function VenuePicker({
  venueId,
  onChange,
  placeholder = "Search venues...",
  label,
  disabled,
}: {
  venueId: string
  onChange: (venueId: string, venueName: string, instagram?: string) => void
  placeholder?: string
  label?: string
  disabled?: boolean
}) {
  const [venues, setVenues] = useState<VenueOption[]>(cachedVenues ?? [])
  const [loading, setLoading] = useState(cachedVenues === null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (cachedVenues) return
    let cancelled = false
    loadVenues()
      .then((v) => { if (!cancelled) setVenues(v) })
      .catch((e) => { if (!cancelled) setError(errorMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const options = venues.map((v) => ({
    id: v.id,
    label: v.name,
    sub: [v.neighborhood, v.status].filter(Boolean).join(" · "),
  }))

  return (
    <div>
      <SearchSelect
        label={label}
        value={venueId}
        options={options}
        placeholder={loading ? "Loading venues…" : placeholder}
        disabled={disabled || loading}
        onChange={(id, selectedLabel) => {
          const match = venues.find((v) => v.id === id)
          onChange(id, match?.name || selectedLabel, match?.instagram)
        }}
      />
      {error && <p style={{ fontSize: 12, color: "#b91c1c", margin: "4px 0 0" }}>{error}</p>}
    </div>
  )
}
