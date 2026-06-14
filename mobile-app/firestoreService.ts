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
import type {
  EditorialShelf, NeighborhoodGuideDoc, ItineraryDoc, PhotographerFeatureDoc, GalleryDoc,
} from './src/types';

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
// ── Computed series anchor (replaces the stored isSeriesAnchor flag) ───
// The marquee/feed surfaces exactly ONE card per recurring series: the
// soonest occurrence that has not yet expired. Expiry rule: an occurrence
// dated D stays eligible until 06:00 America/New_York on D+1, then it rolls
// forward to the next occurrence. This is computed at query time — no stored
// or maintained anchor (retires isSeriesAnchor for read paths).

// Earliest still-eligible calendar date (YYYY-MM-DD) in America/New_York.
// Before 06:00 ET, yesterday's occurrence is still "live tonight" and eligible.
function minEligibleDateISOEastern(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map(x => [x.type, x.value]));
  let base = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  if (Number(p.hour) < 6) base -= 86400000; // pre-6am ET → yesterday still eligible
  return new Date(base).toISOString().slice(0, 10);
}

// Occurrence date as YYYY-MM-DD: prefer dateISO; else null (undated one-offs
// are treated as always-eligible so they are never silently dropped).
function occurrenceDateISO(e: FSEvent): string | null {
  const iso = (e as any).dateISO;
  return (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso)) ? iso.slice(0, 10) : null;
}

// Collapse a raw approved-events list into the feed: drop expired occurrences,
// then keep exactly one card per seriesId (the earliest eligible occurrence).
// Events without a seriesId pass through individually (one-offs).
function computeSeriesFeed(events: FSEvent[]): FSEvent[] {
  const minISO = minEligibleDateISOEastern();
  const out: FSEvent[] = [];
  const bySeries = new Map<string, FSEvent>();
  for (const e of events) {
    const iso = occurrenceDateISO(e);
    if (iso !== null && iso < minISO) continue; // expired
    const sid = (e as any).seriesId;
    if (!sid) { out.push(e); continue; }
    const cur = bySeries.get(sid);
    if (!cur) { bySeries.set(sid, e); continue; }
    const a = occurrenceDateISO(e) ?? '9999-99-99';
    const b = occurrenceDateISO(cur) ?? '9999-99-99';
    if (a < b) bySeries.set(sid, e); // keep soonest eligible occurrence
  }
  out.push(...bySeries.values());
  return out;
}

// Stable feed ordering: featured first, then newest createdAt (matches the
// prior server orderBy now that grouping happens client-side).
function sortFeed(a: FSEvent, b: FSEvent): number {
  const f = ((b as any).isFeatured ? 1 : 0) - ((a as any).isFeatured ? 1 : 0);
  if (f !== 0) return f;
  return (((b as any).createdAt?.toMillis?.() ?? 0) - ((a as any).createdAt?.toMillis?.() ?? 0));
}

// Computed-anchor feed (replaces the isSeriesAnchor==true filter). Fetches
// approved events featured-first, then collapses each series to its earliest
// eligible occurrence client-side. vibes filtering is applied client-side so
// the query needs only ONE composite index (status, isFeatured, createdAt) —
// see the index note in the #76 report; DO NOT auto-deploy.
export async function getApprovedEvents(
  userVibes?: string[],
  max: number = 100
): Promise<FSEvent[]> {
  try {
    // Fetch generously (we collapse series client-side, so over-fetch to make
    // sure each distinct series is represented before trimming to `max`).
    const fetchLimit = Math.min(Math.max(max * 5, 100), 500);
    const q = query(
      collection(db, 'events'),
      where('status', '==', 'approved'),
      orderBy('isFeatured', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(fetchLimit)
    );
    const snap = await getDocs(q);
    const raw = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as FSEvent))
      .filter(notTestVenue);

    let feed = computeSeriesFeed(raw);
    if (userVibes && userVibes.length > 0) {
      feed = feed.filter(e => (e.vibes || []).some(v => userVibes.includes(v)));
    }
    feed.sort(sortFeed);
    return feed.slice(0, max);
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
// Computed-anchor feed (retires isSeriesAnchor). Each page is collapsed to the
// earliest eligible occurrence per series via computeSeriesFeed.
//
// ⚠️ REVIEW (#76, flagged — Phase 1 deliberately conservative): series dedup is
// applied WITHIN each page only. Because pagination is cursor-based over raw
// approved events, the same series could still appear on two different pages
// (different occurrences). Guaranteeing one-card-per-series ACROSS pages without
// the stored flag requires either offset pagination over the fully-computed feed
// or a load-all approach — a pagination-model change. NOT decided here; see report.
export async function getApprovedEventsPage(args: {
  cursor?:    PageCursor;
  limit?:     number;
  userVibes?: string[];
}): Promise<{ events: FSEvent[]; nextCursor: PageCursor; hasMore: boolean }> {
  const { cursor = null, limit: pageSize = 30, userVibes } = args;
  try {
    const constraints: any[] = [
      where('status', '==', 'approved'),
      orderBy('isFeatured', 'desc'),
      orderBy('createdAt',  'desc'),
    ];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(pageSize));

    const snap = await getDocs(query(collection(db, 'events'), ...constraints));
    const raw  = snap.docs.map(d => ({ id: d.id, ...d.data() } as FSEvent)).filter(notTestVenue);
    let events = computeSeriesFeed(raw);
    if (userVibes && userVibes.length > 0) {
      events = events.filter(e => (e.vibes || []).some(v => userVibes.includes(v)));
    }
    events.sort(sortFeed);
    const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
    return {
      events,
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

// ── Editorial Discover shelves ────────────────────────────────────────
// Reads the three top-level editorial collections, wraps each doc in a
// discriminated EditorialShelf, and returns them merged in Dashboard-defined
// `order`. status=='live' filter only; sort is client-side so no composite
// index is required. Consumer app is READ-ONLY against these collections.
export async function getEditorialShelves(): Promise<EditorialShelf[]> {
  try {
    const [guides, itineraries, features] = await Promise.all([
      getDocs(query(collection(db, 'neighborhoodGuides'),   where('status', '==', 'live'))),
      getDocs(query(collection(db, 'itineraries'),          where('status', '==', 'live'))),
      getDocs(query(collection(db, 'photographerFeatures'), where('status', '==', 'live'))),
    ]);

    const shelves: EditorialShelf[] = [];
    guides.docs.forEach((d: FirebaseFirestoreTypes.QueryDocumentSnapshot) =>
      shelves.push({ type: 'neighborhoodGuide',   doc: { ...(d.data() as object), id: d.id } as NeighborhoodGuideDoc }));
    itineraries.docs.forEach((d: FirebaseFirestoreTypes.QueryDocumentSnapshot) =>
      shelves.push({ type: 'itinerary',           doc: { ...(d.data() as object), id: d.id } as ItineraryDoc }));
    features.docs.forEach((d: FirebaseFirestoreTypes.QueryDocumentSnapshot) =>
      shelves.push({ type: 'photographerFeature', doc: { ...(d.data() as object), id: d.id } as PhotographerFeatureDoc }));

    shelves.sort((a, b) => (a.doc.order ?? 999) - (b.doc.order ?? 999));
    return shelves;
  } catch (e) {
    console.log('getEditorialShelves error:', e);
    return [];
  }
}

// Fetch a single gallery doc (top-level `galleries`) so an editorial gallery
// card can navigate into the existing GalleryScreen → PhotoViewer flow.
export async function getGalleryById(galleryId: string): Promise<GalleryDoc | null> {
  try {
    const snap = await getDoc(doc(collection(db, 'galleries'), galleryId));
    if (!snap.exists()) return null;
    return { ...(snap.data() as object), id: snap.id } as GalleryDoc;
  } catch (e) {
    console.log('getGalleryById error:', e);
    return null;
  }
}

// Fetch galleries linked to a specific event (top-level `galleries`,
// gallery.eventId == eventId). Used by EventScreen to render the real event
// gallery instead of a generic placeholder. Single-field where (no composite
// index required); newest-first sort is client-side. Returns [] when no
// gallery has been linked yet (eventId backfill — scripts/backfill-gallery-eventid.ts
// — populates this in prod; until then most galleries have eventId:null and
// the caller falls back to its existing generic gallery).
export async function getGalleriesByEvent(eventId: string, max: number = 20): Promise<GalleryDoc[]> {
  try {
    if (!eventId) return [];
    const snap = await getDocs(
      query(collection(db, 'galleries'), where('eventId', '==', eventId), limit(max))
    );
    const docs = snap.docs.map((d: FirebaseFirestoreTypes.QueryDocumentSnapshot) => ({ ...(d.data() as object), id: d.id } as GalleryDoc));
    docs.sort((a: GalleryDoc, b: GalleryDoc) => ((b as any).createdAt?.toMillis?.() ?? 0) - ((a as any).createdAt?.toMillis?.() ?? 0));
    return docs;
  } catch (e) {
    console.log('getGalleriesByEvent error:', e);
    return [];
  }
}

// Fetch galleries linked to a recurring series (top-level `galleries`,
// gallery.seriesId == seriesId). Lets EventScreen resolve a gallery for ANY
// occurrence of a series, not just the single event a gallery's eventId points
// at. Single-field where (no composite index required); newest-first sort is
// client-side. Returns [] when no gallery carries this seriesId (seriesId
// backfill populates this in prod; until then galleries are eventId/venueId-scoped).
export async function getGalleriesBySeries(seriesId: string, max: number = 20): Promise<GalleryDoc[]> {
  try {
    if (!seriesId) return [];
    const snap = await getDocs(
      query(collection(db, 'galleries'), where('seriesId', '==', seriesId), limit(max))
    );
    const docs = snap.docs.map((d: FirebaseFirestoreTypes.QueryDocumentSnapshot) => ({ ...(d.data() as object), id: d.id } as GalleryDoc));
    // Tiebreak: when multiple galleries share a seriesId, return the one tied to
    // the MOST RECENT occurrence first (newest by `event_date`, an ISO YYYY-MM-DD
    // string → lexical compare desc). Fall back to createdAt when event_date is
    // absent/equal. The resolution path (useEventGalleriesBySeriesId) takes [0]
    // and maps images[] → GalleryData.photos, so the returned gallery's .photos
    // is populated downstream.
    docs.sort((a: GalleryDoc, b: GalleryDoc) => {
      const ad = (a as any).event_date || '';
      const bd = (b as any).event_date || '';
      if (ad !== bd) return bd < ad ? -1 : 1; // newer event_date first
      return ((b as any).createdAt?.toMillis?.() ?? 0) - ((a as any).createdAt?.toMillis?.() ?? 0);
    });
    return docs;
  } catch (e) {
    console.log('getGalleriesBySeries error:', e);
    return [];
  }
}

// Fetch a single itinerary doc (top-level `itineraries`) so the editorial
// itinerary hero card can deep-link to ItineraryDetailScreen.
export async function getItineraryById(itineraryId: string): Promise<ItineraryDoc | null> {
  try {
    const snap = await getDoc(doc(collection(db, 'itineraries'), itineraryId));
    if (!snap.exists()) return null;
    return { ...(snap.data() as object), id: snap.id } as ItineraryDoc;
  } catch (e) {
    console.log('getItineraryById error:', e);
    return null;
  }
}

// ── Search-surface galleries ───────────────────────────────────────────
// Top-level `galleries` collection, ordered newest-first. No status field
// on gallery docs today, so this returns every gallery up to `max`. Used
// by DiscoverEditorialScreen search when "Galleries" is in the Type filter.
// Single-field orderBy (no composite index required).
export async function getApprovedGalleries(max: number = 50): Promise<GalleryDoc[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'galleries'), orderBy('createdAt', 'desc'), limit(max))
    );
    return snap.docs.map(d => ({ ...(d.data() as object), id: d.id } as GalleryDoc));
  } catch (e) {
    console.log('getApprovedGalleries error:', e);
    return [];
  }
}

// ── Search-surface filter taxonomies ───────────────────────────────────
// Reads filters/{vibes,amenities} — single docs each shape { values: string[] }.
// DiscoverEditorialScreen calls this lazily on first search-bar tap with a
// hardcoded fallback in place if the read fails. Writes are admin-only
// (firestore.rules catch-all blocks writes); seed via scripts/seed-filters.ts.
export type FilterTaxonomyDoc = { values: string[] };
export async function getFilterTaxonomy(name: 'vibes' | 'amenities'): Promise<string[] | null> {
  try {
    const snap = await getDoc(doc(collection(db, 'filters'), name));
    if (!snap.exists()) return null;
    const data = snap.data() as FilterTaxonomyDoc | undefined;
    if (!data || !Array.isArray(data.values)) return null;
    return data.values.filter(v => typeof v === 'string' && v.length > 0);
  } catch (e) {
    console.log(`getFilterTaxonomy(${name}) error:`, e);
    return null;
  }
}
