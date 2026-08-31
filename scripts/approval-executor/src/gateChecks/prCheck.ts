import type { CheckResult, GitHubPullRequest } from '../types';

/** Pure: given the live PR (or null if the API 404'd), is it open and mergeable? */
export function checkPrOpenAndMergeable(pr: GitHubPullRequest | null): CheckResult {
  if (!pr) return { pass: false, reason: 'PR not found on jarrodknight88/wugi' };
  if (pr.merged) return { pass: false, reason: 'PR is already merged' };
  if (pr.state !== 'open') return { pass: false, reason: `PR is ${pr.state}, not open` };
  if (pr.mergeable === false) return { pass: false, reason: 'PR is not mergeable (conflicts)' };
  if (pr.mergeable === null) {
    return { pass: false, reason: 'GitHub has not finished computing mergeability yet — retry shortly' };
  }
  return { pass: true, reason: 'PR is open and mergeable' };
}
