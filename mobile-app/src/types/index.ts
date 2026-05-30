// ─────────────────────────────────────────────────────────────────────
// Wugi — Shared TypeScript Types
// ─────────────────────────────────────────────────────────────────────

// ── Gallery ───────────────────────────────────────────────────────────
export type GalleryPhoto = {
  id: string;
  uri: string;
  height: number;
};

export type GalleryData = {
  id: string;
  title: string;
  venue: string;
  date: string;
  coverImage: string;
  photos: GalleryPhoto[];
};

// Top-level `galleries` collection doc — the single source of truth for
// event/venue photo galleries.
//
// ARCHITECTURE (for future Dashboard/Lens sessions): `galleries` is a
// TOP-LEVEL collection (queryable independently of the venue path). Wugi
// Dashboard is the authoritative management surface (CRUD + config /
// moderation). Wugi Lens pushes images and settings into this collection,
// conceptually through the Dashboard as the engine. The consumer app is
// READ-ONLY against this collection.
export type GalleryDoc = {
  id: string;
  venueId: string;
  eventId?: string | null;
  title: string;
  coverImage: string;        // cover image URL
  images: string[];          // image URLs
  photoCount: number;
  date: string;              // display string, e.g. "SAT MAY 17"
  photographerName?: string;
  photographerId?: string | null;
  createdAt?: unknown;       // Firestore Timestamp
  source: 'dashboard' | 'lens' | 'seed';
};

// Top-level `photos` collection doc — individual photos within a gallery,
// the source-of-truth for likeable / purchasable shots.
//
// ARCHITECTURE (same model as `galleries`): `galleries` + `photos` are
// TOP-LEVEL source-of-truth collections. Wugi Dashboard is the authoritative
// manager; Wugi Lens writes through it; the consumer app is READ-ONLY against
// both. `price` is in CENTS (matches the ticketing money convention).
export type PhotoDoc = {
  id: string;
  galleryId: string;
  venueId: string;
  eventId?: string | null;
  imageUrl: string;          // photo image URL (placeholder until Lens uploads)
  photographerName?: string;
  photographerId?: string | null;
  likes: number;
  price: number;             // CENTS (e.g. 500 = $5.00)
  createdAt?: unknown;       // Firestore Timestamp
  source: 'dashboard' | 'lens' | 'seed';
};

// ── Event ─────────────────────────────────────────────────────────────
export type EventData = {
  id: string;
  title: string;
  venue: string;
  // venueId is the Firestore venue doc id used by EventScreen's useVenueById
  // lookup. Optional because hand-seeded mock data and notification deep-links
  // may not carry it; the lookup hook treats missing venueId as a no-op.
  venueId?: string;
  date: string;
  time: string;
  age: string;
  about: string;
  media: { type: string; uri: string }[];
  gallery: GalleryData;
  hasTickets?: boolean;
};

// ── Venue ─────────────────────────────────────────────────────────────
export type VenueData = {
  id: string;
  name: string;
  category: string;
  address: string;
  phone: string;
  website: string;
  instagram: string;
  logoUrl?: string;
  attributes: string[];
  about: string;
  media: { type: string; uri: string }[];
  menuDescription: string;
  menuAttributes: string[];
  bestSellers: {
    id: string;
    name: string;
    category: string;
    rating: number;
    image: string;
  }[];
  upcomingEvents: EventData[];
  galleries: GalleryData[];

  // Added for the Scope B+ reskin. Optional so existing seed/mock data
  // without these fields still renders (the screen hides slots that are
  // missing). Populated by the Phase 2 Firestore ingest.
  shortDescription?: string;
  neighborhood?: string;
  priceTier?: string;          // e.g. "$", "$$", "$$$", "$$$$"
  rating?: number | null;      // venue-level rating, e.g. 4.2 (null = unrated)
  age?: string;                // e.g. "21+", "All Ages"
  dressCode?: string;
  hoursText?: string;
  openStatusHint?: string;     // e.g. "OPEN · TILL 12 AM"
  amenities?: string[];
  vibes?: string[];
  reservationProvider?: 'opentable' | 'direct' | string;
  reservationUrl?: string;
  reservationUrlWithDefaults?: string;
  ctaPrimary?: string;         // e.g. "Reserve a table" or "Get a Section"
  ctaSecondary?: string;       // e.g. "Directions"
};

// ── Menu ──────────────────────────────────────────────────────────────
// Menu items live at venues/{venueId}/menu/{itemId}. Rendered by
// MenuScreen (grouped by section) and MenuItemScreen (single dish detail).
// Phase 2 ingest populates these from scripts/venue-data/*.json; until
// then the subcollection is empty and MenuScreen shows a tasteful empty
// state. allergens/ingredients/pairings are design-spec fields not yet
// populated — MenuItemScreen hides slots that come back empty.
export type MenuItem = {
  id: string;
  name: string;
  description?: string;
  price?: number;
  priceDisplay?: string;
  section?: string;
  tags?: string[];
  badges?: string[];
  imageUrl?: string;
  allergens?: string[];
  ingredients?: string[];
  pairings?: string[];
};

// ── For You ───────────────────────────────────────────────────────────
export type ForYouCard = {
  id: string;
  type: 'event' | 'venue' | 'food' | 'deal' | 'gallery' | 'video';
  image: string;
  videoUri?: string;
  title: string;
  subtitle: string;
  tag: string;
  tagColor: string;
  data: EventData | VenueData | null;
};

// ── Favorites ─────────────────────────────────────────────────────────
export type FavoriteItem = {
  id: string;
  type: 'event' | 'venue';
  title: string;
  subtitle: string;
  image: string;
  read: boolean;
  data: EventData | VenueData;
};

// Persisted favorite doc in the top-level `favorites` collection.
// Deterministic doc id `${userId}_${itemType}_${itemId}` makes add/remove
// idempotent. `photo` is supported for the upcoming photo-likes flow even
// though the in-memory FavoriteItem only models event/venue today.
export type FavoriteDoc = {
  userId: string;
  itemType: 'event' | 'venue' | 'photo';
  itemId: string;
  createdAt?: unknown;       // Firestore serverTimestamp
};

// Persisted report doc in the top-level `reports` collection. Created when a
// user flags a photo. `status` starts 'open'; staff resolve via the Dashboard.
export type ReportDoc = {
  photoId: string;
  userId: string;
  reason: string;
  comment: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  createdAt?: unknown;       // Firestore serverTimestamp
};

// ── Editorial Discover (top-level source-of-truth collections) ────────
// The default Discover view is an editorial-shelf experience. Each shelf is
// one curated doc (a neighborhood guide, itinerary, or photographer feature)
// whose `cards` embed display fields (so a shelf renders without N joins) and
// carry the real venueId/eventId/galleryId for tap-through navigation.
//
// ARCHITECTURE (for future Dashboard/Lens sessions): `neighborhoodGuides`,
// `itineraries`, and `photographerFeatures` are TOP-LEVEL collections — the
// single source of truth. Wugi Dashboard is the authoritative management
// surface; Wugi Lens writes through it; the consumer app is READ-ONLY.
export type EditorialCardKind = 'venue' | 'event' | 'gallery' | 'photographer' | 'itinerary' | 'stop';

export type EditorialCard = {
  kind:      EditorialCardKind;
  title:     string;
  sub:       string;
  image:     string;
  tag:       string;
  tagColor:  string;
  ratio?:    number;      // width multiplier — 1 default, 1.5/2 for hero cards
  venueId?:  string;      // 'venue' | 'stop'
  eventId?:  string;      // 'event'
  galleryId?: string;     // 'gallery'
};

type EditorialShelfBase = {
  id:         string;
  kicker:     string;
  title:      string;
  subtitle:   string;
  coverImage: string;
  cards:      EditorialCard[];
  order:      number;
  status:     'live' | 'draft';
  source:     string;     // 'seed' for placeholder content
  createdAt?: unknown;
};

export type NeighborhoodGuideDoc = EditorialShelfBase & {
  neighborhood: string;
  venueIds:     string[];
};

export type ItineraryDoc = EditorialShelfBase & {
  neighborhood?: string;
};

export type PhotographerFeatureDoc = EditorialShelfBase & {
  photographerHandle: string;
  photographerName?:  string;
  galleryIds:         string[];
};

// Discriminated wrapper so the editorial screen can render a single, merged,
// Dashboard-ordered list of mixed shelf types.
export type EditorialShelf =
  | { type: 'neighborhoodGuide';   doc: NeighborhoodGuideDoc }
  | { type: 'itinerary';           doc: ItineraryDoc }
  | { type: 'photographerFeature'; doc: PhotographerFeatureDoc };

// ── Navigation ────────────────────────────────────────────────────────
export type NavEntry =
  | { screen: 'home' }
  | { screen: 'event'; event: EventData }
  | { screen: 'venue'; venue: VenueData }
  | { screen: 'map'; address: string; venueName: string }
  | { screen: 'gallery'; gallery: GalleryData }
  | { screen: 'photo'; photos: GalleryPhoto[]; initialIndex: number; galleryTitle: string; venue: string; date: string }
  | { screen: 'passes' }
  | { screen: 'camera' }
  | { screen: 'ticketSelection'; eventId: string; eventName: string; venueName: string; eventDate: string; eventTime: string }
  | { screen: 'payment'; selection: import('../features/ticketing/TicketSelectionScreen').TicketSelection }
  | { screen: 'pass'; orderId: string; isGuest?: boolean }
  | { screen: 'scan'; eventId: string; eventName: string; venueName: string; eventDate: string; eventTime: string }
  | { screen: 'menu'; venueId: string; venueName: string }
  | { screen: 'menuItem'; venueId: string; venueName: string; item: MenuItem }
  // Editorial Discover: search-bar tap pushes the existing DiscoverScreen as
  // the search/filter mode (initialMapOn opens it on the map placeholder).
  | { screen: 'discoverSearch'; initialMapOn?: boolean }
  // Saved "View All" destination — per-section full-list view (one for events,
  // one for venues). Passes intentionally NOT included (Wave 3 refactor).
  | { screen: 'savedList'; kind: 'event' | 'venue' };

// ── Firestore (local stubs until Firebase is wired) ───────────────────
export type FSEvent = {
  id: string;
  title: string;
  venue: string;
  venueId: string;
  date: string;
  time: string;
  age: string;
  about: string;
  vibes: string[];
  media: { type: string; uri: string }[];
  status: string;
  hasTickets?: boolean;
  // Editorial featured flag — when true, the event is hand-promoted to the
  // top of the Home featured slot (preferred over the legacy isFeatured /
  // soonest fallback). Set by seed-featured.ts / the Dashboard.
  eventFeatured?: boolean;
  isFeatured?: boolean;
  createdAt: any;
};

export type FSVenue = {
  id: string;
  name: string;
  category: string;
  address: string;
  phone: string;
  website: string;
  instagram: string;
  attributes: string[];
  vibes: string[];
  about: string;
  // Legacy docs may store either bare URLs or {type, uri} objects.
  // toVenueData() normalizes to object shape before render.
  media: (string | { type: string; uri: string })[];
  status: string;
  createdAt: any;

  // Reskin fields (optional — may be absent on docs predating Phase 2 ingest).
  shortDescription?: string;
  neighborhood?: string;
  priceTier?: string;
  rating?: number | null;
  age?: string;
  dressCode?: string;
  hoursText?: string;
  openStatusHint?: string;
  amenities?: string[];
  reservationProvider?: 'opentable' | 'direct' | string;
  reservationUrl?: string;
  reservationUrlWithDefaults?: string;
  ctaPrimary?: string;
  ctaSecondary?: string;

  // Editorial featured flag — when true, the venue is hand-promoted to the
  // top of the Home featured slot (preferred over the legacy isFeatured /
  // first-N fallback). Set by seed-featured.ts / the Dashboard.
  venueFeatured?: boolean;
  isFeatured?: boolean;
};

export type FSDeal = {
  id: string;
  title: string;
  venueName: string;
  venueId: string;
  detail: string;
  image: string;
  vibes: string[];
  expiresAt: any;
};

// ── Ticketing ─────────────────────────────────────────────────────────
export type TicketTypeKey =
  | 'general_admission'
  | 'vip'
  | 'vip_table'
  | 'backstage'
  | 'early_bird';

export type PassData = {
  passId:          string;
  eventTitle:      string;
  venueName:       string;
  date:            string;
  time:            string;
  ticketType:      TicketTypeKey;
  ticketTypeName?: string;
  holderName:      string;
  orderId:         string;
  role?:           'purchaser' | 'guest';
  status:          'claimed' | 'pending' | 'scanned' | 'valid';
  totalPasses?:    number;
  passNumber?:     number;
  qrValue?:        string;
  // Color system
  passColor?:      string | null;
  colorLabel?:     string | null;
  tableNumber?:    number | null;
  // Apple Wallet
  passUrl?:        string | null;
  // Transfer
  transferPending?:  boolean;
  transferred?:      boolean;
  transferId?:       string | null;
  // Purchase details
  totalPaid?:        number | null;        // cents
  balanceDue?:       number | null;        // cents owed at door
  depositPaid?:      number | null;        // cents already paid
  paymentMethodLast4?: string | null;
  purchasedAt?:      any;                  // Firestore Timestamp
  source?:           string | null;        // 'stripe' | 'free' | 'door' | 'transfer'
  // Transfer received details
  transferredFromName?:  string | null;
  transferredFromEmail?: string | null;
  transferredAt?:        any;
};

// ── Stories ───────────────────────────────────────────────────────────
export type StoryItem = {
  id: string;
  mediaUri: string;
  mediaType: 'photo' | 'video';
  username: string;
  timeAgo: string;
  locationVerified: boolean;
};

export type StoryGroup = {
  id: string;
  venueId: string;
  venueName: string;
  venueImage: string;
  seen: boolean;
  isAd?: boolean;
  ctaLabel?: string;
  stories: StoryItem[];
};
