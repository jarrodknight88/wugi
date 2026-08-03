// ─────────────────────────────────────────────────────────────────────
// Wugi — For You daily suggestion cap
//
// UAT-W2D: the swipe feed must not dead-end, but is hard-capped at 100
// suggestions/day/user. Implementer's call (per task notes): a lightweight
// AsyncStorage counter, not a Firestore write — a per-swipe network write
// just to count views isn't worth it, and AsyncStorage is already a
// dependency (see catalogStore.ts). Resets on local-device date rollover;
// this is a soft UX cap, not a fraud-proof server-enforced limit, so device
// clock drift / reinstalls resetting the counter is an accepted tradeoff.
// ─────────────────────────────────────────────────────────────────────
import AsyncStorage from '@react-native-async-storage/async-storage';

export const FOR_YOU_DAILY_CAP = 100;

const STORAGE_KEY = 'wugi-foryou-daily-cap-v1';

type CapState = { date: string; count: number };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function readState(): Promise<CapState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { date: todayKey(), count: 0 };
    const parsed = JSON.parse(raw) as CapState;
    if (parsed.date !== todayKey()) return { date: todayKey(), count: 0 };
    return parsed;
  } catch {
    return { date: todayKey(), count: 0 };
  }
}

/** Suggestions still allowed today, without recording anything. */
export async function getRemainingSuggestions(): Promise<number> {
  const s = await readState();
  return Math.max(0, FOR_YOU_DAILY_CAP - s.count);
}

/** Records `n` more suggestions shown today; returns the new remaining count. */
export async function recordSuggestionsShown(n: number): Promise<number> {
  const s = await readState();
  const next: CapState = { date: s.date, count: s.count + n };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Non-blocking — worst case the cap under-counts for this session.
  }
  return Math.max(0, FOR_YOU_DAILY_CAP - next.count);
}
