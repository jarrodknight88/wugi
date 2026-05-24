// ─────────────────────────────────────────────────────────────────────
// Wugi — crashLogger
// VENUE-DATA-08 Deliverable B
//
// Writes a render-time crash to Firestore `crashes` collection so post-mortem
// debugging has the actual stack + context. Used by ErrorBoundary.
//
// Dedup: 1-hour sliding window keyed on (screen, eventId, errorMessage) —
// reduces noise when the same crash repeats. The dedup query is allowed
// to fail silently (network down, missing index, etc.) — the crash log
// MUST never throw, ever; that would defeat the purpose of the boundary.
// ─────────────────────────────────────────────────────────────────────
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  limit,
  getDocs,
  serverTimestamp,
} from '@react-native-firebase/firestore';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

const DEDUP_WINDOW_MS = 60 * 60 * 1000;  // 1 hour

export type CrashLogPayload = {
  screen:         string;
  eventId?:       string | null;
  venueId?:       string | null;
  errorName?:     string;
  errorMessage:   string;
  errorStack?:    string;
  componentStack?: string;
  userId?:        string | null;
};

export async function logCrash(p: CrashLogPayload): Promise<void> {
  // Helper try-catch — the logger MUST NOT throw. Ever.
  try {
    const db = getFirestore();
    const col = collection(db, 'crashes');

    // Dedup check — skip write if a matching doc was logged in the last hour.
    // If the dedup query itself fails (no index, network error, etc.) we
    // proceed with the write rather than skip — better duplicates than silence.
    let isDuplicate = false;
    try {
      const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
      const dedupQ = query(
        col,
        where('screen',       '==', p.screen),
        where('eventId',      '==', p.eventId ?? null),
        where('errorMessage', '==', p.errorMessage),
        where('timestamp',    '>',  cutoff),
        limit(1)
      );
      const snap = await getDocs(dedupQ);
      isDuplicate = snap.size > 0;
    } catch {
      isDuplicate = false;
    }
    if (isDuplicate) return;

    // Build payload. expo-device fields can return null on simulator.
    const buildNumber =
      (Constants.expoConfig as any)?.ios?.buildNumber ??
      (Constants.expoConfig as any)?.android?.versionCode ??
      'unknown';
    const appVersion = (Constants.expoConfig as any)?.version ?? 'unknown';

    await addDoc(col, {
      screen:         p.screen,
      eventId:        p.eventId ?? null,
      venueId:        p.venueId ?? null,
      errorName:      p.errorName ?? 'Error',
      errorMessage:   p.errorMessage,
      errorStack:     (p.errorStack ?? '').slice(0, 4000),       // cap to keep doc size sane
      componentStack: (p.componentStack ?? '').slice(0, 4000),
      buildNumber,
      appVersion,
      userId:         p.userId ?? null,
      deviceModel:    Device.modelName ?? 'unknown',
      deviceBrand:    Device.brand ?? 'unknown',
      osName:         Device.osName ?? 'unknown',
      osVersion:      Device.osVersion ?? 'unknown',
      isDevice:       Device.isDevice ?? false,
      timestamp:      serverTimestamp(),
    });
  } catch (e) {
    // Last-resort log; never re-throw.
    console.log('crashLogger.logCrash internal error:', (e as any)?.message);
  }
}
