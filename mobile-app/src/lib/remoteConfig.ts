// ─────────────────────────────────────────────────────────────────────
// Wugi — remoteConfig
// Firebase Remote Config: forced-update kill-switch + feature flags that
// can be flipped without an App Store review cycle.
//
// Defaults are intentionally permissive (no gate, baseline behavior) so a
// build that can't reach Firebase (offline first launch, RC outage) never
// locks users out or silently changes behavior — it only reacts once a
// value is explicitly published in the Firebase console.
// ─────────────────────────────────────────────────────────────────────
import { getApp } from '@react-native-firebase/app';
import {
  getRemoteConfig,
  setDefaults,
  setConfigSettings,
  fetchAndActivate,
  getValue,
} from '@react-native-firebase/remote-config';

// Cache remote config values for an hour before re-fetching from the
// network. `fetchAndActivate` still resolves instantly from the local
// cache/defaults in between — this just bounds how stale a device's
// flags can get.
const MINIMUM_FETCH_INTERVAL_MILLIS = 60 * 60 * 1000;

export const REMOTE_CONFIG_KEYS = {
  minSupportedVersion: 'min_supported_version',
  imageMode:           'image_mode',
} as const;

const DEFAULTS: Record<string, string> = {
  [REMOTE_CONFIG_KEYS.minSupportedVersion]: '0.0.0',
  [REMOTE_CONFIG_KEYS.imageMode]:           'two-image',
};

const rc = getRemoteConfig(getApp());

let initPromise: Promise<void> | null = null;

// Idempotent — safe to call from multiple mount points; only the first
// call does any work, later callers await the same in-flight promise.
export function initRemoteConfig(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await setConfigSettings(rc, { minimumFetchIntervalMillis: MINIMUM_FETCH_INTERVAL_MILLIS });
      await setDefaults(rc, DEFAULTS);
      try {
        await fetchAndActivate(rc);
      } catch (e) {
        // Offline / RC outage — fall back to the last-activated (or
        // default) values already applied above.
        console.log('remoteConfig: fetchAndActivate failed, using cached/default values', e);
      }
    })();
  }
  return initPromise;
}

export function getMinSupportedVersion(): string {
  return getValue(rc, REMOTE_CONFIG_KEYS.minSupportedVersion).asString() || DEFAULTS[REMOTE_CONFIG_KEYS.minSupportedVersion];
}

export type ImageMode = 'two-image' | 'dynamic';

export function getImageMode(): ImageMode {
  const value = getValue(rc, REMOTE_CONFIG_KEYS.imageMode).asString();
  return value === 'dynamic' ? 'dynamic' : 'two-image';
}
