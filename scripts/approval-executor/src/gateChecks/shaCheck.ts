import type { CheckResult } from '../types';

/** Pure: the head SHA the PM reviewed must still equal the PR's live head SHA.
 * A mismatch means the worker pushed after review — fail closed, never merge stale-reviewed code. */
export function checkShaMatch(reviewedSha: string | undefined, liveHeadSha: string): CheckResult {
  if (!reviewedSha) {
    return { pass: false, reason: 'Approval entry has no reviewedSha recorded' };
  }
  if (reviewedSha !== liveHeadSha) {
    return {
      pass: false,
      reason: `SHA mismatch: reviewed ${reviewedSha.slice(0, 12)} but PR head is now ${liveHeadSha.slice(0, 12)} — worker pushed after review`,
    };
  }
  return { pass: true, reason: 'Head SHA matches the reviewed SHA' };
}
