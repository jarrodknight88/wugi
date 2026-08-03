// ─────────────────────────────────────────────────────────────────────
// Wugi — For You daily suggestion cap (UAT-W2D)
//
// Lightweight AsyncStorage-backed counter capping suggestion "views" at
// FOR_YOU_DAILY_CAP per calendar day (device local time). Device-scoped, not
// per-account: ForYouScreen has no uid prop today, and threading one through
// RootNavigator would widen this change past the ForYouScreen/For-You-feed
// lane. A shared device would share one counter across accounts — acceptable
// for a soft, informational cap; revisit if that becomes a real problem.
//
// Storage key is stamped with today's date, so a new day starts a fresh
// count without any explicit reset/expiry logic.
// ─────────────────────────────────────────────────────────────────────
import AsyncStorage from '@react-native-async-storage/async-storage';

export const FOR_YOU_DAILY_CAP = 100;
const STORAGE_KEY_PREFIX = 'forYouSuggestionsShown:';

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function readCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_PREFIX + todayKey());
    return raw ? (parseInt(raw, 10) || 0) : 0;
  } catch {
    return 0;
  }
}

// Remaining suggestions the caller may show today. Storage failures fail
// open (full cap available) rather than blocking the feed on a read error.
export async function getRemainingSuggestions(): Promise<number> {
  const count = await readCount();
  return Math.max(0, FOR_YOU_DAILY_CAP - count);
}

// Records one suggestion shown; returns the remaining count after this view.
export async function recordSuggestionShown(): Promise<number> {
  try {
    const key = STORAGE_KEY_PREFIX + todayKey();
    const next = (await readCount()) + 1;
    await AsyncStorage.setItem(key, String(next));
    return Math.max(0, FOR_YOU_DAILY_CAP - next);
  } catch {
    return FOR_YOU_DAILY_CAP;
  }
}
