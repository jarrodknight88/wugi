import { DENYLIST_PATTERNS } from '../config';
import type { DenylistResult } from '../types';

/** Pure: does this diff touch anything on the denylist? Never blocks execution —
 * per spec, denylist hits still execute on Jarrod's word, but the caller must
 * surface `hit` in the result message explicitly as "DENYLIST". */
export function scanDenylist(changedFiles: string[]): DenylistResult {
  const matches = changedFiles.filter((file) => DENYLIST_PATTERNS.some((pattern) => pattern.test(file)));
  return { hit: matches.length > 0, matches };
}
