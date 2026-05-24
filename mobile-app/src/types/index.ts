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
  | { screen: 'menuItem'; venueId: string; venueName: string; item: MenuItem };

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
