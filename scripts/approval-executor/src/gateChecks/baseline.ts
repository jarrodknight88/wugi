import type { BaselineCounts, BuildBaselines, CheckResult } from '../types';

const TSC_ERROR_LINE = /: error TS\d+:/;

/** Pure: count tsc/build error lines in raw stdout+stderr output. */
export function countTscErrors(output: string): number {
  return output.split('\n').filter((line) => TSC_ERROR_LINE.test(line)).length;
}

/** Pure: error counts from a worktree build must be at or below the recorded
 * baselines (system/buildBaselines, seeded from CLAUDE.md's TypeScript
 * baselines table — see README). A `null` count means that package wasn't
 * applicable to this diff and is skipped rather than compared. */
export function checkBaselineRegression(counts: BaselineCounts, baselines: BuildBaselines): CheckResult {
  const regressions: string[] = [];

  if (counts.functions !== null && counts.functions > baselines.functions) {
    regressions.push(`functions/ ${counts.functions} > baseline ${baselines.functions}`);
  }
  if (counts.mobileApp !== null && counts.mobileApp > baselines.mobileApp) {
    regressions.push(`mobile-app/ ${counts.mobileApp} > baseline ${baselines.mobileApp}`);
  }

  if (regressions.length > 0) {
    return { pass: false, reason: `New tsc errors introduced: ${regressions.join('; ')}` };
  }
  return { pass: true, reason: 'No new tsc errors vs recorded baselines' };
}
