// ─────────────────────────────────────────────────────────────────────
// Wugi — firestoreService.ts
// Modular API for @react-native-firebase/firestore v23
//
// CANONICAL STATUS ENUM (locked by INFRA-VENUE-11)
// ─────────────────────────────────────────────────────────────────────
// Venue status: 'approved' | 'unclaimed' | 'pending_review' | 'closed' | 'disabled'
//   approved       — owner-claimed and verified, full profile
//   unclaimed      — published from scrape, no operator yet, surfaced with claim CTA
//   pending_review — confidence too low for auto-publish, awaits moderation
//   closed         — confirmed permanently closed; banner shown on profile
//   disabled       — admin-hidden (duplicate, bad data, ToS)
//
// Event status:  'approved' | 'pending_review' | 'closed' | 'rejected'
//   approved       — published, surfaced in consumer feed
//   pending_review — admin must approve before surfacing
//   closed         — past event, retained for history but hidden
//   rejected       — admin denied; never surfaces
//
// Phase 3 transform writes ONLY canonical values. Any other value is a bug —
// scripts/normalize-venue-status.js can map legacy values back to canonical.
//
// Consumer queries (this file): show 'approved' + 'unclaimed' + 'pending_review'
// for venues; show 'approved' for events. Closed/disabled/rejected never surface.
// All consumer queries also filter test venues client-side via notTestVenue().
// ─────────────────────────────────────────────────────────────────────
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  orderBy,
  startAfter,
  serverTimestamp,
  addDoc,
} from '@react-native-firebase/firestore';
import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

// Cursor type used by the *Page() variants for cursor-based pagination.
// Holds the last DocumentSnapshot from the previous page (Firestore's
// startAfter() shape). Opaque to callers — pass through verbatim.
export type PageCursor = FirebaseFirestoreTypes.DocumentSnapshot | null;
export type PageResult<T> = { venues?: T[]; events?: T[]; nextCursor: PageCursor; hasMore: boolean };

const db = getFirestore();

// ── Types ─────────────────────────────────────────────────────────────
export type UserProfile = {
  uid: string;
  email: string;
  displayName?: string;
  username?: string;
  phoneNumber?: string;
  role: 'consumer' | 'super_admin' | 'moderator' | 'support';
  vibes: string[];
  affinityScores?: Record<string, number>;
  emailVerified?: boolean;
  createdAt: any;
};

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
  // VENUE-DATA-08 Deliverable C: recurring-event series fields
  seriesId?: string | null;
  isSeriesAnchor?: boolean;
  seriesOccurrences?: string[] | null;
  isTestVenue?: boolean;
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
  instagramSource?: string;
  instagramInferred?: boolean;
  attributes: string[];
  vibes: string[];
  about: string;
  // Legacy docs may store either bare URLs or {type, uri} objects.
  // toVenueData() normalizes to object shape before render.
  media: (string | { type: string; uri: string })[];

  // Status model:
  //   pending_review — confidence < 80, needs manual approval, visible in app
  //   unclaimed      — confidence >= 80, live in app with "Claim this venue" CTA
  //   approved       — venue claimed and verified, full profile
  //   closed         — permanently closed, shows closure banner, NOT in discovery
  //   disabled       — hidden completely (duplicates, bad data)
  status: 'unclaimed' | 'approved' | 'pending_review' | 'closed' | 'disabled';

  isClaimed: boolean;
  claimedBy?: string | null;
  claimedAt?: any;

  // Closed venue fields
  closedAt?: any;
  closedReason?: string;
  replacedBy?: string;         // docId of venue that replaced this one
  previousVenue?: string;      // docId of venue this replaced
  previousVenueName?: string;

  // Neighborhood — used for Discover neighborhood filter
  neighborhood?: string;
  neighborhoodSlug?: string;
  neighborhoodBounds?: Record<string, number>;

  // Hours
  hours?: string[];
  hoursVisible?: boolean;
  specialHours?: {
    date: string;
    label: string;
    hours: string | null;
    isClosed: boolean;
  }[];

  // Parking
  parking?: Record<string, boolean>;

  // Meta
  rating?: number | null;
  priceLevel?: string;
  googlePlaceId?: string;
  location?: { latitude: number; longitude: number };

  // Confidence scoring
  confidence?: {
    overall: number;
    breakdown: Record<string, { score: number; visible: boolean; source: string }>;
  };

  isActive?: boolean;
  isFeatured?: boolean;
  isTestVenue?: boolean;       // true = hide from consumer queries (Wugi Door QA only)
  createdAt: any;
  updatedAt?: any;
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

// ── User ──────────────────────────────────────────────────────────────
export async function upsertUserProfile(
  uid: string,
  email: string,
  displayName?: string,
  emailVerified?: boolean
): Promise<void> {
  const ref = doc(collection(db, 'users'), uid);

  // Use merge:true so existing fields (role, vibes, etc.) are never overwritten
  // Retry up to 3 times to handle the auth token propagation race on first sign-in
  let lastError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          uid,
          email,
          displayName: displayName || '',
          role: 'consumer',
          vibes: [],
          affinityScores: {},
          emailVerified: emailVerified ?? false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        console.log('upsertUserProfile: created user doc for', uid);
      } else {
        // Update mutable fields only — never overwrite role, vibes, or emailVerified
        // (emailVerified is flipped to true via markEmailVerified once the user verifies)
        await updateDoc(ref, {
          email,
          displayName: displayName || snap.data()?.displayName || '',
          updatedAt: serverTimestamp(),
        });
        console.log('upsertUserProfile: updated user doc for', uid);
      }
      return; // success
    } catch (e: any) {
      lastError = e;
      console.log(`upsertUserProfile attempt ${attempt} failed:`, e?.code, e?.message);
      if (attempt < 3) {
        // Wait 500ms before retry — gives auth token time to propagate
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
  console.log('upsertUserProfile: all retries failed for', uid, lastError);
}

export async function markEmailVerified(uid: string): Promise<void> {
  const ref = doc(collection(db, 'users'), uid);
  await updateDoc(ref, { emailVerified: true, updatedAt: serverTimestamp() });
}

export async function saveUserVibes(uid: string, vibes: string[]): Promise<void> {
  try {
    const ref = doc(collection(db, 'users'), uid);
    await updateDoc(ref, { vibes });
    console.log('saveUserVibes: saved vibes for', uid, vibes);
  } catch (e) {
    console.log('saveUserVibes error:', e);
  }
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    const ref  = doc(collection(db, 'users'), uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { uid, ...snap.data() } as UserProfile;
  } catch (e) {
    console.log('getUserProfile error:', e);
    return null;
  }
}

// ── Username ──────────────────────────────────────────────────────────
// usernames/{username} → { uid, claimedAt }
// Lowercase-only for case-insensitive uniqueness checks.

export async function checkUsernameAvailable(username: string): Promise<boolean> {
  try {
    const normalized = username.toLowerCase().trim();
    const snap = await getDoc(doc(collection(db, 'usernames'), normalized));
    return !snap.exists();
  } catch (e) {
    console.log('checkUsernameAvailable error:', e);
    return false;
  }
}

export async function saveUsername(uid: string, username: string): Promise<void> {
  const normalized  = username.toLowerCase().trim();
  const usernameRef = doc(collection(db, 'usernames'), normalized);
  const userRef     = doc(collection(db, 'users'), uid);

  // Final availability check
  const usernameSnap = await getDoc(usernameRef);
  if (usernameSnap.exists() && usernameSnap.data()?.uid !== uid) {
    throw new Error('Username already taken');
  }

  // Retry up to 3 times — users/{uid} doc may not exist immediately after signup
  // due to auth token propagation delay before upsertUserProfile completes
  let lastError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 800 * attempt));
          continue;
        }
        throw new Error('Profile not ready yet. Please try again.');
      }
      await Promise.all([
        setDoc(usernameRef, { uid, claimedAt: serverTimestamp() }),
        updateDoc(userRef, { username: normalized, updatedAt: serverTimestamp() }),
      ]);
      console.log('saveUsername: claimed', normalized, 'for', uid);
      return;
    } catch (e: any) {
      lastError = e;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 800 * attempt));
    }
  }
  throw lastError;
}

// ── Phone Index ───────────────────────────────────────────────────────
// phoneIndex/{E164PhoneNumber} → { uid, claimedAt }
// Prevents recycled-number attacks. Old number freed after 30 days.

export async function savePhoneNumber(uid: string, e164Phone: string): Promise<void> {
  try {
    const phoneRef = doc(collection(db, 'phoneIndex'), e164Phone);
    const userRef  = doc(collection(db, 'users'), uid);

    const existing = await getDoc(phoneRef);
    if (existing.exists() && existing.data()?.uid !== uid) {
      throw new Error('Phone number already linked to another account');
    }

    await Promise.all([
      setDoc(phoneRef, { uid, claimedAt: serverTimestamp() }),
      updateDoc(userRef, { phoneNumber: e164Phone, updatedAt: serverTimestamp() }),
    ]);
    console.log('savePhoneNumber: linked', e164Phone, 'to', uid);
  } catch (e) {
    console.log('savePhoneNumber error:', e);
    throw e;
  }
}

// ── Activity Tracking ─────────────────────────────────────────────────
export async function logActivity(
  uid: string,
  activity: {
    type: string;
    contentId: string;
    contentType: string;
    vibes: string[];
  }
): Promise<void> {
  try {
    if (!uid || uid === 'anon') return;
    await addDoc(collection(db, 'users', uid, 'activity'), {
      ...activity,
      timestamp: serverTimestamp(),
    });
  } catch (e) {
    // Non-blocking
  }
}

// ── isTestVenue filter ────────────────────────────────────────────────
// Test venues (e.g. Wugi Door QA at the Cumberland Teranga) carry
// `isTestVenue: true`. They must stay queryable for Wugi Door but never
// surface to consumers. Done client-side because Firestore `!=` excludes
// docs where the field is missing, and the legacy events collection
// hasn't been backfilled. Treats undefined as false.
function notTestVenue<T extends { isTestVenue?: boolean }>(d: T): boolean {
  return d.isTestVenue !== true;
}

// ── Events ────────────────────────────────────────────────────────────
// Default limit 100 (was 20) — catalog has 500+ events post-INFRA-VENUE-01.
// orderBy(isFeatured desc, createdAt desc) so launch-featured events lead
// and freshly-scraped data surfaces above hand-seeded test docs whose IDs
// happen to sort early. Composite index in firebase/firestore.indexes.json.
//
// VENUE-DATA-08 Deliverable C: filter on isSeriesAnchor==true so recurring
// event series (Friday Happy Hour at Teranga × 9 occurrences, etc.) only
// surface ONE card in consumer feed. Use getEventsForVenue() below to read
// all occurrences for a venue detail page.
export async function getApprovedEvents(
  userVibes?: string[],
  max: number = 100
): Promise<FSEvent[]> {
  try {
    let q;
    if (userVibes && userVibes.length > 0) {
      q = query(
        collection(db, 'events'),
        where('status', '==', 'approved'),
        where('isSeriesAnchor', '==', true),
        where('vibes', 'array-contains-any', userVibes),
        orderBy('isFeatured', 'desc'),
        orderBy('createdAt', 'desc'),
        limit(max)
      );
    } else {
      q = query(
        collection(db, 'events'),
        where('status', '==', 'approved'),
        where('isSeriesAnchor', '==', true),
        orderBy('isFeatured', 'desc'),
        orderBy('createdAt', 'desc'),
        limit(max)
      );
    }
    const snap = await getDocs(q);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as FSEvent))
      .filter(notTestVenue);
  } catch (e) {
    console.log('getApprovedEvents error:', e);
    return [];
  }
}

// ── Events for a specific venue (no series-anchor filter) ───────────
// Used by the venue detail page where the user expects to see ALL
// upcoming occurrences of the recurring series, not just the next one.
// VENUE-DATA-08 Deliverable C.
export async function getEventsForVenue(
  venueId: string,
  max: number = 50
): Promise<FSEvent[]> {
  try {
    const q = query(
      collection(db, 'events'),
      where('venueId', '==', venueId),
      where('status', '==', 'approved'),
      orderBy('createdAt', 'desc'),
      limit(max)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as FSEvent))
      .filter(notTestVenue);
  } catch (e) {
    console.log('getEventsForVenue error:', e);
    return [];
  }
}

export async function getEventById(eventId: string): Promise<FSEvent | null> {
  try {
    const snap = await getDoc(doc(collection(db, 'events'), eventId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as FSEvent;
  } catch (e) {
    console.log('getEventById error:', e);
    return null;
  }
}

// ── Venues ────────────────────────────────────────────────────────────
// Shows: approved + unclaimed + pending_review
// Hidden: closed (banner on profile) + disabled (hidden entirely)
//
// Default limit 100 (was 20) — catalog has 490 venues post-INFRA-VENUE-01.
// Each status-bucket query orders by isFeatured desc then createdAt desc.
// Composite indexes in firebase/firestore.indexes.json.
export async function getApprovedVenues(
  userVibes?: string[],
  max: number = 100
): Promise<FSVenue[]> {
  try {
    const buildQ = (statusVal: string) =>
      userVibes && userVibes.length > 0
        ? query(
            collection(db, 'venues'),
            where('status', '==', statusVal),
            where('vibes', 'array-contains-any', userVibes),
            orderBy('isFeatured', 'desc'),
            orderBy('createdAt', 'desc'),
            limit(max)
          )
        : query(
            collection(db, 'venues'),
            where('status', '==', statusVal),
            orderBy('isFeatured', 'desc'),
            orderBy('createdAt', 'desc'),
            limit(max)
          );

    const [approvedSnap, unclaimedSnap, pendingSnap] = await Promise.all([
      getDocs(buildQ('approved')),
      getDocs(buildQ('unclaimed')),
      getDocs(buildQ('pending_review')),
    ]);

    const seen    = new Set<string>();
    const results: FSVenue[] = [];

    [...approvedSnap.docs, ...unclaimedSnap.docs, ...pendingSnap.docs].forEach(d => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      const data = { id: d.id, ...d.data() } as FSVenue;
      if (!notTestVenue(data)) return;  // hide test venues
      results.push(data);
    });

    // Re-sort across status buckets so featured leads globally, not per-bucket.
    results.sort((a, b) => {
      const af = (a as any).isFeatured ? 1 : 0;
      const bf = (b as any).isFeatured ? 1 : 0;
      if (af !== bf) return bf - af;
      // Both featured (or both not): keep Firestore order (createdAt desc within bucket)
      return 0;
    });
    return results.slice(0, max);
  } catch (e) {
    console.log('getApprovedVenues error:', e);
    return [];
  }
}

export async function getVenueById(venueId: string): Promise<FSVenue | null> {
  try {
    const snap = await getDoc(doc(collection(db, 'venues'), venueId));
    if (!snap.exists()) return null;
    const data = { id: snap.id, ...snap.data() } as FSVenue;
    if (!notTestVenue(data)) return null;     // never deep-link to a test venue
    return data;
  } catch (e) {
    console.log('getVenueById error:', e);
    return null;
  }
}

// ── Paginated venues (cursor-based, for Discover infinite scroll) ────
// VENUE-DATA-07 Deliverable D.1
// Single status bucket only ('approved') for clean cursor semantics.
// (Multi-bucket pagination requires either a status union via in-clause
// or N parallel cursors — deferred to a future refinement; for now the
// pending_review pool surfaces via the non-paginated getApprovedVenues.)
export async function getApprovedVenuesPage(args: {
  cursor?:    PageCursor;
  limit?:     number;
  userVibes?: string[];
}): Promise<{ venues: FSVenue[]; nextCursor: PageCursor; hasMore: boolean }> {
  const { cursor = null, limit: pageSize = 30, userVibes } = args;
  try {
    const constraints: any[] = [
      where('status', '==', 'approved'),
      orderBy('isFeatured', 'desc'),
      orderBy('createdAt',  'desc'),
    ];
    if (userVibes && userVibes.length > 0) {
      // array-contains-any goes BEFORE the orderBy clauses syntactically
      // in modern Firebase JS SDK; the where()/orderBy()/limit() composition
      // is order-independent at runtime so we can append.
      constraints.unshift(where('vibes', 'array-contains-any', userVibes));
    }
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(pageSize));

    const snap = await getDocs(query(collection(db, 'venues'), ...constraints));
    const all  = snap.docs.map(d => ({ id: d.id, ...d.data() } as FSVenue)).filter(notTestVenue);
    const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
    return {
      venues:     all,
      nextCursor: snap.docs.length === pageSize ? lastDoc : null,
      hasMore:    snap.docs.length === pageSize,
    };
  } catch (e) {
    console.log('getApprovedVenuesPage error:', e);
    return { venues: [], nextCursor: null, hasMore: false };
  }
}

// ── Paginated events (cursor-based) ──────────────────────────────────
// VENUE-DATA-08 Deliverable C: also filters isSeriesAnchor==true so the
// infinite-scroll feed shows ONE card per recurring series.
export async function getApprovedEventsPage(args: {
  cursor?:    PageCursor;
  limit?:     number;
  userVibes?: string[];
}): Promise<{ events: FSEvent[]; nextCursor: PageCursor; hasMore: boolean }> {
  const { cursor = null, limit: pageSize = 30, userVibes } = args;
  try {
    const constraints: any[] = [
      where('status', '==', 'approved'),
      where('isSeriesAnchor', '==', true),
      orderBy('isFeatured', 'desc'),
      orderBy('createdAt',  'desc'),
    ];
    if (userVibes && userVibes.length > 0) {
      constraints.unshift(where('vibes', 'array-contains-any', userVibes));
    }
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(pageSize));

    const snap = await getDocs(query(collection(db, 'events'), ...constraints));
    const all  = snap.docs.map(d => ({ id: d.id, ...d.data() } as FSEvent)).filter(notTestVenue);
    const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
    return {
      events:     all,
      nextCursor: snap.docs.length === pageSize ? lastDoc : null,
      hasMore:    snap.docs.length === pageSize,
    };
  } catch (e) {
    console.log('getApprovedEventsPage error:', e);
    return { events: [], nextCursor: null, hasMore: false };
  }
}

// ── Venues by Neighborhood ────────────────────────────────────────────
// Default limit bumped to 100 to match getApprovedVenues. Same featured-first
// ordering. Composite index: neighborhoodSlug ASC, status ASC, isFeatured DESC,
// createdAt DESC.
export async function getVenuesByNeighborhood(
  neighborhoodSlug: string,
  max: number = 100
): Promise<FSVenue[]> {
  try {
    const statuses = ['approved', 'unclaimed', 'pending_review'];
    const snaps    = await Promise.all(
      statuses.map(status =>
        getDocs(query(
          collection(db, 'venues'),
          where('neighborhoodSlug', '==', neighborhoodSlug),
          where('status', '==', status),
          orderBy('isFeatured', 'desc'),
          orderBy('createdAt', 'desc'),
          limit(max)
        ))
      )
    );

    const seen    = new Set<string>();
    const results: FSVenue[] = [];
    snaps.flatMap(s => s.docs).forEach(d => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      const data = { id: d.id, ...d.data() } as FSVenue;
      if (notTestVenue(data)) results.push(data);
    });
    results.sort((a, b) => {
      const af = (a as any).isFeatured ? 1 : 0;
      const bf = (b as any).isFeatured ? 1 : 0;
      return bf - af;
    });
    return results.slice(0, max);
  } catch (e) {
    console.log('getVenuesByNeighborhood error:', e);
    return [];
  }
}

// ── Deals ─────────────────────────────────────────────────────────────
export async function getActiveDeals(
  userVibes?: string[],
  max: number = 5
): Promise<FSDeal[]> {
  try {
    let q;
    if (userVibes && userVibes.length > 0) {
      q = query(
        collection(db, 'deals'),
        where('vibes', 'array-contains-any', userVibes),
        limit(max)
      );
    } else {
      q = query(collection(db, 'deals'), limit(max));
    }
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as FSDeal));
  } catch (e) {
    console.log('getActiveDeals error:', e);
    return [];
  }
}

// ── Favorites / Likes ─────────────────────────────────────────────────
// Top-level `favorites` collection. Deterministic doc id
// `${userId}_${itemType}_${itemId}` makes add/remove idempotent (setDoc /
// deleteDoc on the same id). itemType is 'event' | 'venue' | 'photo'.
// Doc shape: { userId, itemType, itemId, createdAt: serverTimestamp() }.
// Security rules gate every read/write to the owning userId.
export type FavoriteItemType = 'event' | 'venue' | 'photo';

export type FavoriteDoc = {
  userId: string;
  itemType: FavoriteItemType;
  itemId: string;
  createdAt: any;
};

function favoriteDocId(userId: string, itemType: FavoriteItemType, itemId: string): string {
  return `${userId}_${itemType}_${itemId}`;
}

export async function addFavorite(
  userId: string,
  itemType: FavoriteItemType,
  itemId: string
): Promise<void> {
  try {
    if (!userId) return;
    const id = favoriteDocId(userId, itemType, itemId);
    await setDoc(
      doc(collection(db, 'favorites'), id),
      { userId, itemType, itemId, createdAt: serverTimestamp() },
      { merge: true }
    );
  } catch (e) {
    console.log('addFavorite error:', e);
  }
}

export async function removeFavorite(
  userId: string,
  itemType: FavoriteItemType,
  itemId: string
): Promise<void> {
  try {
    if (!userId) return;
    const id = favoriteDocId(userId, itemType, itemId);
    await deleteDoc(doc(collection(db, 'favorites'), id));
  } catch (e) {
    console.log('removeFavorite error:', e);
  }
}

export async function listFavorites(userId: string): Promise<FavoriteDoc[]> {
  try {
    if (!userId) return [];
    const snap = await getDocs(
      query(collection(db, 'favorites'), where('userId', '==', userId))
    );
    return snap.docs.map((d: FirebaseFirestoreTypes.QueryDocumentSnapshot) => d.data() as FavoriteDoc);
  } catch (e) {
    console.log('listFavorites error:', e);
    return [];
  }
}

export async function listFavoritesByType(
  userId: string,
  itemType: FavoriteItemType
): Promise<FavoriteDoc[]> {
  try {
    if (!userId) return [];
    const snap = await getDocs(
      query(
        collection(db, 'favorites'),
        where('userId', '==', userId),
        where('itemType', '==', itemType)
      )
    );
    return snap.docs.map((d: FirebaseFirestoreTypes.QueryDocumentSnapshot) => d.data() as FavoriteDoc);
  } catch (e) {
    console.log('listFavoritesByType error:', e);
    return [];
  }
}

export async function isFavorite(
  userId: string,
  itemType: FavoriteItemType,
  itemId: string
): Promise<boolean> {
  try {
    if (!userId) return false;
    const id = favoriteDocId(userId, itemType, itemId);
    const snap = await getDoc(doc(collection(db, 'favorites'), id));
    return snap.exists();
  } catch (e) {
    console.log('isFavorite error:', e);
    return false;
  }
}

// ── Reports ───────────────────────────────────────────────────────────
// Top-level `reports` collection. Created when a user flags a photo.
// Materializes on first write (no seed needed). status starts 'open';
// staff resolve via the Dashboard. Rules: create only with own userId +
// status=='open'; read own reports (or staff); no client update/delete.
export async function createReport(
  photoId: string,
  userId: string,
  reason: string,
  comment: string
): Promise<string | null> {
  try {
    const ref = await addDoc(collection(db, 'reports'), {
      photoId,
      userId,
      reason,
      comment,
      status: 'open',
      createdAt: serverTimestamp(),
    });
    return ref.id;
  } catch (e) {
    console.log('createReport error:', e);
    return null;
  }
}

// ── For You Feed ──────────────────────────────────────────────────────
export async function getForYouFeed(
  userVibes?: string[]
): Promise<{ events: FSEvent[]; venues: FSVenue[] }> {
  const [events, venues] = await Promise.all([
    getApprovedEvents(userVibes, 10),
    getApprovedVenues(userVibes, 5),
  ]);
  return { events, venues };
}
