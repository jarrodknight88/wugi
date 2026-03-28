// ─────────────────────────────────────────────────────────────────────
// Wugi — firestoreService.ts
// Modular API for @react-native-firebase/firestore v23
// ─────────────────────────────────────────────────────────────────────
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  limit,
  serverTimestamp,
  addDoc,
} from '@react-native-firebase/firestore';

const db = getFirestore();

// ── Types ─────────────────────────────────────────────────────────────
export type UserProfile = {
  uid: string;
  email: string;
  displayName?: string;
  role: 'consumer' | 'super_admin' | 'moderator' | 'support';
  vibes: string[];
  affinityScores?: Record<string, number>;
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
  media: string[];

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
  displayName?: string
): Promise<void> {
  try {
    const ref  = doc(collection(db, 'users'), uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        email,
        displayName: displayName || '',
        role: 'consumer',
        vibes: [],
        affinityScores: {},
        createdAt: serverTimestamp(),
      });
      console.log('upsertUserProfile: created user doc for', uid);
    } else {
      console.log('upsertUserProfile: user doc already exists for', uid);
    }
  } catch (e) {
    console.log('upsertUserProfile error:', e);
  }
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

// ── Events ────────────────────────────────────────────────────────────
export async function getApprovedEvents(
  userVibes?: string[],
  max: number = 20
): Promise<FSEvent[]> {
  try {
    let q;
    if (userVibes && userVibes.length > 0) {
      q = query(
        collection(db, 'events'),
        where('status', '==', 'approved'),
        where('vibes', 'array-contains-any', userVibes),
        limit(max)
      );
    } else {
      q = query(
        collection(db, 'events'),
        where('status', '==', 'approved'),
        limit(max)
      );
    }
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as FSEvent));
  } catch (e) {
    console.log('getApprovedEvents error:', e);
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
// Hidden: closed (shows banner on profile) + disabled (hidden entirely)
export async function getApprovedVenues(
  userVibes?: string[],
  max: number = 20
): Promise<FSVenue[]> {
  try {
    const [approvedSnap, unclaimedSnap, pendingSnap] = await Promise.all([
      getDocs(query(collection(db, 'venues'), where('status', '==', 'approved'),       limit(max))),
      getDocs(query(collection(db, 'venues'), where('status', '==', 'unclaimed'),      limit(max))),
      getDocs(query(collection(db, 'venues'), where('status', '==', 'pending_review'), limit(max))),
    ]);

    const seen    = new Set<string>();
    const results: FSVenue[] = [];

    [...approvedSnap.docs, ...unclaimedSnap.docs, ...pendingSnap.docs].forEach(d => {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        const data = { id: d.id, ...d.data() } as FSVenue;
        if (!userVibes || userVibes.length === 0) {
          results.push(data);
        } else if ((data.vibes || []).some(v => userVibes.includes(v))) {
          results.push(data);
        }
      }
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
    return { id: snap.id, ...snap.data() } as FSVenue;
  } catch (e) {
    console.log('getVenueById error:', e);
    return null;
  }
}

// ── Venues by Neighborhood ────────────────────────────────────────────
export async function getVenuesByNeighborhood(
  neighborhoodSlug: string,
  max: number = 30
): Promise<FSVenue[]> {
  try {
    const statuses = ['approved', 'unclaimed', 'pending_review'];
    const snaps    = await Promise.all(
      statuses.map(status =>
        getDocs(query(
          collection(db, 'venues'),
          where('neighborhoodSlug', '==', neighborhoodSlug),
          where('status', '==', status),
          limit(max)
        ))
      )
    );

    const seen    = new Set<string>();
    const results: FSVenue[] = [];
    snaps.flatMap(s => s.docs).forEach(d => {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        results.push({ id: d.id, ...d.data() } as FSVenue);
      }
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
