import type { OverlapResult } from '../types';

/** Pure: does this PR's diff touch any file also touched by another open PR?
 * `otherPrFiles` maps PR number -> its changed files. Blocking — two in-flight
 * PRs touching the same file is exactly the race this daemon must not paper over. */
export function checkFileOverlap(
  changedFiles: string[],
  otherPrFiles: Record<number, string[]>
): OverlapResult {
  const changed = new Set(changedFiles);
  const withPrs: number[] = [];
  for (const [prNumberStr, files] of Object.entries(otherPrFiles)) {
    if (files.some((file) => changed.has(file))) withPrs.push(Number(prNumberStr));
  }
  return { overlap: withPrs.length > 0, withPrs };
}
