// ─────────────────────────────────────────────────────────────────────
// Wugi — crashlyticsService
// Modular API for @react-native-firebase/crashlytics v23 (mirrors the
// getFirestore()/getAuth() pattern already used elsewhere in this app).
//
// Collection is OFF in __DEV__ so local development never pollutes the
// dashboard — initCrashlytics() flips it on for release builds. The native
// default (firebase.json → crashlytics_auto_collection_enabled: false) is
// the same OFF gate at the native layer, so a build that skips JS init for
// any reason still fails closed rather than reporting local noise.
//
// Every export swallows its own errors — a broken crash reporter must
// never break the code path it's instrumenting.
// ─────────────────────────────────────────────────────────────────────
import {
  getCrashlytics,
  log,
  recordError,
  setUserId,
  setCrashlyticsCollectionEnabled,
} from '@react-native-firebase/crashlytics';

const crashlytics = getCrashlytics();

export async function initCrashlytics(): Promise<void> {
  try {
    await setCrashlyticsCollectionEnabled(crashlytics, !__DEV__);
  } catch (e) {
    console.log('crashlyticsService: setCrashlyticsCollectionEnabled failed', e);
  }
}

// uid only — never pass email/name/phone (see PII rule in the task/PR).
export function setCrashUserId(uid: string | null): void {
  setUserId(crashlytics, uid ?? '').catch(e =>
    console.log('crashlyticsService: setUserId failed', e)
  );
}

export function logBreadcrumb(message: string): void {
  try {
    log(crashlytics, message);
  } catch (e) {
    console.log('crashlyticsService: log failed', e);
  }
}

// For a swallowed error whose catch block returns an empty/null value —
// today that renders as an innocent empty state (e.g. Discover blanking on
// a permission-denied). `operation` names the call site so the breadcrumb
// and the grouped non-fatal both point at the same function.
export function recordNonFatal(operation: string, e: unknown): void {
  try {
    log(crashlytics, `${operation} failed`);
    recordError(crashlytics, e instanceof Error ? e : new Error(String(e)), operation);
  } catch (err) {
    console.log('crashlyticsService: recordNonFatal failed', err);
  }
}
