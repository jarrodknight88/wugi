// ─────────────────────────────────────────────────────────────────────
// Wugi — remoteConfig.ts
// Lightweight config/feature-flag layer backed by a single Firestore doc
// (config/appConfig) — no separate Remote Config product, no new package.
//
// Ships two things:
//  - min_supported_version: the mobile forward-compatibility gate. Below
//    this, App.tsx renders ForceUpdateScreen before any other UI mounts.
//  - image_mode: first general-purpose feature flag, demonstrating the
//    pattern for behavior toggles that ship without an App Store review.
//
// Defaults are deliberately permissive (min version "0.0.0" = no-op gate)
// so a device that can never reach Firestore is never locked out or
// silently switched to different behavior — fetch failures fail open.
// Manual step: an admin must create the config/appConfig document in the
// wugi-prod Firestore console for the gate/flags to take effect.
// ─────────────────────────────────────────────────────────────────────
import { getFirestore, doc, getDoc } from '@react-native-firebase/firestore';

export type ImageMode = 'two-image' | 'dynamic';

type AppConfig = {
  minSupportedVersion: string;
  imageMode: ImageMode;
};

const DEFAULT_CONFIG: AppConfig = {
  minSupportedVersion: '0.0.0',
  imageMode: 'two-image',
};

let cachedConfig: AppConfig = DEFAULT_CONFIG;
let initPromise: Promise<void> | null = null;

async function fetchAppConfig(): Promise<void> {
  try {
    const db = getFirestore();
    const snap = await getDoc(doc(db, 'config', 'appConfig'));
    if (snap.exists()) {
      const data = snap.data() as Partial<{ minSupportedVersion: string; imageMode: string }> | undefined;
      cachedConfig = {
        minSupportedVersion:
          typeof data?.minSupportedVersion === 'string' && data.minSupportedVersion.length > 0
            ? data.minSupportedVersion
            : DEFAULT_CONFIG.minSupportedVersion,
        imageMode: data?.imageMode === 'dynamic' ? 'dynamic' : DEFAULT_CONFIG.imageMode,
      };
    }
  } catch {
    // Fail open — keep permissive defaults, never block or throw.
  }
}

// Idempotent — safe to call from App.tsx boot every launch; subsequent
// calls in the same session return the already-resolved promise.
export function initRemoteConfig(): Promise<void> {
  if (!initPromise) {
    initPromise = fetchAppConfig();
  }
  return initPromise;
}

export function getMinSupportedVersion(): string {
  return cachedConfig.minSupportedVersion;
}

export function getImageMode(): ImageMode {
  return cachedConfig.imageMode;
}
