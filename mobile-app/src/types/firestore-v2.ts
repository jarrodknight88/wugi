// ─────────────────────────────────────────────────────────────────────
// Wugi — Firestore schema v2
// Authoritative type definitions and canonical enums for the Atlanta
// venue + event scrape (INFRA-VENUE-01) and all subsequent app code
// that reads tier-aware venue/event documents.
//
// Companion to firestoreService.ts (v1 types — left untouched for the
// existing 209 venues / 86 events until the migration script writes
// schemaVersion: 2 across the board).
// ─────────────────────────────────────────────────────────────────────

import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

// Anything that could be a Firestore Timestamp on read or a sentinel
// (serverTimestamp()) on write — both client and admin SDKs.
export type FSTimestamp =
  | FirebaseFirestoreTypes.Timestamp
  | FirebaseFirestoreTypes.FieldValue
  | { seconds: number; nanoseconds: number }
  | null;

// ── Canonical enums (single source of truth for filters & validation) ─

export const VIBES = [
  'Boujee', 'Divey', 'Speakeasy', 'High Energy', 'Rooftop', 'Late Night',
  'Chill', 'Dance', 'Live Music', 'Date Night', 'Sports', 'Brunch',
  'Cultural', 'Hookah', 'Lounge', 'Adult',
] as const;
export type Vibe = typeof VIBES[number];

export const PRIMARY_CATEGORIES = [
  'Bar', 'Nightclub', 'Restaurant', 'Lounge', 'Live Music', 'Comedy',
  'Adult', 'Event Venue', 'Brewery/Distillery', 'Cafe', 'Hotel Bar/Rooftop Pool',
] as const;
export type PrimaryCategory = typeof PRIMARY_CATEGORIES[number];

export const NEIGHBORHOODS = [
  'Buckhead', 'Midtown', 'Downtown', 'Old Fourth Ward', 'Inman Park',
  'Virginia-Highland', 'Poncey-Highland', 'Edgewood', 'Cabbagetown',
  'Reynoldstown', 'Grant Park', 'East Atlanta Village', 'Castleberry Hill',
  'West End', 'West Midtown', 'Atlantic Station', 'Vine City', 'Sweet Auburn',
  'Little Five Points', 'Brookhaven', 'Decatur', 'Avondale Estates', 'Smyrna',
  'Sandy Springs', 'Marietta', 'Roswell', 'Alpharetta', 'East Cobb/Vinings',
] as const;
export type Neighborhood = typeof NEIGHBORHOODS[number];

export const ATTRIBUTES = [
  'Open Late', 'Happy Hour', 'Bottle Service', 'VIP/Sections', 'Dress Code Enforced',
  '21+ Only', '18+ Welcome', 'Dancing', 'Live DJ', 'Live Band', 'Outdoor Seating',
  'Rooftop', 'Pet Friendly', 'Kid Friendly', 'Reservations Available',
  'Walk-Ins Welcome', 'Free Parking', 'Valet Parking', 'Wheelchair Accessible',
  'Coat Check', 'Smoking/Hookah Allowed', 'Cash Only', 'Credit Card Required',
  'BYOB', 'Private Events Available', 'Day Party/Brunch', 'Game Day Venue',
  'Karaoke', 'Trivia Night', 'Open Mic', 'After Hours',
] as const;
export type Attribute = typeof ATTRIBUTES[number];

export const CROWD = [
  'Hip-Hop', 'House/Electronic', 'LGBTQ+', 'Black-owned/Black',
  'Latin/Afro-Latin', 'African/African Diaspora', 'Asian',
  'College/21-25', 'Young Professionals/25-35', '30+', '40+',
  'Tourist-friendly', 'Industry', 'Dressed Up', 'Casual',
] as const;
export type Crowd = typeof CROWD[number];

// ── Tier / status / source enums ──────────────────────────────────────

export type VenueTier =
  | 'unclaimed'
  | 'claimed_basic'
  | 'standard'
  | 'premium';

// ── Canonical status enums (locked by INFRA-VENUE-11) ────────────────
//
// Venue:
//   approved        — owner-claimed and verified, full profile, surfaced
//   unclaimed       — published from scrape, no operator yet, surfaced with claim CTA
//   pending_review  — confidence too low for auto-publish, awaits moderation
//   closed          — confirmed permanently closed; banner shown on profile, hidden from feed
//   disabled        — admin-hidden (duplicate, bad data, ToS violation)
//
// Event:
//   approved        — published, surfaced in consumer feed
//   pending_review  — admin must approve before surfacing
//   closed          — past event, retained for history but hidden
//   rejected        — admin denied (wrong venue, spam, etc.); never surfaces
//
// Phase 3 transform writes ONLY these values. Any other value is a bug.
// The legacy values active / pending_launch / hidden / low_confidence /
// pending have been remapped to the canonical set in production
// (see VENUE-DATA-04 + INFRA-VENUE-11 hot-fixes 2026-05-03).

export type VenueStatus =
  | 'approved'
  | 'unclaimed'
  | 'pending_review'
  | 'closed'
  | 'disabled';

export type EventStatus =
  | 'approved'
  | 'pending_review'
  | 'closed'
  | 'rejected';

export type VenueSource = 'google-places' | 'manual' | 'serpapi';
export type EventSource = 'serpapi' | 'manual' | 'google-events';

export type RecencySignal = 'fresh' | 'stale' | 'unknown';

// ── Shared shapes ─────────────────────────────────────────────────────

export type GeoPoint = { lat: number; lng: number };

export type AddressComponents = {
  streetNumber?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

export type SpecialHours = {
  date: string;
  label: string;
  hours: string | null;
  isClosed: boolean;
};

export type ParkingOptions = Record<string, boolean>;

export type ReviewSnippet = {
  text: string;
  rating: number;
  authorName?: string;
  publishedAt?: FSTimestamp;
};

export type Media = { type: 'image' | 'video'; uri: string };

export type ConfidenceField = {
  score: number;
  visible: boolean;
  source: string;
};

export type Confidence = {
  overall: number;
  breakdown: Record<string, ConfidenceField>;
  recencySignal?: RecencySignal;
};

// ── Venue v2 ──────────────────────────────────────────────────────────
// Path: venues/{venueId}
// Schema version: 2

export type VenueV2 = {
  // Identity
  id: string;
  name: string;
  slug: string;
  googlePlaceId?: string;

  // Location
  location: GeoPoint;
  address: string;
  addressComponents?: AddressComponents;
  neighborhood?: Neighborhood;
  neighborhoodSlug?: string;
  market: string;

  // Categorization
  primaryCategory: PrimaryCategory;
  subcategories: string[];
  category: string; // legacy mirror — auto-synced from primaryCategory + subcategories
  googleTypes: string[];
  vibes: Vibe[];
  attributes: Attribute[];
  crowd: Crowd[];
  priceLevel?: string;

  // Tier
  tier: VenueTier;
  tierExpiresAt?: FSTimestamp;
  claimedAt?: FSTimestamp;
  claimedBy?: string | null;
  isClaimed: boolean;

  // Status
  status: VenueStatus;
  isActive: boolean;
  isFeatured?: boolean;
  closedReason?: string;
  closedAt?: FSTimestamp;

  // Test/QA flag — true means hide from consumer app queries
  // Consumer app filters: where('isTestVenue', '!=', true)
  // Wugi Door does NOT filter on this field (test venues stay queryable for Door QA).
  // Treat undefined as false.
  isTestVenue?: boolean;

  // Confidence
  confidence: Confidence;

  // Source
  source: VenueSource;
  scrapedAt?: FSTimestamp;
  lastEnrichedAt?: FSTimestamp;

  // Default content (free-tier baseline; visible until claimed override)
  defaultPhone?: string;
  defaultWebsite?: string;
  defaultHours?: string[];
  defaultAbout?: string;
  defaultMedia?: Media[];

  // App-facing (mirror of defaults until owner overrides post-claim)
  phone?: string;
  website?: string;
  instagram?: string;
  instagramSource?: string;
  hours?: string[];
  hoursVisible?: boolean;
  specialHours?: SpecialHours[];
  about?: string;
  media: Media[];
  logoUrl?: string;
  logoFetchedAt?: FSTimestamp;

  // Reviews
  rating?: number;
  userRatingsTotal?: number;
  popularityScore?: number;
  reviewSnippets?: ReviewSnippet[];

  // Operational
  capacity?: number;
  ageRequirement?: string;
  hasReservations?: boolean;
  reservationSystem?: string;
  bookingUrl?: string;
  parking?: ParkingOptions;

  // Menu
  menuDescription?: string;
  menuAttributes?: string[];
  signatureDishes?: string[];
  menuRawText?: string;
  menuRawTextSource?: string;
  menuRawTextFetchedAt?: FSTimestamp;
  menuItems?: unknown | null;
  menuPdfUrl?: string | null;

  // Wugi Door / Stripe (preserve if present — never overwrite from scrape)
  stripeConnectAccountId?: string;
  stripeTerminalLocationId?: string;
  payoutTier?: string;
  payoutSchedule?: string;
  payoutDelayHours?: number;
  payoutPreEvent?: boolean;
  reservePercent?: number;
  reserveBalance?: number;
  paymentDescriptor?: string;
  paymentDescriptorNote?: string;
  idVerificationThreshold?: number;
  totalOrders?: number;
  chargebackCount?: number;
  chargebackBalance?: number;

  // Timestamps + meta
  createdAt: FSTimestamp;
  updatedAt: FSTimestamp;
  previousSlugs?: string[];
  schemaVersion: 2;
};

// ── Venue subcollections ──────────────────────────────────────────────

// Path: venues/{venueId}/audit/{logId}
export type VenueAuditLog = {
  changedAt: FSTimestamp;
  changedBy: string;
  changeType: 'create' | 'refresh' | 'update' | 'delete';
  source: string;
  fieldsChanged: string[];
  diff?: Record<string, { from: unknown; to: unknown }>;
  reviewed: boolean;
  reviewedBy?: string;
  reviewedAt?: FSTimestamp;
  notes?: string;
};

// Path: venues/{venueId}/private/contact (admin-only via Firestore rules)
export type VenuePrivateContact = {
  ownerName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  billingEmail?: string;
  taxId?: string;
  notes?: string;
  pilotStatus?: string;
  csmAssigned?: string;
};

// ── Event v2 ──────────────────────────────────────────────────────────
// Path: events/{eventId}
// Schema version: 2

export type EventV2 = {
  // Identity
  id: string;
  slug: string;
  title: string;
  externalId?: string;

  // When
  date: string;
  dateISO: string;
  time?: string;
  startTime?: string;
  endTime?: string;
  isRecurring?: boolean;
  recurrenceRule?: string;
  timezone?: string;

  // Recurring series. Present in prod on ~100% of event docs (seriesId) and used
  // as an equality filter (isSeriesAnchor) by feed queries + the series Cloud
  // Functions. Previously absent from this type — added to fix schema drift.
  // See AGENTS.md "Firestore foot-guns" and functions/src/series/.
  seriesId?: string | null;
  isSeriesAnchor?: boolean;

  // Where
  venueId: string;
  venueName: string;
  venue: string; // legacy mirror = venueName
  address?: string;
  venueLatitude?: number;
  venueLongitude?: number;

  // Content
  about?: string;
  media: Media[];
  galleryId?: string;

  // Categorization
  age?: string;
  category?: string;
  vibes: Vibe[];
  tags: string[]; // includes 'After Hours' for after-hours events
  crowd?: Crowd[];

  // Tickets
  hasTickets?: boolean;
  ticketUrl?: string;
  ticketingProvider?: string;

  // Source
  source: EventSource;
  sourceUrl?: string;
  scrapedAt?: FSTimestamp;

  // Status
  status: EventStatus;
  isActive: boolean;
  isFeatured?: boolean;
  market: string;
  sortOrder?: number;

  // Confidence
  confidence: Confidence;

  // Timestamps
  createdAt: FSTimestamp;
  updatedAt: FSTimestamp;
  schemaVersion: 2;
};

// ── Event subcollection ───────────────────────────────────────────────

// Path: events/{eventId}/ticketTypes/{ticketTypeId}
// Unchanged from existing schema — included here for reference.
export type TicketType = {
  id: string;
  eventId: string;
  name: string;
  description?: string;
  price: number;
  capacity: number;
  available: number;
  tableCapacity?: number;
  sortOrder?: number;
  status?: string;
  active: boolean;
  createdAt: FSTimestamp;
  updatedAt: FSTimestamp;
};

// ── Deal v2 ───────────────────────────────────────────────────────────
// Path: deals/{dealId}
//
// Canonical doc shape for the `deals` collection. Existing consumer code
// reads the runtime `FSDeal` type (firestoreService.ts / types/index.ts);
// this is the authoring/source-of-truth shape that supersedes the original
// thin { title, venueName, detail, image, vibes, expiresAt } deal.
//
// IMPORTANT (canonical-status footgun): consumer queries DO NOT hard-filter
// on `status` in Firestore — a missing/legacy value must never silently
// drop a deal from a feed. Eligibility + "active now" are computed
// client-side (src/utils/deals.ts). Always write the defaults below so a
// deal surfaces predictably.

export type DealType =
  | 'happyHour'
  | 'luckyHour'      // Afro District's branded happy-hour term
  | 'flash'          // one-off / single-date special
  | 'drinkSpecial'
  | 'foodSpecial'
  | 'bogo'
  | 'other';

export type DealStatus =
  | 'active'         // surfaced
  | 'paused'         // temporarily hidden by operator
  | 'expired';       // past its run; retained for history

export type DealV2 = {
  // Identity + ownership
  id: string;
  venueId: string;
  venueName: string;          // denormalized for card render without a join

  // Content
  title: string;
  description: string;        // longer copy; `detail` is the short offer line
  detail: string;             // short offer line shown on the card (legacy field, kept)
  dealType: DealType;
  image?: string;             // optional — falls back to the venue hero on render

  // Timing — recurrence-lite.
  //   Recurring: daysOfWeek (0=Sun..6=Sat) + startTime/endTime ("HH:MM", 24h).
  //     A window where endTime < startTime crosses midnight (nightlife).
  //   One-off (flash): a single `date` display string (e.g. "SAT JUN 21"),
  //     optionally narrowed by startTime/endTime.
  //   Both honor an optional validFrom/validUntil run window.
  daysOfWeek?: number[];
  startTime?: string;
  endTime?: string;
  date?: string;              // one-off / flash single date
  validFrom?: FSTimestamp | null;
  validUntil?: FSTimestamp | null;

  // Discovery
  vibes: string[];            // array-contains-any matching; never write []-as-undefined
  status: DealStatus;         // default 'active'
  isFeatured: boolean;        // default false — featured-first ordering
  isActive: boolean;          // default true — legacy boolean kept for back-compat

  // Voucher-ready hook for the post-launch SweetDeals model. ALWAYS false
  // now — there is no purchase path. Do not build one off this flag.
  requiresPurchase: boolean;  // default false

  // Test/seed marker — true for replaceable DEV seed data (never launch data).
  isTest?: boolean;
  note?: string;

  createdAt: FSTimestamp;
  updatedAt: FSTimestamp;
};

// ── Type guards / helpers ─────────────────────────────────────────────

export function isVibe(v: string): v is Vibe {
  return (VIBES as readonly string[]).includes(v);
}
export function isPrimaryCategory(v: string): v is PrimaryCategory {
  return (PRIMARY_CATEGORIES as readonly string[]).includes(v);
}
export function isNeighborhood(v: string): v is Neighborhood {
  return (NEIGHBORHOODS as readonly string[]).includes(v);
}
export function isAttribute(v: string): v is Attribute {
  return (ATTRIBUTES as readonly string[]).includes(v);
}
export function isCrowd(v: string): v is Crowd {
  return (CROWD as readonly string[]).includes(v);
}
