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

// ── Event ─────────────────────────────────────────────────────────────
export type EventData = {
  id: string;
  title: string;
  venue: string;
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
  media: string[];
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
  | { screen: 'pass'; orderId: string }
  | { screen: 'scan'; eventId: string; eventName: string; venueName: string; eventDate: string; eventTime: string };

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
  media: string[];
  status: string;
  createdAt: any;
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
  passId: string;
  eventTitle: string;
  venueName: string;
  date: string;
  time: string;
  ticketType: TicketTypeKey;
  holderName: string;
  orderId: string;
  role: 'purchaser' | 'guest';
  status: 'claimed' | 'pending' | 'scanned';
  totalPasses?: number;
  passNumber?: number;
  transferable?: boolean;
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
