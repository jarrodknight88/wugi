// ─────────────────────────────────────────────────────────────────────
// Wugi — For You suggestion day cap (UAT-W2D)
//
// Continuous suggestions need a real stopping point so the feed never
// becomes an unbounded scroll trap. This is a lightweight, client-only
// counter (AsyncStorage — no new backend write path) keyed by user id +
// calendar day in America/New_York (matching the rest of the app's date
// semantics, see eventDateTime.ts). It is a soft UX guardrail, not a
// billing-grade limit, so a signed-out/anon user and a reinstall both
// simply get a fresh counter — that's an accepted tradeoff for keeping
// this in-lane (no Firestore write from the For You screen).
// ─────────────────────────────────────────────────────────────────────
import AsyncStorage from '@react-native-async-storage/async-storage';

export const DAILY_SUGGESTION_CAP = 100;

const STORAGE_PREFIX = 'wugi:forYouSuggestionCount:';

function todayKeyET(): string {
  // en-CA formats as YYYY-MM-DD, giving a stable per-day storage key.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}:${todayKeyET()}`;
}

export async function getSuggestionCountToday(userId: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    return raw ? (parseInt(raw, 10) || 0) : 0;
  } catch {
    return 0;
  }
}

// Returns the count AFTER incrementing, so the caller can compare it
// against DAILY_SUGGESTION_CAP in one round trip.
export async function incrementSuggestionCount(userId: string): Promise<number> {
  try {
    const next = (await getSuggestionCountToday(userId)) + 1;
    await AsyncStorage.setItem(storageKey(userId), String(next));
    return next;
  } catch {
    return 0;
  }
}

export async function hasReachedDailyCap(userId: string): Promise<boolean> {
  return (await getSuggestionCountToday(userId)) >= DAILY_SUGGESTION_CAP;
}
