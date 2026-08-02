// Field-mapping conventions ported from mobile-app/scripts/importPlaces.js
// buildVenue() — see that file's v5 header for the full status-ladder /
// confidence-scoring rationale. Duplicated rather than imported because
// importPlaces.js is a standalone `node` CLI script outside the Next.js
// build; keep the two in sync by hand if either changes.
//
// Deliberate deviation from importPlaces.js: dashboard-created venues
// (create-venue route) always land on `status: 'pending_review'` — the
// ladder logic below (evaluateNightlifeSignal / relevancePass) is still
// computed and stored for shape parity with import-created docs, but the
// caller overrides `status` rather than trusting determineStatus(). A
// human already vetted the Google Place match; the ladder gate exists to
// protect *unsupervised* imports from reaching publish, which doesn't
// apply here — but venues are the spine of the data model, so a second
// human review step before publish stays mandatory regardless.

export type GooglePlace = {
  id: string
  displayName?: { text?: string }
  formattedAddress?: string
  nationalPhoneNumber?: string
  websiteUri?: string
  rating?: number
  userRatingCount?: number
  priceLevel?: number | string
  types?: string[]
  primaryType?: string
  location?: { latitude?: number; longitude?: number }
  currentOpeningHours?: { weekdayDescriptions?: string[] }
  regularOpeningHours?: { weekdayDescriptions?: string[] }
  photos?: Array<{
    name: string
    widthPx?: number
    heightPx?: number
    authorAttributions?: Array<{ displayName?: string }>
  }>
  businessStatus?: string
  parkingOptions?: {
    freeParkingLot?: boolean
    paidParkingLot?: boolean
    valetParking?: boolean
    freeStreetParking?: boolean
    freeGarageParking?: boolean
    paidGarageParking?: boolean
  }
  editorialSummary?: { text?: string }
}

export type PlaceSearchResult = {
  placeId: string
  name: string
  address: string
  rating: number | null
  userRatingCount: number
  businessStatus: string | null
}

// ── Atlanta Neighborhoods — mirrors importPlaces.js NEIGHBORHOODS ─────────
const NEIGHBORHOODS = [
  { name: "Midtown", slug: "midtown", bounds: { north: 33.805, south: 33.785, east: -84.365, west: -84.405 } },
  { name: "Buckhead", slug: "buckhead", bounds: { north: 33.86, south: 33.83, east: -84.35, west: -84.4 } },
  { name: "Old Fourth Ward", slug: "old-fourth-ward", bounds: { north: 33.78, south: 33.755, east: -84.36, west: -84.39 } },
  { name: "East Atlanta Village", slug: "east-atlanta-village", bounds: { north: 33.74, south: 33.72, east: -84.33, west: -84.37 } },
  { name: "Westside", slug: "westside", bounds: { north: 33.79, south: 33.76, east: -84.4, west: -84.44 } },
  { name: "Downtown", slug: "downtown", bounds: { north: 33.77, south: 33.74, east: -84.37, west: -84.41 } },
  { name: "Inman Park", slug: "inman-park", bounds: { north: 33.765, south: 33.745, east: -84.35, west: -84.38 } },
  { name: "Virginia Highland", slug: "virginia-highland", bounds: { north: 33.79, south: 33.77, east: -84.35, west: -84.38 } },
  { name: "Little Five Points", slug: "little-five-points", bounds: { north: 33.765, south: 33.75, east: -84.35, west: -84.375 } },
  { name: "Summerhill", slug: "summerhill", bounds: { north: 33.745, south: 33.725, east: -84.37, west: -84.4 } },
  { name: "Decatur", slug: "decatur", bounds: { north: 33.78, south: 33.76, east: -84.28, west: -84.32 } },
  { name: "Sandy Springs", slug: "sandy-springs", bounds: { north: 33.94, south: 33.9, east: -84.34, west: -84.39 } },
  { name: "Castleberry Hill", slug: "castleberry-hill", bounds: { north: 33.75, south: 33.73, east: -84.39, west: -84.42 } },
] as const

export function deriveNeighborhood(lat: number, lng: number): { neighborhood: string; neighborhoodSlug: string; neighborhoodBounds: Record<string, number> | null } {
  const hood = NEIGHBORHOODS.find(
    (n) => lat <= n.bounds.north && lat >= n.bounds.south && lng <= n.bounds.east && lng >= n.bounds.west
  )
  if (!hood) return { neighborhood: "", neighborhoodSlug: "", neighborhoodBounds: null }
  return { neighborhood: hood.name, neighborhoodSlug: hood.slug, neighborhoodBounds: { ...hood.bounds } }
}

// ── Confidence scoring ────────────────────────────────────────────────
const FIELD_WEIGHTS: Record<string, number> = {
  name: 20, address: 20, phone: 15, website: 15,
  hours: 10, photos: 10, instagram: 5, parking: 5,
}

function scoreField(fieldName: string, value: unknown): number {
  switch (fieldName) {
    case "name": return !value || value === "Unknown Venue" ? 0 : 95
    case "address": return !value ? 0 : String(value).includes("Atlanta") || String(value).includes("GA") ? 95 : 70
    case "phone": return value ? 90 : 0
    case "website": return !value ? 0 : String(value).startsWith("https://") ? 85 : 70
    case "hours": return !value || (value as unknown[]).length === 0 ? 0 : (value as unknown[]).length >= 7 ? 80 : 50
    case "photos": return !value || (value as unknown[]).length === 0 ? 0 : (value as unknown[]).length >= 3 ? 75 : 40
    case "parking": {
      if (!value || Object.keys(value as object).length === 0) return 0
      return Object.values(value as Record<string, boolean>).some((v) => v === true) ? 60 : 30
    }
    default: return 0
  }
}

export function calculateConfidence(fields: {
  name: string; address: string; phone: string; website: string
  hours: string[]; photos: string[]; parking: Record<string, boolean>
}): { overall: number; breakdown: Record<string, { score: number; visible: boolean; source: string }> } {
  const sources: Record<string, string> = {
    name: "google_places", address: "google_places", phone: "google_places",
    website: "google_places", hours: "google_places", photos: "google_places",
    instagram: "inferred", parking: "google_places",
  }
  let weightedSum = 0
  const breakdown: Record<string, { score: number; visible: boolean; source: string }> = {}
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const score = scoreField(field, field === "instagram" ? null : (fields as Record<string, unknown>)[field])
    breakdown[field] = { score, visible: score >= 60, source: sources[field] }
    weightedSum += (score * weight) / 100
  }
  return { overall: Math.round(weightedSum), breakdown }
}

// ── Vibes / category ──────────────────────────────────────────────────
export function mapVibes(types: string[] = [], priceLevel = 2, name = ""): string[] {
  const vibes: string[] = []
  const t = types.join(" ").toLowerCase()
  const n = name.toLowerCase()
  if (t.includes("night_club")) vibes.push("High Energy")
  if ((t.includes("bar") || t.includes("lounge")) && priceLevel >= 3) vibes.push("Boujee")
  if (t.includes("bar") && priceLevel <= 2) vibes.push("Divey")
  if (n.includes("rooftop") || n.includes("sky") || n.includes("roof")) vibes.push("Rooftop")
  if (n.includes("speakeasy") || n.includes("hidden") || n.includes("secret")) vibes.push("Speakeasy")
  if (t.includes("restaurant") && priceLevel >= 3) vibes.push("Boujee")
  if (n.includes("late") || n.includes("midnight") || n.includes("after")) vibes.push("Late Night")
  if (vibes.length === 0) vibes.push(t.includes("night_club") ? "High Energy" : t.includes("bar") ? "Divey" : "Boujee")
  return [...new Set(vibes)]
}

export function mapCategory(types: string[] = [], name = ""): string {
  const t = types.join(" ").toLowerCase()
  const n = name.toLowerCase()
  if (t.includes("night_club")) return "Nightclub"
  if (n.includes("rooftop") || n.includes("roof")) return "Rooftop Bar"
  if (t.includes("bar") && t.includes("restaurant")) return "Bar & Kitchen"
  if (t.includes("lounge")) return "Lounge"
  if (t.includes("bar")) return "Bar"
  if (t.includes("restaurant")) return "Restaurant"
  return "Bar & Lounge"
}

const PRIMARY_CATEGORIES = [
  "Bar", "Nightclub", "Restaurant", "Lounge", "Live Music", "Comedy",
  "Adult", "Event Venue", "Brewery/Distillery", "Cafe", "Hotel Bar/Rooftop Pool",
]

function inferPrimaryCategory(types: string[] = [], primaryType = "", name = ""): string {
  const t = types.map((x) => x.toLowerCase())
  const pt = (primaryType || "").toLowerCase()
  const n = (name || "").toLowerCase()

  if (/(strip club|gentlemen|topless|burlesque)/.test(n)) return "Adult"
  if (/comedy/.test(n) || pt === "comedy_club" || t.includes("comedy_club")) return "Comedy"
  if (/(brewery|brewing|distillery|winery)/.test(n)) return "Brewery/Distillery"
  if (/(cafe|café|coffee)/.test(n) || pt === "cafe" || pt === "coffee_shop" || t.includes("cafe")) return "Cafe"
  if (/(rooftop|sky bar|skyline)/.test(n) && (t.includes("lodging") || /hotel/.test(n))) return "Hotel Bar/Rooftop Pool"

  if (pt === "night_club" || t.includes("night_club")) return "Nightclub"
  if (/lounge/.test(n)) return "Lounge"
  if (/(live music|music hall|concert)/.test(n)) return "Live Music"
  if (t.includes("restaurant") || pt === "restaurant" || t.includes("meal_takeaway") || t.includes("meal_delivery")) return "Restaurant"
  if (pt === "bar" || t.includes("bar") || pt === "pub" || t.includes("pub")) return "Bar"
  if (t.includes("lodging")) return "Hotel Bar/Rooftop Pool"

  return "Bar"
}

function assertPrimaryCategory(value: string): string {
  return PRIMARY_CATEGORIES.includes(value) ? value : "Bar"
}

// ── Nightlife relevance signal (for relevancePass/relevanceSignals parity) ──
const STRONG_NIGHTLIFE_PRIMARY_TYPES = new Set(["bar", "night_club", "pub", "wine_bar", "casino", "comedy_club", "karaoke"])
const STRONG_NIGHTLIFE_CATEGORIES = new Set(["Bar", "Nightclub", "Lounge", "Live Music", "Comedy", "Adult", "Brewery/Distillery", "Hotel Bar/Rooftop Pool"])
const POSITIVE_NAME_RE = /\b(lounge|club|bar|tavern|pub|hookah|cocktail|speakeasy|cabaret|comedy|music hall|live|saloon|distillery|brewery|taproom|rooftop|karaoke|revue|gentlemen)\b/i

function hasGenuineBarTypeSignal(types: string[], primaryType: string): boolean {
  const t = types.map((x) => x.toLowerCase())
  const pt = primaryType.toLowerCase()
  return pt === "bar" || pt === "pub" || t.includes("bar") || t.includes("pub")
}

function evaluateNightlifeSignal(place: GooglePlace, primaryCategory: string): { relevancePass: boolean; signals: string[] } {
  const types = place.types || []
  const primaryType = (place.primaryType || "").toLowerCase()
  const name = place.displayName?.text || ""

  const signals: string[] = []
  if (STRONG_NIGHTLIFE_PRIMARY_TYPES.has(primaryType)) signals.push("primaryType")

  const categoryIsGenuineSignal = primaryCategory === "Bar" ? hasGenuineBarTypeSignal(types, place.primaryType || "") : STRONG_NIGHTLIFE_CATEGORIES.has(primaryCategory)
  if (categoryIsGenuineSignal) signals.push("primaryCategory")

  const strong = signals.length > 0
  if (POSITIVE_NAME_RE.test(name)) signals.push("name")

  return { relevancePass: strong || signals.includes("name"), signals }
}

function mapPriceLevel(level: number | string | undefined): string {
  return (["", "$", "$$", "$$$", "$$$$"] as const)[level as number] || "$$"
}

// ── Address casing (issue #179 bug 2) ───────────────────────────────────
// Google's formattedAddress comes back all-lowercase for some sources
// ('1086 alco st ne'). Title-case each word, but keep US state postal
// codes (GA) and street directional/ordinal suffixes (N, S, E, W, NE, NW,
// SE, SW) ALL-CAPS — title-casing those reads wrong ('Ne', 'Ga').
const US_STATE_ABBRS = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC",
])
const DIRECTIONAL_ABBRS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"])

function titleCaseToken(token: string): string {
  const match = token.match(/^([A-Za-z]+)(.*)$/)
  if (!match) return token
  const [, letters, rest] = match
  const upper = letters.toUpperCase()
  if (letters.length <= 2 && (DIRECTIONAL_ABBRS.has(upper) || US_STATE_ABBRS.has(upper))) {
    return upper + rest
  }
  return letters[0].toUpperCase() + letters.slice(1).toLowerCase() + rest
}

export function titleCaseAddress(address: string): string {
  if (!address) return address
  return address.split(" ").map(titleCaseToken).join(" ")
}

// ── Hero image selection ────────────────────────────────────────────────
const HERO_MIN_ASPECT = 1.2

function getPhotoUrl(photoName: string, apiKey: string): string {
  return `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=800&maxWidthPx=800&key=${apiKey}&skipHttpRedirect=false`
}

function scorePhoto(photo: NonNullable<GooglePlace["photos"]>[number], venueName: string, apiKey: string) {
  const width = photo.widthPx || 0
  const height = photo.heightPx || 0
  const aspect = height > 0 ? width / height : 0
  const attributions = photo.authorAttributions || []
  const nameLower = (venueName || "").toLowerCase()
  const ownerUploaded = attributions.length === 0 || attributions.every((a) => nameLower && (a.displayName || "").toLowerCase().includes(nameLower))

  return {
    url: getPhotoUrl(photo.name, apiKey),
    meetsAspect: aspect >= HERO_MIN_ASPECT,
    ownerUploaded,
    resolution: width * height,
  }
}

function rankPhotos(photos: GooglePlace["photos"] = [], venueName: string, apiKey: string) {
  return (photos || [])
    .map((p) => scorePhoto(p, venueName, apiKey))
    .sort((a, b) => {
      if (a.meetsAspect !== b.meetsAspect) return a.meetsAspect ? -1 : 1
      if (a.ownerUploaded !== b.ownerUploaded) return a.ownerUploaded ? -1 : 1
      return b.resolution - a.resolution
    })
}

// ── hoursText ─────────────────────────────────────────────────────────
const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
const DAY_ABBR: Record<string, string> = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat", Sunday: "Sun" }

function normalizeHoursSegment(raw: string): string {
  return raw
    .replace(/\s*[-–]\s*/g, " – ")
    .replace(/:00(?=\s*[AP]M)/gi, "")
    .replace(/\s+/g, " ")
    .trim()
}

function buildHoursText(weekdayDescriptions: string[]): string {
  if (!Array.isArray(weekdayDescriptions) || weekdayDescriptions.length !== 7) return ""

  const parsed = DAY_ORDER.map((day) => {
    const line = weekdayDescriptions.find((l) => l.startsWith(day))
    if (!line) return { abbr: DAY_ABBR[day], hours: "Closed" }
    const raw = line.slice(line.indexOf(":") + 1).trim()
    const hours = /^closed$/i.test(raw) ? "Closed" : normalizeHoursSegment(raw)
    return { abbr: DAY_ABBR[day], hours }
  })

  const groups: { hours: string; abbrs: string[] }[] = []
  for (const d of parsed) {
    const last = groups[groups.length - 1]
    if (last && last.hours === d.hours) last.abbrs.push(d.abbr)
    else groups.push({ hours: d.hours, abbrs: [d.abbr] })
  }

  return groups
    .map((g) => {
      const dayLabel = g.abbrs.length > 1 ? `${g.abbrs[0]}–${g.abbrs[g.abbrs.length - 1]}` : g.abbrs[0]
      return g.hours === "Closed" ? `Closed ${dayLabel}` : `${dayLabel} · ${g.hours}`
    })
    .join("  ·  ")
}

// ── Build venue doc ───────────────────────────────────────────────────
// Mirrors importPlaces.js buildVenue()'s output shape exactly, EXCEPT:
//   - instagram is always skipped for confidence purposes (matches import
//     mode's skipInstagram=true), then instagram/instagramSource/
//     instagramInferred are set from the human-provided handle afterward —
//     the same two-step shape a later `--instagram-only` run would produce.
//   - status is the caller's responsibility to force to 'pending_review'
//     (see file header) rather than trusting determineStatus().
export function buildVenueDoc(
  place: GooglePlace,
  instagramHandle: string,
  apiKey: string
): Record<string, unknown> {
  const name = place.displayName?.text || "Unknown Venue"
  const types = place.types || []
  const primaryType = place.primaryType || ""
  const price = typeof place.priceLevel === "number" ? place.priceLevel : 2

  const rawPhotos = place.photos || []
  const rankedPhotos = rankPhotos(rawPhotos, name, apiKey)
  const media = rankedPhotos.slice(0, 5).map((p) => p.url)
  const hasHero = rankedPhotos.length > 0 && rankedPhotos[0].meetsAspect
  const heroImage = hasHero ? rankedPhotos[0].url : null
  const needsPhotoRepull = media.length === 0 || !hasHero

  const hours = place.currentOpeningHours?.weekdayDescriptions || place.regularOpeningHours?.weekdayDescriptions || []
  const hoursText = buildHoursText(hours)
  const parking: Record<string, boolean> = place.parkingOptions
    ? {
        freeParking: place.parkingOptions.freeParkingLot ?? false,
        paidParking: place.parkingOptions.paidParkingLot ?? false,
        valetParking: place.parkingOptions.valetParking ?? false,
        streetParking: place.parkingOptions.freeStreetParking ?? false,
        garageParking: (place.parkingOptions.freeGarageParking || place.parkingOptions.paidGarageParking) ?? false,
      }
    : {}

  const address = titleCaseAddress(place.formattedAddress || "")
  const fields = { name, address, phone: place.nationalPhoneNumber || "", website: place.websiteUri || "", hours, photos: media, parking }
  const confidence = calculateConfidence(fields)

  const primaryCategory = assertPrimaryCategory(inferPrimaryCategory(types, primaryType, name))
  const nightlifeSignal = evaluateNightlifeSignal(place, primaryCategory)

  const loc = place.location || {}
  const lat = loc.latitude || 0
  const lng = loc.longitude || 0
  const { neighborhood, neighborhoodSlug, neighborhoodBounds } = deriveNeighborhood(lat, lng)

  const normalizedHandle = instagramHandle.trim().replace(/^@/, "")

  return {
    name,
    category: mapCategory(types, name),
    primaryCategory,
    address,
    phone: place.nationalPhoneNumber || "",
    website: place.websiteUri || "",
    instagram: normalizedHandle ? `@${normalizedHandle}` : "",
    instagramSource: "manual",
    instagramInferred: false,
    attributes: [],
    about: place.editorialSummary?.text || "",
    media,
    heroImage,
    needsPhotoRepull,
    menuDescription: "",
    // 4-key superset — {lat,lng} for the venue edit form's read, {latitude,
    // longitude} for parity with Google's own shape. See
    // scripts/upsert-flagged-venues.js's location comment for why: three
    // shapes coexist live, and the edit form only reads lat/lng (issue #179).
    location: { lat, lng, latitude: lat, longitude: lng },
    neighborhood,
    neighborhoodSlug,
    neighborhoodBounds,
    hours,
    hoursText,
    hoursVisible: true,
    specialHours: [],
    parking,
    rating: place.rating || null,
    userRatingCount: place.userRatingCount || 0,
    priceLevel: mapPriceLevel(price),
    googlePlaceId: place.id,
    vibes: mapVibes(types, price, name),
    confidence,
    relevancePass: nightlifeSignal.relevancePass,
    relevanceSignals: nightlifeSignal.signals,
    isClaimed: false,
    claimedBy: null,
    claimedAt: null,
    isActive: place.businessStatus === "OPERATIONAL",
    businessStatus: place.businessStatus || null,
    isFeatured: false,
  }
}

// ── Google Places API calls (server-side only — key never reaches client) ──
const SEARCH_FIELD_MASK = ["places.id", "places.displayName", "places.formattedAddress", "places.rating", "places.userRatingCount", "places.businessStatus"].join(",")

const DETAILS_FIELD_MASK = [
  "id", "displayName", "formattedAddress", "nationalPhoneNumber",
  "websiteUri", "rating", "userRatingCount", "priceLevel", "types", "primaryType", "location",
  "currentOpeningHours", "regularOpeningHours",
  "photos.name", "photos.widthPx", "photos.heightPx", "photos.authorAttributions",
  "businessStatus", "parkingOptions", "editorialSummary",
].join(",")

// Atlanta downtown — a wide bias (not a restriction) so results skew local
// without excluding a legitimate match just outside the radius.
const ATLANTA_CENTER = { latitude: 33.749, longitude: -84.388 }
const ATLANTA_BIAS_RADIUS_M = 40000

export async function searchPlacesText(query: string, apiKey: string): Promise<PlaceSearchResult[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: { circle: { center: ATLANTA_CENTER, radius: ATLANTA_BIAS_RADIUS_M } },
      maxResultCount: 10,
    }),
  })
  if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const places: GooglePlace[] = data.places || []
  return places.map((p) => ({
    placeId: p.id,
    name: p.displayName?.text || "Unknown",
    address: p.formattedAddress || "",
    rating: p.rating ?? null,
    userRatingCount: p.userRatingCount || 0,
    businessStatus: p.businessStatus || null,
  }))
}

export async function getPlaceDetails(placeId: string, apiKey: string): Promise<GooglePlace | null> {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": DETAILS_FIELD_MASK,
    },
  })
  if (!res.ok) return null
  return res.json()
}
