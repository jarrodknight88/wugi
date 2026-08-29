import { BUILD_BASELINES_DOC } from './config';
import { getFirestore } from './firestore';
import type { BuildBaselines } from './types';

/** Seed values — must match the root CLAUDE.md TypeScript baselines table
 * exactly (functions/ and mobile-app/ rows) at install time. CLAUDE.md is
 * the canonical source; if it changes, update the seed AND re-run
 * `npm run seed-baselines` (see README) rather than editing this constant. */
const SEED_BASELINES: BuildBaselines = { functions: 0, mobileApp: 38 };

export async function getBuildBaselines(): Promise<BuildBaselines> {
  const snap = await getFirestore().doc(BUILD_BASELINES_DOC).get();
  const data = snap.data();
  if (!data) return SEED_BASELINES;
  return { functions: data.functions ?? 0, mobileApp: data.mobileApp ?? 0 };
}

export async function seedBuildBaselines(): Promise<void> {
  await getFirestore().doc(BUILD_BASELINES_DOC).set(SEED_BASELINES, { merge: true });
}
